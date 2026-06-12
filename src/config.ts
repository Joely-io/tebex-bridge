/**
 * Bridge configuration, read from environment variables at startup.
 *
 * Required:
 * - TEBEX_PUBLIC_KEY     (Headless API)
 * - JOELY_SHARED_SECRET  (HMAC secret shared with Joely, min 32 chars)
 *
 * Optional (only needed for the Joely features you use):
 * - TEBEX_GAME_SERVER_SECRET_KEY (Plugin API: payments lookup, coupons, gift cards)
 * - TEBEX_PRIVATE_KEY            (Checkout API: transaction details)
 */

export interface BridgeConfig {
  publicKey: string
  sharedSecret: string
  gameServerSecretKey: string | null
  /** Checkout Basic-auth username — resolved from the Headless API at startup, not an env var */
  storeId: string | null
  privateKey: string | null
  port: number
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

export function loadConfig(): BridgeConfig {
  const publicKey = readEnv('TEBEX_PUBLIC_KEY')
  const sharedSecret = readEnv('JOELY_SHARED_SECRET')
  const gameServerSecretKey = readEnv('TEBEX_GAME_SERVER_SECRET_KEY')
  const privateKey = readEnv('TEBEX_PRIVATE_KEY')

  const errors: string[] = []

  if (!publicKey) errors.push('TEBEX_PUBLIC_KEY is required')
  if (!sharedSecret) errors.push('JOELY_SHARED_SECRET is required')
  else if (sharedSecret.length < 32) errors.push('JOELY_SHARED_SECRET must be at least 32 characters')

  if (errors.length > 0) {
    console.error('Invalid configuration:')
    for (const error of errors) console.error(`  - ${error}`)
    process.exit(1)
  }

  return {
    publicKey: publicKey!,
    sharedSecret: sharedSecret!,
    gameServerSecretKey,
    storeId: null,
    privateKey,
    port: Number(readEnv('PORT') ?? 3000),
  }
}

export const config = loadConfig()
