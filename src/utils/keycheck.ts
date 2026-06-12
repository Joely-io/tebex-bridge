import type { BridgeConfig } from '../config.js'
import {
  TEBEX_PLUGIN_API_BASE,
  TEBEX_CHECKOUT_VALIDATION_URL,
  pluginHeaders,
  checkoutHeaders,
  headlessAccountBase,
} from './tebex.js'

const TEBEX_TIMEOUT_MS = 10_000

export type KeyStatus = 'valid' | 'invalid' | 'unreachable' | 'not_configured'

async function probeStatus(url: string, headers?: Record<string, string>): Promise<number | null> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(TEBEX_TIMEOUT_MS) })
    return response.status
  } catch {
    return null
  }
}

/** Public key (Headless webstore token): the account lookup returns 200 when valid */
export async function checkWebstoreToken(config: BridgeConfig): Promise<KeyStatus> {
  const status = await probeStatus(headlessAccountBase(config.webstoreToken))
  if (status === null) return 'unreachable'
  return status === 200 ? 'valid' : 'invalid'
}

/**
 * Private key (Checkout API): Tebex's validation trick — a 404 on a
 * fictitious payment means the credentials are valid, 401/403 means not.
 */
export async function checkCheckoutKeys(config: BridgeConfig): Promise<KeyStatus> {
  if (!config.storeId || !config.privateKey) return 'not_configured'
  const status = await probeStatus(
    TEBEX_CHECKOUT_VALIDATION_URL,
    checkoutHeaders(config.storeId, config.privateKey)
  )
  if (status === null) return 'unreachable'
  return status === 404 || status === 200 ? 'valid' : 'invalid'
}

/** Game server key (Plugin API secret): /information returns 200 when valid */
export async function checkSecretKey(config: BridgeConfig): Promise<KeyStatus> {
  if (!config.secretKey) return 'not_configured'
  const status = await probeStatus(
    `${TEBEX_PLUGIN_API_BASE}/information`,
    pluginHeaders(config.secretKey)
  )
  if (status === null) return 'unreachable'
  return status === 200 ? 'valid' : 'invalid'
}

const STATUS_LABELS: Record<KeyStatus, string> = {
  valid: '✓',
  invalid: '✗ (rejected by Tebex)',
  unreachable: '? (Tebex API unreachable)',
  not_configured: '- (not configured)',
}

/** Verify every configured key against the Tebex API and log one line per key */
export async function runKeyChecks(config: BridgeConfig): Promise<void> {
  const [webstoreToken, checkoutKeys, secretKey] = await Promise.all([
    checkWebstoreToken(config),
    checkCheckoutKeys(config),
    checkSecretKey(config),
  ])

  console.log('Tebex key check:')
  console.log(`  Public key (TEBEX_WEBSTORE_TOKEN):                ${STATUS_LABELS[webstoreToken]}`)
  console.log(`  Private key (TEBEX_STORE_ID + TEBEX_PRIVATE_KEY): ${STATUS_LABELS[checkoutKeys]}`)
  console.log(`  Game server key (TEBEX_SECRET_KEY):               ${STATUS_LABELS[secretKey]}`)
}
