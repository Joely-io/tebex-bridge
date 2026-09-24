import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getKeyStatuses } from './utils/keycheck.js'
import { hmacAuth } from './middleware/hmac.js'
import { plugin } from './routes/plugin.js'
import { headless } from './routes/headless.js'
import { checkout } from './routes/checkout.js'

export const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
) as { version: string }

/**
 * Build the bridge app: every route Joely can call, and nothing else.
 * Kept free of startup side effects (store ID resolution, listening) so the
 * tests exercise the exact wiring that runs in production.
 */
export function createApp() {
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
  // this bridge can NOT be used as an arbitrary Tebex proxy. The list of
  // proxied routes is mirrored in routes.json (checked by the tests), which
  // Joely reads to make sure it never calls a route this bridge lacks.
  app.route('/v1/plugin', plugin)
  app.route('/v1/headless', headless)
  app.route('/v1/checkout', checkout)

  // A route this bridge does not know. The dedicated code lets Joely tell it
  // apart from a Tebex 404 passed through (e.g. an unknown coupon), and ask the
  // owner to update the bridge.
  app.notFound((c) =>
    c.json({ error: 'ROUTE_NOT_FOUND', message: 'This bridge version does not expose this route' }, 404)
  )

  return app
}
