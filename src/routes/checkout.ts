import { Hono } from 'hono'
import { config } from '../config.js'
import { proxyToTebex } from '../utils/proxy.js'
import { sanitizePayment } from '../utils/sanitize.js'

const TEBEX_CHECKOUT_API_BASE = 'https://checkout.tebex.io/api'

/**
 * Checkout API routes (https://docs.tebex.io/developers)
 * Auth: HTTP Basic ({storeId}:{privateKey}), injected from the bridge's own env.
 *
 * Used by Joely for: transaction/payment details, credential validation.
 * Payment responses are sanitized: customer email, IP and username are
 * stripped before the response leaves this bridge (see utils/sanitize.ts).
 */
export const checkout = new Hono()

/** Reject Checkout API calls when credentials are not configured on this bridge */
checkout.use('*', async (c, next) => {
  if (!config.storeId || !config.privateKey) {
    return c.json(
      { error: 'NOT_CONFIGURED', message: 'TEBEX_STORE_ID / TEBEX_PRIVATE_KEY are not set on this bridge' },
      503
    )
  }
  await next()
})

function checkoutHeaders(): Record<string, string> {
  const credentials = Buffer.from(`${config.storeId}:${config.privateKey}`).toString('base64')
  return {
    Authorization: `Basic ${credentials}`,
    Accept: '*/*',
  }
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
  proxyToTebex(c, `${TEBEX_CHECKOUT_API_BASE}/payments/tbx-validation-test?type=txn_id`, {
    headers: checkoutHeaders(),
  })
)
