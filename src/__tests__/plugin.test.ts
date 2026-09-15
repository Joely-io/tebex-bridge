import { describe, it, expect, afterEach, vi } from 'vitest'

process.env.TEBEX_PUBLIC_KEY = 'test-public-key'
process.env.JOELY_SHARED_SECRET = 'a'.repeat(64)
process.env.TEBEX_GAME_SERVER_SECRET_KEY = 'test-game-secret'

const { computeSignature, hmacAuth } = await import('../middleware/hmac.js')
const { plugin } = await import('../routes/plugin.js')
const { Hono } = await import('hono')

const SECRET = process.env.JOELY_SHARED_SECRET!
const realFetch = globalThis.fetch

/** Same wiring as src/index.ts: HMAC on /v1/*, Plugin routes under /v1/plugin */
function buildApp() {
  const app = new Hono()
  app.use('/v1/*', hmacAuth)
  app.route('/v1/plugin', plugin)
  return app
}

function signedGet(path: string, signature?: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  return buildApp().request(path, {
    headers: {
      'X-Joely-Timestamp': timestamp,
      'X-Joely-Signature': signature ?? computeSignature(SECRET, timestamp, 'GET', path, ''),
    },
  })
}

function mockTebex(response: () => Response) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response())
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

const TEBEX_PAYMENT = {
  id: 42,
  amount: '9.99',
  date: '2026-09-14T10:00:00+00:00',
  status: 'Complete',
  currency: { iso_4217: 'EUR', symbol: '€' },
  email: 'buyer@example.com',
  ip: '1.2.3.4',
  player: { id: 7, name: 'buyer_ign', uuid: '76561198000000000' },
  packages: [{ id: 5, name: 'VIP', quantity: 1 }],
}

describe('GET /v1/plugin/payments/:transaction', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('proxies a signed request with the bridge secret and strips buyer PII', async () => {
    const fetchMock = mockTebex(
      () =>
        new Response(JSON.stringify(TEBEX_PAYMENT), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    )

    const res = await signedGet('/v1/plugin/payments/tbx-26929122a16272-9c4f1d')

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://plugin.tebex.io/payments/tbx-26929122a16272-9c4f1d')
    expect(init?.method).toBe('GET')
    expect((init?.headers as Record<string, string>)['X-Tebex-Secret']).toBe('test-game-secret')

    const { email: _email, ip: _ip, player: _player, ...rest } = TEBEX_PAYMENT
    expect(await res.json()).toEqual({ ...rest, player: { name: 'buyer_ign' } })
  })

  it('rejects a request without a signature, before calling Tebex', async () => {
    const fetchMock = mockTebex(() => new Response('{}', { status: 200 }))
    const res = await buildApp().request('/v1/plugin/payments/tbx-123')
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a wrong signature, before calling Tebex', async () => {
    const fetchMock = mockTebex(() => new Response('{}', { status: 200 }))
    const res = await signedGet('/v1/plugin/payments/tbx-123', 'f'.repeat(64))
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes a Tebex 404 through with its body, so Joely can tell "not found" from an outage', async () => {
    mockTebex(() => new Response('{"error_code":404,"error_message":"Payment not found"}', { status: 404 }))
    const res = await signedGet('/v1/plugin/payments/tbx-missing')
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('{"error_code":404,"error_message":"Payment not found"}')
  })

  it('passes any other Tebex error status and body through unchanged', async () => {
    mockTebex(() => new Response('{"error_code":403,"error_message":"Invalid secret"}', { status: 403 }))
    const res = await signedGet('/v1/plugin/payments/tbx-123')
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('{"error_code":403,"error_message":"Invalid secret"}')
  })

  it('answers 502 TEBEX_UNREACHABLE when Tebex cannot be reached', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    const res = await signedGet('/v1/plugin/payments/tbx-123')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'TEBEX_UNREACHABLE' })
  })

  it('forwards a 204 with an empty body', async () => {
    mockTebex(() => new Response(null, { status: 204 }))
    const res = await signedGet('/v1/plugin/payments/tbx-123')
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it.each([
    ['a path traversal', '..%2Finformation'],
    ['a dot', 'tbx.123'],
    ['a space', 'tbx%20123'],
    ['more than 64 characters', 'x'.repeat(65)],
  ])('refuses %s in the id with 400, without calling Tebex', async (_label, id) => {
    const fetchMock = mockTebex(() => new Response('{}', { status: 200 }))
    const res = await signedGet(`/v1/plugin/payments/${id}`)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'INVALID_TRANSACTION_ID' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not shadow the package fields route', async () => {
    const fetchMock = mockTebex(() => new Response('[]', { status: 200 }))
    const res = await signedGet('/v1/plugin/payments/fields/5')
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toBe('https://plugin.tebex.io/payments/fields/5')
  })
})
