import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

process.env.TEBEX_PUBLIC_KEY = 'test-public-key'
process.env.JOELY_SHARED_SECRET = 'a'.repeat(64)
process.env.TEBEX_GAME_SERVER_SECRET_KEY = 'test-game-secret'

const { computeSignature } = await import('../middleware/hmac.js')
const { createApp } = await import('../app.js')

const SECRET = process.env.JOELY_SHARED_SECRET!
const PROXIED_PREFIXES = ['/v1/plugin/', '/v1/headless/', '/v1/checkout/']

interface ManifestRoute {
  method: string
  path: string
}

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../routes.json', import.meta.url)), 'utf8')
) as { routes: ManifestRoute[] }

const key = (route: ManifestRoute) => `${route.method} ${route.path}`

describe('routes.json', () => {
  it('lists exactly the Tebex routes the app declares', () => {
    const declared = createApp()
      .routes.filter((route) => route.method !== 'ALL')
      .filter((route) => PROXIED_PREFIXES.some((prefix) => route.path.startsWith(prefix)))
      .map(key)

    expect([...new Set(declared)].sort()).toEqual(manifest.routes.map(key).sort())
  })

  it('has no duplicate entry', () => {
    const keys = manifest.routes.map(key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('unknown routes', () => {
  it('answer a signed request with 404 ROUTE_NOT_FOUND, so Joely can ask for a bridge update', async () => {
    const path = '/v1/plugin/not-a-route'
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const res = await createApp().request(path, {
      method: 'DELETE',
      headers: {
        'X-Joely-Timestamp': timestamp,
        'X-Joely-Signature': computeSignature(SECRET, timestamp, 'DELETE', path, ''),
      },
    })

    expect(res.status).toBe(404)
    expect(res.headers.get('X-Bridge-Version')).toMatch(/^\d+\.\d+\.\d+$/)
    expect(await res.json()).toMatchObject({ error: 'ROUTE_NOT_FOUND' })
  })
})

describe('id validation on Headless routes', () => {
  it('refuses a path traversal package id with 400, before calling Tebex', async () => {
    const path = '/v1/headless/packages/..%2Fcategories'
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const realFetch = globalThis.fetch
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('{}')
    }) as unknown as typeof fetch
    try {
      const res = await createApp().request(path, {
        headers: {
          'X-Joely-Timestamp': timestamp,
          'X-Joely-Signature': computeSignature(SECRET, timestamp, 'GET', path, ''),
        },
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'INVALID_ID' })
      expect(called).toBe(false)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
