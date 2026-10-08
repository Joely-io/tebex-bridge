/** Tebex API base URLs and auth header builders, shared by routes and the startup key check. */

export const TEBEX_PLUGIN_API_BASE = 'https://plugin.tebex.io'
export const TEBEX_HEADLESS_API_BASE = 'https://headless.tebex.io/api'
export const TEBEX_CHECKOUT_API_BASE = 'https://checkout.tebex.io/api'

/** Tebex's validation trick: a 404 on this fictitious payment means the Checkout credentials are valid */
export const TEBEX_CHECKOUT_VALIDATION_URL = `${TEBEX_CHECKOUT_API_BASE}/payments/tbx-validation-test?type=txn_id`

export const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' }

/** HTTP Basic credentials (`Basic base64(user:password)`) */
function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}

/** Plugin API auth (X-Tebex-Secret) */
export function pluginHeaders(secretKey: string): Record<string, string> {
  return {
    'X-Tebex-Secret': secretKey,
    ...JSON_HEADERS,
  }
}

/** Checkout API auth (HTTP Basic {storeId}:{privateKey}) */
export function checkoutHeaders(storeId: string, privateKey: string): Record<string, string> {
  return {
    Authorization: basicAuth(storeId, privateKey),
    Accept: '*/*',
  }
}

/**
 * Basket creation request. Joely sends the buyer's `ip_address` (Tebex taxes
 * the basket on its country, and would otherwise attribute a server-created
 * basket to this bridge's IP), but Tebex refuses it on an unauthenticated
 * request (422 "Basic auth credentials are required"): it is forwarded with
 * Headless Basic auth ({publicKey}:{privateKey}), and dropped without a private
 * key so the basket is still created. Any other body passes through untouched.
 */
export function basketCreationRequest(
  rawBody: string,
  publicKey: string,
  privateKey: string | null
): { body: string; headers: Record<string, string> } {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    // Not JSON: forwarded as is, Tebex answers it
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('ip_address' in parsed)) {
    return { body: rawBody, headers: JSON_HEADERS }
  }

  if (privateKey) {
    return { body: rawBody, headers: { ...JSON_HEADERS, Authorization: basicAuth(publicKey, privateKey) } }
  }
  const { ip_address: _ip, ...rest } = parsed as Record<string, unknown>
  return { body: JSON.stringify(rest), headers: JSON_HEADERS }
}

/** Headless API account base URL (public key lives in the path) */
export function headlessAccountBase(publicKey: string): string {
  return `${TEBEX_HEADLESS_API_BASE}/accounts/${encodeURIComponent(publicKey)}`
}

/** Resolve the store ID (Checkout Basic-auth username) from the Headless API account lookup */
export async function resolveStoreId(publicKey: string): Promise<string | null> {
  try {
    const response = await fetch(headlessAccountBase(publicKey), {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { data?: { id?: number | string } }
    return body.data?.id != null ? String(body.data.id) : null
  } catch {
    return null
  }
}
