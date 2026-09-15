import { Hono } from 'hono'
import { config } from '../config.js'
import { proxyToTebex } from '../utils/proxy.js'
import { sanitizePluginPayment, sanitizeUserLookup } from '../utils/sanitize.js'
import { TEBEX_PLUGIN_API_BASE, pluginHeaders as buildPluginHeaders } from '../utils/tebex.js'

/**
 * Plugin API routes (https://docs.tebex.io/plugin)
 * Auth: X-Tebex-Secret header, injected from the bridge's own env.
 *
 * Used by Joely for: store info, customer payment lookup, payment lookup by
 * transaction id, coupons, gift cards, manual payments (package delivery at
 * price 0).
 * User and payment lookup responses are sanitized: buyer PII (player profile,
 * email, IP, customer behaviour stats) is stripped before the response leaves
 * this bridge (see utils/sanitize.ts).
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

/**
 * Tebex transaction ids (e.g. `tbx-26929122a16272-9c4f1d`). No dot, slash or
 * percent sign is allowed, so the id can never walk out of `/payments/`.
 */
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

// GET /v1/plugin/information — store info
plugin.get('/information', (c) =>
  proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/information`, { headers: pluginHeaders() })
)

// GET /v1/plugin/user/:userId — customer payment lookup (PII stripped)
plugin.get('/user/:userId', (c) =>
  proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/user/${encodeURIComponent(c.req.param('userId'))}`, {
    headers: pluginHeaders(),
    transform: sanitizeUserLookup,
  })
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
plugin.get('/coupons/:couponId', (c) =>
  proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/coupons/${encodeURIComponent(c.req.param('couponId'))}`, {
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
plugin.get('/gift-cards/:giftCardId', (c) =>
  proxyToTebex(
    c,
    `${TEBEX_PLUGIN_API_BASE}/gift-cards/${encodeURIComponent(c.req.param('giftCardId'))}`,
    { headers: pluginHeaders() }
  )
)

// GET /v1/plugin/payments/fields/:packageId — required fields of a package (manual payment form)
plugin.get('/payments/fields/:packageId', (c) =>
  proxyToTebex(
    c,
    `${TEBEX_PLUGIN_API_BASE}/payments/fields/${encodeURIComponent(c.req.param('packageId'))}`,
    { headers: pluginHeaders() }
  )
)

// GET /v1/plugin/payments/:transaction (payment details by transaction id, PII stripped).
// Fallback when the Checkout API cannot find a transaction. An invalid id is
// refused with a 400 and never reaches Tebex; Tebex's own statuses (404
// included) are passed through unchanged.
plugin.get('/payments/:transaction', (c) => {
  const transaction = c.req.param('transaction')
  if (!TRANSACTION_ID_PATTERN.test(transaction)) {
    return c.json(
      {
        error: 'INVALID_TRANSACTION_ID',
        message: 'The transaction id may only contain letters, digits, "-" and "_" (64 characters max)',
      },
      400
    )
  }
  return proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/payments/${encodeURIComponent(transaction)}`, {
    headers: pluginHeaders(),
    transform: sanitizePluginPayment,
  })
})

// POST /v1/plugin/payments — create a manual payment (delivers packages; Tebex answers 204)
plugin.post('/payments', async (c) =>
  proxyToTebex(c, `${TEBEX_PLUGIN_API_BASE}/payments`, {
    method: 'POST',
    headers: pluginHeaders(),
    body: await c.req.text(),
  })
)
