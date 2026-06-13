import type { BridgeConfig } from '../config.js'
import {
  TEBEX_PLUGIN_API_BASE,
  TEBEX_CHECKOUT_VALIDATION_URL,
  pluginHeaders,
  checkoutHeaders,
  headlessAccountBase,
} from './tebex.js'

const TEBEX_TIMEOUT_MS = 10_000

export type KeyStatus = 'valid' | 'invalid' | 'store_mismatch' | 'unreachable' | 'not_configured'

export interface KeyStatuses {
  /** Headless API (TEBEX_PUBLIC_KEY) */
  public: KeyStatus
  /** Checkout API (TEBEX_PRIVATE_KEY) */
  private: KeyStatus
  /** Plugin API game-server secret (TEBEX_GAME_SERVER_SECRET_KEY) */
  game: KeyStatus
}

// Snapshot of the startup key check, surfaced (as booleans) on the signed
// /v1/auth-check so Joely can show accurate per-store capabilities without
// hitting the (rate-limited) Plugin API on every connection test. null until
// the startup check resolves. Key/store config changes require a bridge
// restart to take effect, so a startup snapshot never goes stale silently.
let cachedStatuses: KeyStatuses | null = null

/** The cached startup key statuses, or null if the check hasn't resolved yet. */
export function getKeyStatuses(): KeyStatuses | null {
  return cachedStatuses
}

async function probeStatus(url: string, headers?: Record<string, string>): Promise<number | null> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(TEBEX_TIMEOUT_MS) })
    return response.status
  } catch {
    return null
  }
}

/** Public key (Headless API): the account lookup returns 200 when valid */
export async function checkPublicKey(config: BridgeConfig): Promise<KeyStatus> {
  const status = await probeStatus(headlessAccountBase(config.publicKey))
  if (status === null) return 'unreachable'
  return status === 200 ? 'valid' : 'invalid'
}

/**
 * Private key (Checkout API): Tebex's validation trick — a 404 on a
 * fictitious payment means the credentials are valid, 401/403 means not.
 * Same-store is implicit: Basic auth uses the store ID resolved from
 * TEBEX_PUBLIC_KEY, so a key from another store is rejected by Tebex.
 */
export async function checkCheckoutKeys(config: BridgeConfig): Promise<KeyStatus> {
  if (!config.privateKey) return 'not_configured'
  // Store ID resolution from the Headless API failed at startup
  if (!config.storeId) return 'unreachable'
  const status = await probeStatus(
    TEBEX_CHECKOUT_VALIDATION_URL,
    checkoutHeaders(config.storeId, config.privateKey)
  )
  if (status === null) return 'unreachable'
  return status === 404 || status === 200 ? 'valid' : 'invalid'
}

/**
 * Game server key (Plugin API secret): /information returns 200 when valid.
 * The response carries the account ID — when the store ID is known (resolved
 * from the public key at startup), a key that belongs to a different Tebex
 * store than TEBEX_PUBLIC_KEY is reported as a mismatch.
 */
export async function checkGameServerSecretKey(config: BridgeConfig): Promise<KeyStatus> {
  if (!config.gameServerSecretKey) return 'not_configured'
  try {
    const response = await fetch(`${TEBEX_PLUGIN_API_BASE}/information`, {
      headers: pluginHeaders(config.gameServerSecretKey),
      signal: AbortSignal.timeout(TEBEX_TIMEOUT_MS),
    })
    if (response.status !== 200) return 'invalid'
    if (config.storeId) {
      const body = (await response.json()) as { account?: { id?: number | string } }
      if (body.account?.id != null && String(body.account.id) !== config.storeId) {
        return 'store_mismatch'
      }
    }
    return 'valid'
  } catch {
    return 'unreachable'
  }
}

const STATUS_LABELS: Record<KeyStatus, string> = {
  valid: '✓',
  invalid: '✗ (rejected by Tebex)',
  store_mismatch: '✗ (valid key, but for a DIFFERENT Tebex store than TEBEX_PUBLIC_KEY)',
  unreachable: '? (Tebex API unreachable)',
  not_configured: '- (not configured)',
}

/**
 * Verify every configured key against the Tebex API, log one line per key, and
 * cache the result so /v1/auth-check can report the bridge's capabilities.
 */
export async function runKeyChecks(config: BridgeConfig): Promise<KeyStatuses> {
  const [publicKey, checkoutKeys, gameServerSecretKey] = await Promise.all([
    checkPublicKey(config),
    checkCheckoutKeys(config),
    checkGameServerSecretKey(config),
  ])

  console.log('Tebex key check:')
  console.log(`  Public key (TEBEX_PUBLIC_KEY):                  ${STATUS_LABELS[publicKey]}`)
  console.log(`  Private key (TEBEX_PRIVATE_KEY):                ${STATUS_LABELS[checkoutKeys]}`)
  console.log(`  Game server key (TEBEX_GAME_SERVER_SECRET_KEY): ${STATUS_LABELS[gameServerSecretKey]}`)

  cachedStatuses = { public: publicKey, private: checkoutKeys, game: gameServerSecretKey }
  return cachedStatuses
}
