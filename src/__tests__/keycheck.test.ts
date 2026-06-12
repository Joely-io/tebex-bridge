import { describe, it, expect, afterEach, vi } from 'vitest'
import type { BridgeConfig } from '../config.js'
import { checkPublicKey, checkCheckoutKeys, checkGameServerSecretKey } from '../utils/keycheck.js'
import { resolveStoreId } from '../utils/tebex.js'

function buildConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    publicKey: 'test-public-key',
    sharedSecret: 'a'.repeat(64),
    gameServerSecretKey: 'test-game-server-secret-key',
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

describe('checkPublicKey', () => {
  it('returns valid on 200', async () => {
    const mock = mockFetchStatus(200)
    await expect(checkPublicKey(buildConfig())).resolves.toBe('valid')
    expect(mock.mock.calls[0][0]).toBe(
      'https://headless.tebex.io/api/accounts/test-public-key'
    )
  })

  it('returns invalid on 404', async () => {
    mockFetchStatus(404)
    await expect(checkPublicKey(buildConfig())).resolves.toBe('invalid')
  })

  it('returns unreachable on network error', async () => {
    mockFetchError()
    await expect(checkPublicKey(buildConfig())).resolves.toBe('unreachable')
  })
})

describe('checkCheckoutKeys', () => {
  it('returns not_configured when the private key is missing', async () => {
    const mock = mockFetchStatus(200)
    await expect(
      checkCheckoutKeys(buildConfig({ storeId: null, privateKey: null }))
    ).resolves.toBe('not_configured')
    expect(mock).not.toHaveBeenCalled()
  })

  it('returns unreachable when the store ID resolution failed at startup', async () => {
    const mock = mockFetchStatus(200)
    await expect(checkCheckoutKeys(buildConfig({ storeId: null }))).resolves.toBe('unreachable')
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

describe('resolveStoreId', () => {
  it('returns the account id from the Headless API as a string', async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 12345 } })))
    vi.stubGlobal('fetch', mock)
    await expect(resolveStoreId('test-public-key')).resolves.toBe('12345')
    expect(mock.mock.calls[0][0]).toBe('https://headless.tebex.io/api/accounts/test-public-key')
  })

  it('returns null on a non-2xx response', async () => {
    mockFetchStatus(404)
    await expect(resolveStoreId('bad-key')).resolves.toBeNull()
  })

  it('returns null when the response has no id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }))))
    await expect(resolveStoreId('test-public-key')).resolves.toBeNull()
  })

  it('returns null on network error', async () => {
    mockFetchError()
    await expect(resolveStoreId('test-public-key')).resolves.toBeNull()
  })
})

describe('checkGameServerSecretKey', () => {
  it('returns not_configured when the key is missing', async () => {
    const mock = mockFetchStatus(200)
    await expect(
      checkGameServerSecretKey(buildConfig({ gameServerSecretKey: null }))
    ).resolves.toBe('not_configured')
    expect(mock).not.toHaveBeenCalled()
  })

  it('returns valid on 200', async () => {
    const mock = mockFetchStatus(200)
    await expect(checkGameServerSecretKey(buildConfig())).resolves.toBe('valid')
    const [url, init] = mock.mock.calls[0]
    expect(url).toBe('https://plugin.tebex.io/information')
    expect(init.headers['X-Tebex-Secret']).toBe('test-game-server-secret-key')
  })

  it('returns invalid on 403', async () => {
    mockFetchStatus(403)
    await expect(checkGameServerSecretKey(buildConfig())).resolves.toBe('invalid')
  })
})
