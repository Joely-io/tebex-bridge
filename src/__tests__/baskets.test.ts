import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'

process.env.TEBEX_PUBLIC_KEY = 'test-public-key'
process.env.JOELY_SHARED_SECRET = 'a'.repeat(64)
process.env.TEBEX_PRIVATE_KEY = 'test-private-key'

const { computeSignature } = await import('../middleware/hmac.js')
const { config } = await import('../config.js')
const { createApp } = await import('../app.js')

const SECRET = process.env.JOELY_SHARED_SECRET!
const realFetch = globalThis.fetch
const IDENT = 'bskt-8f3a2c1d'

function signedRequest(method: string, path: string, body = '') {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  return createApp().request(path, {
    method,
    body: method === 'GET' ? undefined : body,
    headers: {
      'X-Joely-Timestamp': timestamp,
      'X-Joely-Signature': computeSignature(SECRET, timestamp, method, path, body),
    },
  })
}

function mockTebex(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

/** A Headless basket as Tebex returns it: what Joely reads, next to buyer PII */
const HEADLESS_BASKET = {
  data: {
    ident: IDENT,
    complete: true,
    email: 'buyer@example.com',
    username: 'buyer_ign',
    username_id: '1234567',
    ip: '1.2.3.4',
    address: { first_name: 'Jane', last_name: 'Doe', country: 'FR', postal_code: '75001' },
    custom: { payment_link_id: 'pl-1' },
    links: { checkout: 'https://pay.tebex.io/bskt-8f3a2c1d' },
    packages: [
      { id: 42, name: 'VIP', in_basket: { quantity: 1, gift_username: 'friend_ign', gift_username_id: '99' } },
    ],
  },
}

const SANITIZED_HEADLESS_BASKET = {
  data: {
    ident: IDENT,
    complete: true,
    username: 'buyer_ign',
    username_id: '1234567',
    packages: [{ id: 42, name: 'VIP' }],
  },
}

beforeAll(() => {
  config.storeId = '1234'
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('Headless basket routes', () => {
  it('POST /v1/headless/baskets creates the basket with the public key and strips buyer PII', async () => {
    const fetchMock = mockTebex(200, HEADLESS_BASKET)
    const body = JSON.stringify({ complete_url: 'https://joely.io/done', custom: { payment_link_id: 'pl-1' } })

    const res = await signedRequest('POST', '/v1/headless/baskets', body)

    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://headless.tebex.io/api/accounts/test-public-key/baskets')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(body)
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(await res.json()).toEqual(SANITIZED_HEADLESS_BASKET)
  })

  it('GET /v1/headless/baskets/:ident reads the basket and strips buyer PII', async () => {
    const fetchMock = mockTebex(200, HEADLESS_BASKET)
    const res = await signedRequest('GET', `/v1/headless/baskets/${IDENT}`)

    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toBe(`https://headless.tebex.io/api/accounts/test-public-key/baskets/${IDENT}`)
    expect(await res.json()).toEqual(SANITIZED_HEADLESS_BASKET)
  })

  it('GET /v1/headless/baskets/:ident passes an expired basket 404 through', async () => {
    mockTebex(404, '{"status":404,"detail":"Basket not found"}')
    const res = await signedRequest('GET', `/v1/headless/baskets/${IDENT}`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ status: 404, detail: 'Basket not found' })
  })

  it('GET /v1/headless/baskets/:ident/auth forwards returnUrl only and passes the links through', async () => {
    const links = [{ name: 'FiveM', url: 'https://ident.tebex.io/fivem/?x=1' }]
    const fetchMock = mockTebex(200, links)
    const returnUrl = 'https://joely.io/pay/return?a=1&b=2'

    const res = await signedRequest(
      'GET',
      `/v1/headless/baskets/${IDENT}/auth?returnUrl=${encodeURIComponent(returnUrl)}&extra=1`
    )

    expect(res.status).toBe(200)
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe(
      `https://headless.tebex.io/api/accounts/test-public-key/baskets/${IDENT}/auth`
    )
    expect([...url.searchParams.keys()]).toEqual(['returnUrl'])
    expect(url.searchParams.get('returnUrl')).toBe(returnUrl)
    expect(await res.json()).toEqual(links)
  })

  it.each([
    ['/packages', `https://headless.tebex.io/api/baskets/${IDENT}/packages`],
    ['/packages/remove', `https://headless.tebex.io/api/baskets/${IDENT}/packages/remove`],
  ])('POST /v1/headless/baskets/:ident%s goes to the token-less basket URL', async (suffix, tebexUrl) => {
    const fetchMock = mockTebex(200, HEADLESS_BASKET)
    const body = JSON.stringify({ package_id: 42, quantity: 1 })

    const res = await signedRequest('POST', `/v1/headless/baskets/${IDENT}${suffix}`, body)

    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(tebexUrl)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(body)
    expect(await res.json()).toEqual(SANITIZED_HEADLESS_BASKET)
  })

  it('passes the "must login" 422 through verbatim, so Joely can map it', async () => {
    const error = '{"status":422,"detail":"User must login before adding packages to basket"}'
    mockTebex(422, error)
    const res = await signedRequest('POST', `/v1/headless/baskets/${IDENT}/packages`, '{"package_id":42}')
    expect(res.status).toBe(422)
    expect(await res.text()).toBe(error)
  })
})

describe('Checkout basket routes', () => {
  const CHECKOUT_BASKET = {
    ident: IDENT,
    complete: true,
    email: 'buyer@example.com',
    first_name: 'Jane',
    address: { country: 'FR' },
    total_price: 9.99,
    payment: { status: 'complete', gateway: 'paypal', email: 'buyer@example.com' },
    links: { payment: 'https://checkout.tebex.io/api/payments/tbx-123', checkout: 'https://pay.tebex.io/x' },
  }
  const SANITIZED_CHECKOUT_BASKET = {
    ident: IDENT,
    complete: true,
    payment: { status: 'complete' },
    links: { payment: 'https://checkout.tebex.io/api/payments/tbx-123' },
  }

  it('GET /v1/checkout/baskets/:ident uses Basic auth and keeps only the payment proof', async () => {
    const fetchMock = mockTebex(200, CHECKOUT_BASKET)
    const res = await signedRequest('GET', `/v1/checkout/baskets/${IDENT}`)

    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://checkout.tebex.io/api/baskets/${IDENT}`)
    const expectedAuth = `Basic ${Buffer.from('1234:test-private-key').toString('base64')}`
    expect((init?.headers as Record<string, string>).Authorization).toBe(expectedAuth)
    expect(await res.json()).toEqual(SANITIZED_CHECKOUT_BASKET)
  })

  it('keeps the `data` envelope when Tebex wraps the basket', async () => {
    mockTebex(200, { data: CHECKOUT_BASKET })
    const res = await signedRequest('GET', `/v1/checkout/baskets/${IDENT}`)
    expect(await res.json()).toEqual({ data: SANITIZED_CHECKOUT_BASKET })
  })

  it('POST /v1/checkout/baskets/:ident/sales forwards the sale as JSON', async () => {
    const fetchMock = mockTebex(200, CHECKOUT_BASKET)
    const body = JSON.stringify({ name: 'Joely discount', discount_type: 'percentage', amount: 20 })

    const res = await signedRequest('POST', `/v1/checkout/baskets/${IDENT}/sales`, body)

    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://checkout.tebex.io/api/baskets/${IDENT}/sales`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(body)
    const headers = init?.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Authorization).toMatch(/^Basic /)
    expect(await res.json()).toEqual(SANITIZED_CHECKOUT_BASKET)
  })
})

describe('basket ident validation', () => {
  it.each([
    ['GET', `/v1/headless/baskets/..%2Faccounts`],
    ['GET', `/v1/headless/baskets/bskt.1/auth`],
    ['POST', `/v1/headless/baskets/bskt%20x/packages`],
    ['POST', `/v1/headless/baskets/${'x'.repeat(65)}/packages/remove`],
    ['GET', `/v1/checkout/baskets/..%2Fpayments`],
    ['POST', `/v1/checkout/baskets/bskt.1/sales`],
  ])('%s %s is refused with 400 before calling Tebex', async (method, path) => {
    const fetchMock = mockTebex(200, {})
    const res = await signedRequest(method, path, method === 'POST' ? '{}' : '')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'INVALID_ID' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
