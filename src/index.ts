import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
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

// Signed no-op — lets Joely verify the shared secret without calling Tebex
app.get('/v1/auth-check', (c) => c.json({ ok: true }))

// The three Tebex API groups. Any route not declared here returns 404 —
// this bridge can NOT be used as an arbitrary Tebex proxy.
app.route('/v1/plugin', plugin)
app.route('/v1/headless', headless)
app.route('/v1/checkout', checkout)

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Tebex Bridge v${pkg.version} listening on port ${info.port}`)
  console.log(`Plugin API:   ${config.secretKey ? 'enabled' : 'disabled (no TEBEX_SECRET_KEY)'}`)
  console.log(`Headless API: enabled`)
  console.log(`Checkout API: ${config.privateKey ? 'enabled' : 'disabled (no TEBEX_PRIVATE_KEY)'}`)
})
