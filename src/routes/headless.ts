import { Hono } from 'hono'
import { config } from '../config.js'
import { proxyToTebex } from '../utils/proxy.js'

const TEBEX_HEADLESS_API_BASE = 'https://headless.tebex.io/api'

/**
 * Headless API routes (https://docs.tebex.io/developers)
 * Auth: webstore token in the URL path, injected from the bridge's own env.
 * The token never appears in the routes Joely calls.
 *
 * Used by Joely for: store info, categories, packages.
 */
export const headless = new Hono()

function accountBase(): string {
  return `${TEBEX_HEADLESS_API_BASE}/accounts/${encodeURIComponent(config.webstoreToken)}`
}

// GET /v1/headless/accounts — store info
headless.get('/accounts', (c) => proxyToTebex(c, accountBase()))

// GET /v1/headless/categories[?includePackages=1] — categories
headless.get('/categories', (c) => {
  const url = new URL(`${accountBase()}/categories`)
  const includePackages = c.req.query('includePackages')
  if (includePackages) url.searchParams.set('includePackages', includePackages)
  return proxyToTebex(c, url.toString())
})

// GET /v1/headless/packages — all packages
headless.get('/packages', (c) => proxyToTebex(c, `${accountBase()}/packages`))

// GET /v1/headless/packages/:packageId — single package
headless.get('/packages/:packageId', (c) =>
  proxyToTebex(c, `${accountBase()}/packages/${encodeURIComponent(c.req.param('packageId'))}`)
)
