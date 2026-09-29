import { serve } from '@hono/node-server'
import { config } from './config.js'
import { resolveStoreId } from './utils/tebex.js'
import { runKeyChecks } from './utils/keycheck.js'
import { createApp, pkg } from './app.js'

const app = createApp()

// The store ID anchors the startup same-store key check and the Checkout
// Basic auth — resolved from the Headless API account lookup at startup so
// it never has to be configured by hand.
config.storeId = await resolveStoreId(config.publicKey)
if (!config.storeId) {
  console.error(
    `Could not resolve the store ID from the Headless API (check TEBEX_PUBLIC_KEY)${
      config.privateKey ? ' — Checkout routes are disabled until restart' : ''
    }`
  )
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Tebex Bridge v${pkg.version} listening on port ${info.port}`)
  console.log(`Plugin API:   ${config.gameServerSecretKey ? 'enabled' : 'disabled (no TEBEX_GAME_SERVER_SECRET_KEY)'}`)
  console.log(`Headless API: enabled`)
  console.log(
    `Checkout API: ${
      config.privateKey
        ? config.storeId
          ? `enabled (store ID ${config.storeId})`
          : 'disabled (store ID resolution failed)'
        : 'disabled (no TEBEX_PRIVATE_KEY)'
    }`
  )
  void runKeyChecks(config)
})
