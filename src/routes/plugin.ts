import { Hono } from 'hono'
import { config } from '../config.js'
import { validateIdParam } from '../utils/params.js'
import { proxyToTebex } from '../utils/proxy.js'
import { sanitizePlayerPackages, sanitizePluginPayment, sanitizeUserLookup } from '../utils/sanitize.js'
import { TEBEX_PLUGIN_API_BASE, pluginHeaders as buildPluginHeaders } from '../utils/tebex.js'

/**
 * Plugin API routes (https://docs.tebex.io/plugin)
 * Auth: X-Tebex-Secret header, injected from the bridge's own env.
 *
 * Used by Joely for: store info, customer payment lookup, payment lookup by
 * transaction id, coupons, gift cards (create, read, revoke), manual payments
 * (package delivery at price 0).
 * User and payment lookup responses are sanitized: buyer PII (player profile,
 * email, IP, customer behaviour stats) is stripped before the response leaves
 * this bridge (see utils/sanitize.ts).
 *
 * Every id taken from the path is checked against `TEBEX_ID_PATTERN` first: an
 * invalid id is refused with a 400 and never reaches Tebex. Tebex's own
 * statuses (404 included) are passed through unchanged.
 */
export const plugin = new Hono()

/** Reject Plugin API calls when no secret key is configured on this bridge */
plugin.use('*', async (c, next) => {
  if (!config.gameServerSecretKey) {
    return c.json(
      { error: 'NOT_CONFIGURED', message: 'TEBEX_GAME_SERVER_SECRET_KEY is not set on this bridge' },
      503
    )
  }
  await next()
})

function pluginHeaders(): Record<string, string> {
  return buildPluginHeaders(config.gameServerSecretKey!)
}

// GET /v1/plugin/information — store info
plugin.get('/information', (c) =>
  proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/information`, { headers: pluginHeaders() })
)

// GET /v1/plugin/user/:userId — customer payment lookup (PII stripped)
plugin.get('/user/:userId', validateIdParam('userId'), (c) =>
  proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/user/${encodeURIComponent(c.req.param('userId'))}`, {
    headers: pluginHeaders(),
    transform: sanitizeUserLookup,
  })
)

// GET /v1/plugin/player/:playerId/packages — a player's active packages, the
// purchase history of a store below Tebex's Plus plan (which refuses /user)
plugin.get('/player/:playerId/packages', validateIdParam('playerId'), (c) =>
  proxyToTebex(
    c,
    `${TEBEX_PLUGIN_API_BASE}/player/${encodeURIComponent(c.req.param('playerId'))}/packages`,
    { headers: pluginHeaders(), transform: sanitizePlayerPackages }
  )
)

// POST /v1/plugin/coupons — create coupon
plugin.post('/coupons', async (c) =>
  proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/coupons`, {
    method: 'POST',
    headers: pluginHeaders(),
    body: await c.req.text(),
  })
)

// GET /v1/plugin/coupons/:couponId — coupon details
plugin.get('/coupons/:couponId', validateIdParam('couponId'), (c) =>
  proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/coupons/${encodeURIComponent(c.req.param('couponId'))}`, {
    headers: pluginHeaders(),
  })
)

// DELETE /v1/plugin/coupons/:couponId — revoke a coupon (Tebex answers 204)
plugin.delete('/coupons/:couponId', validateIdParam('couponId'), (c) =>
  proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/coupons/${encodeURIComponent(c.req.param('couponId'))}`, {
    method: 'DELETE',
    headers: pluginHeaders(),
  })
)

// POST /v1/plugin/gift-cards — create gift card
plugin.post('/gift-cards', async (c) =>
  proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/gift-cards`, {
    method: 'POST',
    headers: pluginHeaders(),
    body: await c.req.text(),
  })
)

// GET /v1/plugin/gift-cards/:giftCardId — gift card details
plugin.get('/gift-cards/:giftCardId', validateIdParam('giftCardId'), (c) =>
  proxyToTebex(
    c,
    `${TEBEX_PLUGIN_API_BASE}/gift-cards/${encodeURIComponent(c.req.param('giftCardId'))}`,
    { headers: pluginHeaders() }
  )
)

// DELETE /v1/plugin/gift-cards/:giftCardId — void a gift card (Tebex echoes the card with `void: true`)
plugin.delete('/gift-cards/:giftCardId', validateIdParam('giftCardId'), (c) =>
  proxyToTebex(
    c,
    `${TEBEX_PLUGIN_API_BASE}/gift-cards/${encodeURIComponent(c.req.param('giftCardId'))}`,
    { method: 'DELETE', headers: pluginHeaders() }
  )
)

// GET /v1/plugin/payments/fields/:packageId — required fields of a package (manual payment form)
plugin.get('/payments/fields/:packageId', validateIdParam('packageId'), (c) =>
  proxyToTebex(
    c,
    `${TEBEX_PLUGIN_API_BASE}/payments/fields/${encodeURIComponent(c.req.param('packageId'))}`,
    { headers: pluginHeaders() }
  )
)

// GET /v1/plugin/payments/:transaction — payment details by transaction id (PII stripped).
// Fallback when the Checkout API cannot find a transaction.
plugin.get('/payments/:transaction', validateIdParam('transaction', 'INVALID_TRANSACTION_ID'), (c) =>
  proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/payments/${encodeURIComponent(c.req.param('transaction'))}`, {
    headers: pluginHeaders(),
    transform: sanitizePluginPayment,
  })
)

// POST /v1/plugin/payments — create a manual payment (delivers packages; Tebex answers 204)
plugin.post('/payments', async (c) =>
  proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/payments`, {
    method: 'POST',
    headers: pluginHeaders(),
    body: await c.req.text(),
  })
)
