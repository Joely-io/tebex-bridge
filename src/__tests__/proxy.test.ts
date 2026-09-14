import { describe, it, expect, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { proxyToTebex } from '../utils/proxy.js'

const realFetch = globalThis.fetch

function appProxying(url: string) {
  const app = new Hono()
  app.post('/payments', async (c) => proxyToTebex(c, url, { method: 'POST', body: await c.req.text() }))
  app.get('/fields', (c) => proxyToTebex(c, url))
  return app
}

describe('proxyToTebex', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('forwards a 204 with no body (POST /payments answers 204 No Content)', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    const res = await appProxying('https://plugin.tebex.io/payments').request('/payments', {
      method: 'POST',
      body: '{"ign":"player","price":0,"packages":[{"id":1}]}',
    })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('passes a JSON body and its status through verbatim', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response('[{"name":"server","type":"dropdown","options":[{"label":"Main","value":7}]}]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch
    const res = await appProxying('https://plugin.tebex.io/payments/fields/1').request('/fields')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ name: 'server', type: 'dropdown', options: [{ label: 'Main', value: 7 }] }])
  })

  it('passes a Tebex error status and body through verbatim', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"error":"Package not found"}', { status: 404 })) as unknown as typeof fetch
    const res = await appProxying('https://plugin.tebex.io/payments/fields/999').request('/fields')
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('{"error":"Package not found"}')
  })

  it('answers 502 when Tebex is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    const res = await appProxying('https://plugin.tebex.io/payments').request('/payments', { method: 'POST', body: '{}' })
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'TEBEX_UNREACHABLE' })
  })
})
