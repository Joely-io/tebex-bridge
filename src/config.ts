/**
 * Bridge configuration, read from environment variables at startup.
 *
 * Required:
 * - TEBEX_WEBSTORE_TOKEN  (Headless API)
 * - JOELY_SHARED_SECRET   (HMAC secret shared with Joely, min 32 chars)
 *
 * Optional (only needed for the Joely features you use):
 * - TEBEX_SECRET_KEY      (Plugin API: payments lookup, coupons, gift cards)
 * - TEBEX_STORE_ID + TEBEX_PRIVATE_KEY (Checkout API: transaction details)
 */

export interface BridgeConfig {
  webstoreToken: string
  sharedSecret: string
  secretKey: string | null
  storeId: string | null
  privateKey: string | null
  port: number
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

export function loadConfig(): BridgeConfig {
  const webstoreToken = readEnv('TEBEX_WEBSTORE_TOKEN')
  const sharedSecret = readEnv('JOELY_SHARED_SECRET')
  const secretKey = readEnv('TEBEX_SECRET_KEY')
  const storeId = readEnv('TEBEX_STORE_ID')
  const privateKey = readEnv('TEBEX_PRIVATE_KEY')

  const errors: string[] = []

  if (!webstoreToken) errors.push('TEBEX_WEBSTORE_TOKEN is required')
  if (!sharedSecret) errors.push('JOELY_SHARED_SECRET is required')
  else if (sharedSecret.length < 32) errors.push('JOELY_SHARED_SECRET must be at least 32 characters')

  // Checkout API needs both the store ID and the private key
  if ((storeId && !privateKey) || (!storeId && privateKey)) {
    errors.push('TEBEX_STORE_ID and TEBEX_PRIVATE_KEY must be set together')
  }

  if (errors.length > 0) {
    console.error('Invalid configuration:')
    for (const error of errors) console.error(`  - ${error}`)
    process.exit(1)
  }

  return {
    webstoreToken: webstoreToken!,
    sharedSecret: sharedSecret!,
    secretKey,
    storeId,
    privateKey,
    port: Number(readEnv('PORT') ?? 3000),
  }
}

export const config = loadConfig()
