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

function signedRequest(method: string, path: string, signature?: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  return buildApp().request(path, {
    method,
    headers: {
      'X-Joely-Timestamp': timestamp,
      'X-Joely-Signature': signature ?? computeSignature(SECRET, timestamp, method, path, ''),
    },
  })
}

function signedGet(path: string, signature?: string) {
  return signedRequest('GET', path, signature)
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

describe.each([
  ['coupons', 'couponId', '/v1/plugin/coupons', 'https://plugin.tebex.io/coupons'],
  ['gift-cards', 'giftCardId', '/v1/plugin/gift-cards', 'https://plugin.tebex.io/gift-cards'],
])('DELETE /v1/plugin/%s/:%s', (_resource, _param, route, tebexUrl) => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('proxies a signed DELETE to Tebex with the bridge secret', async () => {
    const fetchMock = mockTebex(() => new Response(null, { status: 204 }))

    const res = await signedRequest('DELETE', `${route}/12345`)

    expect(res.status).toBe(204)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${tebexUrl}/12345`)
    expect(init?.method).toBe('DELETE')
    expect((init?.headers as Record<string, string>)['X-Tebex-Secret']).toBe('test-game-secret')
  })

  it('passes the Tebex response body through (a voided gift card is echoed back)', async () => {
    const body = '{"data":{"id":12345,"void":true}}'
    mockTebex(() => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
    const res = await signedRequest('DELETE', `${route}/12345`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(body)
  })

  it('passes a Tebex 404 through with its JSON body, never as a missing route', async () => {
    mockTebex(() => new Response('{"error_code":404,"error_message":"Not found"}', { status: 404 }))
    const res = await signedRequest('DELETE', `${route}/12345`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error_code: 404, error_message: 'Not found' })
  })

  it('rejects an unsigned DELETE before calling Tebex', async () => {
    const fetchMock = mockTebex(() => new Response(null, { status: 204 }))
    const res = await buildApp().request(`${route}/12345`, { method: 'DELETE' })
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a path traversal', '..%2Finformation'],
    ['a dot', '12.345'],
    ['a space', '12%20345'],
    ['more than 64 characters', 'x'.repeat(65)],
  ])('refuses %s in the id with 400, without calling Tebex', async (_label, id) => {
    const fetchMock = mockTebex(() => new Response(null, { status: 204 }))
    const res = await signedRequest('DELETE', `${route}/${id}`)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'INVALID_ID' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('id validation on the other Plugin routes', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it.each([
    '/v1/plugin/user/..%2Finformation',
    '/v1/plugin/coupons/..%2Finformation',
    '/v1/plugin/gift-cards/..%2Finformation',
    '/v1/plugin/payments/fields/..%2Finformation',
  ])('refuses a path traversal id on GET %s with 400', async (path) => {
    const fetchMock = mockTebex(() => new Response('{}', { status: 200 }))
    const res = await signedGet(path)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'INVALID_ID' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still proxies a valid numeric user id', async () => {
    const fetchMock = mockTebex(() => new Response('{"payments":[]}', { status: 200 }))
    const res = await signedGet('/v1/plugin/user/1234567')
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toBe('https://plugin.tebex.io/user/1234567')
  })
})

describe('GET /v1/plugin/player/:playerId/packages', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('proxies a signed request and keeps only what Joely reads', async () => {
    const fetchMock = mockTebex(
      () =>
        new Response(
          JSON.stringify([
            {
              txn_id: 'tbx-1',
              date: '2026-01-31T01:00:00+00:00',
              quantity: 1,
              package: { id: 5, name: 'VIP', image: 'https://x/vip.png' },
              player: { name: 'buyer_ign', uuid: '76561198000000000' },
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    )

    const res = await signedGet('/v1/plugin/player/28400/packages')

    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://plugin.tebex.io/player/28400/packages')
    expect((init?.headers as Record<string, string>)['X-Tebex-Secret']).toBe('test-game-secret')
    expect(await res.json()).toEqual([
      { txn_id: 'tbx-1', date: '2026-01-31T01:00:00+00:00', quantity: 1, package: { id: 5, name: 'VIP' } },
    ])
  })

  it('passes a Tebex error through with its body', async () => {
    mockTebex(() => new Response('{"error_message":"Not found"}', { status: 404 }))
    const res = await signedGet('/v1/plugin/player/28400/packages')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error_message: 'Not found' })
  })

  it('refuses a path traversal id with 400, without calling Tebex', async () => {
    const fetchMock = mockTebex(() => new Response('[]', { status: 200 }))
    const res = await signedGet('/v1/plugin/player/..%2Finformation/packages')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'INVALID_ID' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
