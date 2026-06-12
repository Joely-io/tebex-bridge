import { Hono } from 'hono'
import { config } from '../config.js'
import { proxyToTebex } from '../utils/proxy.js'
import { sanitizePayment } from '../utils/sanitize.js'
import {
  TEBEX_CHECKOUT_API_BASE,
  TEBEX_CHECKOUT_VALIDATION_URL,
  checkoutHeaders as buildCheckoutHeaders,
} from '../utils/tebex.js'

/**
 * Checkout API routes (https://docs.tebex.io/developers)
 * Auth: HTTP Basic ({storeId}:{privateKey}) — the private key comes from the
 * bridge's own env, the store ID is resolved from the Headless API at startup.
 *
 * Used by Joely for: transaction/payment details, credential validation.
 * Payment responses are sanitized: the customer object is reduced to the
 * webstore username and gift-recipient usernames are stripped before the
 * response leaves this bridge (see utils/sanitize.ts).
 */
export const checkout = new Hono()

/** Reject Checkout API calls when credentials are not configured on this bridge */
checkout.use('*', async (c, next) => {
  if (!config.privateKey) {
    return c.json(
      { error: 'NOT_CONFIGURED', message: 'TEBEX_PRIVATE_KEY is not set on this bridge' },
      503
    )
  }
  if (!config.storeId) {
    return c.json(
      {
        error: 'NOT_CONFIGURED',
        message: 'Store ID could not be resolved from the Headless API at startup — restart the bridge',
      },
      503
    )
  }
  await next()
})

function checkoutHeaders(): Record<string, string> {
  return buildCheckoutHeaders(config.storeId!, config.privateKey!)
}

// GET /v1/checkout/payments/:txnId[?type=txn_id] — payment details (PII stripped)
checkout.get('/payments/:txnId', (c) => {
  const url = new URL(
    `${TEBEX_CHECKOUT_API_BASE}/payments/${encodeURIComponent(c.req.param('txnId'))}`
  )
  const type = c.req.query('type')
  if (type) url.searchParams.set('type', type)

  return proxyToTebex(c, url.toString(), {
    headers: checkoutHeaders(),
    transform: sanitizePayment,
  })
})

// GET /v1/checkout/validate — Checkout credential validation
// Proxies Tebex's validation trick: a 404 on a fictitious payment means the
// credentials are valid; 401/403/500 means they are not.
checkout.get('/validate', (c) =>
  proxyToTebex(c, TEBEX_CHECKOUT_VALIDATION_URL, {
    headers: checkoutHeaders(),
  })
)
