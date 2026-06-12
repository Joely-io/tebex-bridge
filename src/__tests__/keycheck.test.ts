import { describe, it, expect, afterEach, vi } from 'vitest'
import type { BridgeConfig } from '../config.js'
import { checkWebstoreToken, checkCheckoutKeys, checkSecretKey } from '../utils/keycheck.js'

function buildConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    webstoreToken: 'test-webstore-token',
    sharedSecret: 'a'.repeat(64),
    secretKey: 'test-secret-key',
    storeId: '12345',
    privateKey: 'test-private-key',
    port: 3000,
    ...overrides,
  }
}

function mockFetchStatus(status: number) {
  const mock = vi.fn().mockResolvedValue(new Response('{}', { status }))
  vi.stubGlobal('fetch', mock)
  return mock
}

function mockFetchError() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkWebstoreToken', () => {
  it('returns valid on 200', async () => {
    const mock = mockFetchStatus(200)
    await expect(checkWebstoreToken(buildConfig())).resolves.toBe('valid')
    expect(mock.mock.calls[0][0]).toBe(
      'https://headless.tebex.io/api/accounts/test-webstore-token'
    )
  })

  it('returns invalid on 404', async () => {
    mockFetchStatus(404)
    await expect(checkWebstoreToken(buildConfig())).resolves.toBe('invalid')
  })

  it('returns unreachable on network error', async () => {
    mockFetchError()
    await expect(checkWebstoreToken(buildConfig())).resolves.toBe('unreachable')
  })
})

describe('checkCheckoutKeys', () => {
  it('returns not_configured when keys are missing', async () => {
    const mock = mockFetchStatus(200)
    await expect(
      checkCheckoutKeys(buildConfig({ storeId: null, privateKey: null }))
    ).resolves.toBe('not_configured')
    expect(mock).not.toHaveBeenCalled()
  })

  it('returns valid on 404 (Tebex validation trick)', async () => {
    const mock = mockFetchStatus(404)
    await expect(checkCheckoutKeys(buildConfig())).resolves.toBe('valid')
    const [url, init] = mock.mock.calls[0]
    expect(url).toBe('https://checkout.tebex.io/api/payments/tbx-validation-test?type=txn_id')
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('12345:test-private-key').toString('base64')}`
    )
  })

  it('returns invalid on 401', async () => {
    mockFetchStatus(401)
    await expect(checkCheckoutKeys(buildConfig())).resolves.toBe('invalid')
  })

  it('returns unreachable on network error', async () => {
    mockFetchError()
    await expect(checkCheckoutKeys(buildConfig())).resolves.toBe('unreachable')
  })
})

describe('checkSecretKey', () => {
  it('returns not_configured when the key is missing', async () => {
    const mock = mockFetchStatus(200)
    await expect(checkSecretKey(buildConfig({ secretKey: null }))).resolves.toBe('not_configured')
    expect(mock).not.toHaveBeenCalled()
  })

  it('returns valid on 200', async () => {
    const mock = mockFetchStatus(200)
    await expect(checkSecretKey(buildConfig())).resolves.toBe('valid')
    const [url, init] = mock.mock.calls[0]
    expect(url).toBe('https://plugin.tebex.io/information')
    expect(init.headers['X-Tebex-Secret']).toBe('test-secret-key')
  })

  it('returns invalid on 403', async () => {
    mockFetchStatus(403)
    await expect(checkSecretKey(buildConfig())).resolves.toBe('invalid')
  })
})
