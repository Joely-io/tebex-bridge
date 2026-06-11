import { describe, it, expect, beforeEach, vi } from 'vitest'

process.env.TEBEX_WEBSTORE_TOKEN = 'test-webstore-token'
process.env.JOELY_SHARED_SECRET = 'a'.repeat(64)

const { computeSignature, hmacAuth } = await import('../middleware/hmac.js')
const { Hono } = await import('hono')

const SECRET = process.env.JOELY_SHARED_SECRET!

function signedHeaders(method: string, pathWithQuery: string, body = '', timestamp?: string) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000).toString()
  return {
    'X-Joely-Timestamp': ts,
    'X-Joely-Signature': computeSignature(SECRET, ts, method, pathWithQuery, body),
  }
}

function buildApp() {
  const app = new Hono()
  app.use('/v1/*', hmacAuth)
  app.get('/v1/test', (c) => c.json({ ok: true }))
  app.post('/v1/test', (c) => c.json({ ok: true }))
  // Mirrors the real route handlers: re-reads the body AFTER the middleware
  // consumed it for signing (works because Hono caches the parsed body)
  app.post('/v1/echo', async (c) => c.json({ body: await c.req.text() }))
  return app
}

describe('hmacAuth', () => {
  let app: ReturnType<typeof buildApp>

  beforeEach(() => {
    app = buildApp()
    vi.useRealTimers()
  })

  it('accepts a correctly signed GET request', async () => {
    const res = await app.request('/v1/test', { headers: signedHeaders('GET', '/v1/test') })
    expect(res.status).toBe(200)
  })

  it('accepts a correctly signed POST request with body', async () => {
    const body = JSON.stringify({ hello: 'world' })
    const res = await app.request('/v1/test', {
      method: 'POST',
      headers: signedHeaders('POST', '/v1/test', body),
      body,
    })
    expect(res.status).toBe(200)
  })

  it('covers the query string in the signature', async () => {
    // Signed without the query string, requested with it -> mismatch
    const res = await app.request('/v1/test?tampered=1', {
      headers: signedHeaders('GET', '/v1/test'),
    })
    expect(res.status).toBe(401)
  })

  it('rejects a missing signature', async () => {
    const res = await app.request('/v1/test')
    expect(res.status).toBe(401)
  })

  it('rejects a wrong signature', async () => {
    const res = await app.request('/v1/test', {
      headers: {
        'X-Joely-Timestamp': Math.floor(Date.now() / 1000).toString(),
        'X-Joely-Signature': 'f'.repeat(64),
      },
    })
    expect(res.status).toBe(401)
  })

  it('rejects a timestamp older than 5 minutes (replay)', async () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 6 * 60).toString()
    const res = await app.request('/v1/test', {
      headers: signedHeaders('GET', '/v1/test', '', oldTimestamp),
    })
    expect(res.status).toBe(401)
  })

  it('route handlers can still read the body after middleware verification', async () => {
    const body = JSON.stringify({ code: 'PROMO10' })
    const res = await app.request('/v1/echo', {
      method: 'POST',
      headers: signedHeaders('POST', '/v1/echo', body),
      body,
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { body: string }
    expect(json.body).toBe(body)
  })

  it('rejects a tampered body', async () => {
    const res = await app.request('/v1/test', {
      method: 'POST',
      headers: signedHeaders('POST', '/v1/test', JSON.stringify({ price: 10 })),
      body: JSON.stringify({ price: 0 }),
    })
    expect(res.status).toBe(401)
  })
})
