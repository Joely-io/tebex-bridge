/** Tebex API base URLs and auth header builders, shared by routes and the startup key check. */

export const TEBEX_PLUGIN_API_BASE = 'https://plugin.tebex.io'
export const TEBEX_HEADLESS_API_BASE = 'https://headless.tebex.io/api'
export const TEBEX_CHECKOUT_API_BASE = 'https://checkout.tebex.io/api'

/** Tebex's validation trick: a 404 on this fictitious payment means the Checkout credentials are valid */
export const TEBEX_CHECKOUT_VALIDATION_URL = `${TEBEX_CHECKOUT_API_BASE}/payments/tbx-validation-test?type=txn_id`

/** Plugin API auth (X-Tebex-Secret) */
export function pluginHeaders(secretKey: string): Record<string, string> {
  return {
    'X-Tebex-Secret': secretKey,
    'Content-Type': 'application/json',
  }
}

/** Checkout API auth (HTTP Basic {storeId}:{privateKey}) */
export function checkoutHeaders(storeId: string, privateKey: string): Record<string, string> {
  const credentials = Buffer.from(`${storeId}:${privateKey}`).toString('base64')
  return {
    Authorization: `Basic ${credentials}`,
    Accept: '*/*',
  }
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
