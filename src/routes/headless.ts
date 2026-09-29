import { Hono } from 'hono'
import { config } from '../config.js'
import { validateIdParam } from '../utils/params.js'
import { proxyToTebex } from '../utils/proxy.js'
import { sanitizeHeadlessBasket } from '../utils/sanitize.js'
import { TEBEX_HEADLESS_API_BASE, headlessAccountBase } from '../utils/tebex.js'

/**
 * Headless API routes (https://docs.tebex.io/developers)
 * Auth: public key in the URL path, injected from the bridge's own env.
 * The key never appears in the routes Joely calls.
 *
 * Used by Joely for: store info, categories, packages, and the baskets behind
 * payment links. Basket responses carry buyer PII (email, name, address, IP):
 * they are reduced to an allowlist before leaving this bridge
 * (sanitizeHeadlessBasket, see utils/sanitize.ts).
 */
export const headless = new Hono()

function accountBase(): string {
  return headlessAccountBase(config.publicKey)
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
headless.get('/packages/:packageId', validateIdParam('packageId'), (c) =>
  proxyToTebex(c, `${accountBase()}/packages/${encodeURIComponent(c.req.param('packageId'))}`)
)

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// POST /v1/headless/baskets — create a basket (payment links)
headless.post('/baskets', async (c) =>
  proxyToTebex(c, `${accountBase()}/baskets`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: await c.req.text(),
    transform: sanitizeHeadlessBasket,
  })
)

// GET /v1/headless/baskets/:ident — basket state (completion, Cfx.re identity, packages)
headless.get('/baskets/:ident', validateIdParam('ident'), (c) =>
  proxyToTebex(c, `${accountBase()}/baskets/${encodeURIComponent(c.req.param('ident'))}`, {
    transform: sanitizeHeadlessBasket,
  })
)

// GET /v1/headless/baskets/:ident/auth?returnUrl= — auth provider links of a basket
headless.get('/baskets/:ident/auth', validateIdParam('ident'), (c) => {
  const url = new URL(`${accountBase()}/baskets/${encodeURIComponent(c.req.param('ident'))}/auth`)
  const returnUrl = c.req.query('returnUrl')
  if (returnUrl) url.searchParams.set('returnUrl', returnUrl)
  return proxyToTebex(c, url.toString())
})

// POST /v1/headless/baskets/:ident/packages — add a package (no token: the ident is the credential)
headless.post('/baskets/:ident/packages', validateIdParam('ident'), async (c) =>
  proxyToTebex(c, `${TEBEX_HEADLESS_API_BASE}/baskets/${encodeURIComponent(c.req.param('ident'))}/packages`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: await c.req.text(),
    transform: sanitizeHeadlessBasket,
  })
)

// POST /v1/headless/baskets/:ident/packages/remove — remove a package
headless.post('/baskets/:ident/packages/remove', validateIdParam('ident'), async (c) =>
  proxyToTebex(
    c,
    `${TEBEX_HEADLESS_API_BASE}/baskets/${encodeURIComponent(c.req.param('ident'))}/packages/remove`,
    { method: 'POST', headers: JSON_HEADERS, body: await c.req.text(), transform: sanitizeHeadlessBasket }
  )
)
