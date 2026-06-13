import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { resolveStoreId } from './utils/tebex.js'
import { runKeyChecks, getKeyStatuses } from './utils/keycheck.js'
import { hmacAuth } from './middleware/hmac.js'
import { plugin } from './routes/plugin.js'
import { headless } from './routes/headless.js'
import { checkout } from './routes/checkout.js'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
) as { version: string }

const app = new Hono()

// Version header + request log on every response.
// Only method, path and status are ever logged — never headers or bodies.
app.use('*', async (c, next) => {
  await next()
  c.header('X-Bridge-Version', pkg.version)
  console.log(`${c.req.method} ${new URL(c.req.url).pathname} -> ${c.res.status}`)
})

// Public liveness check (no auth) — used by Joely's "Test connection" and
// by any uptime monitor the owner wants to point at the bridge.
app.get('/v1/health', (c) => c.json({ status: 'ok', version: pkg.version }))

// Everything else under /v1 requires a valid Joely HMAC signature
app.use('/v1/*', hmacAuth)

// Signed endpoint — lets Joely verify the shared secret without calling Tebex,
// and reports which Tebex keys this bridge actually serves (from the startup
// key check, see runKeyChecks). Booleans only: `true` means the key is present
// AND validated against Tebex for the resolved store. `keys` is null until the
// startup check resolves (a few seconds after boot). Kept off the public
// /v1/health so the bridge's capabilities are not disclosed unauthenticated.
app.get('/v1/auth-check', (c) => {
  const statuses = getKeyStatuses()
  return c.json({
    ok: true,
    version: pkg.version,
    keys: statuses
      ? {
          public: statuses.public === 'valid',
          private: statuses.private === 'valid',
          game: statuses.game === 'valid',
        }
      : null,
  })
})

// The three Tebex API groups. Any route not declared here returns 404 —
// this bridge can NOT be used as an arbitrary Tebex proxy.
app.route('/v1/plugin', plugin)
app.route('/v1/headless', headless)
app.route('/v1/checkout', checkout)

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
