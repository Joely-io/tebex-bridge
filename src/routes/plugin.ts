import { Hono } from 'hono'
import { config } from '../config.js'
import { proxyToTebex } from '../utils/proxy.js'
import { sanitizeUserLookup } from '../utils/sanitize.js'
import { TEBEX_PLUGIN_API_BASE, pluginHeaders as buildPluginHeaders } from '../utils/tebex.js'

/**
 * Plugin API routes (https://docs.tebex.io/plugin)
 * Auth: X-Tebex-Secret header, injected from the bridge's own env.
 *
 * Used by Joely for: store info, customer payment lookup, coupons, gift cards.
 * User lookup responses are sanitized: the player profile and customer
 * behaviour stats are stripped before the response leaves this bridge
 * (see utils/sanitize.ts).
 */
export const plugin = new Hono()

/** Reject Plugin API calls when no secret key is configured on this bridge */
plugin.use('*', async (c, next) => {
  if (!config.secretKey) {
    return c.json(
      { error: 'NOT_CONFIGURED', message: 'TEBEX_SECRET_KEY is not set on this bridge' },
      503
    )
  }
  await next()
})

function pluginHeaders(): Record<string, string> {
  return buildPluginHeaders(config.secretKey!)
}

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
