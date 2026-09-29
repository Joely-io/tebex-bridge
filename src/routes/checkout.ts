import { Hono } from 'hono'
import { config } from '../config.js'
import { validateIdParam } from '../utils/params.js'
import { proxyToTebex } from '../utils/proxy.js'
import { sanitizeCheckoutBasket, sanitizePayment } from '../utils/sanitize.js'
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
 * Used by Joely for: transaction/payment details, credential validation, and
 * the baskets behind payment links (payment proof, percentage sale).
 * Payment responses are sanitized: the customer object is reduced to the
 * webstore username and gift-recipient usernames are stripped before the
 * response leaves this bridge. Basket responses are reduced to an allowlist
 * (see utils/sanitize.ts).
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
checkout.get('/payments/:txnId', validateIdParam('txnId', 'INVALID_TRANSACTION_ID'), (c) => {
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

// GET /v1/checkout/baskets/:ident — payment proof of a basket (complete, payment status, payment link)
checkout.get('/baskets/:ident', validateIdParam('ident'), (c) =>
  proxyToTebex(c, `${TEBEX_CHECKOUT_API_BASE}/baskets/${encodeURIComponent(c.req.param('ident'))}`, {
    headers: checkoutHeaders(),
    transform: sanitizeCheckoutBasket,
  })
)

// POST /v1/checkout/baskets/:ident/sales — apply a percentage sale to a basket
checkout.post('/baskets/:ident/sales', validateIdParam('ident'), async (c) =>
  proxyToTebex(c, `${TEBEX_CHECKOUT_API_BASE}/baskets/${encodeURIComponent(c.req.param('ident'))}/sales`, {
    method: 'POST',
    headers: { ...checkoutHeaders(), 'Content-Type': 'application/json' },
    body: await c.req.text(),
    transform: sanitizeCheckoutBasket,
  })
)
