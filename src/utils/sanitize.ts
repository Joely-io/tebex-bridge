/**
 * Sanitizers that strip customer PII from Tebex API responses before they are
 * returned to Joely. Joely only consumes a small subset of each response
 * (transaction ids, prices, statuses, product names) — everything identifying
 * the customer that Joely does not need never leaves the bridge.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The Checkout payment `customer` object is PII by nature (first_name,
 * last_name, email, ip, marketing_consent, country, postal_code — see
 * https://docs.tebex.io/developers/checkout-api/endpoints), so it is reduced
 * to an allowlist: only the webstore username survives, which Joely displays
 * on the order detail view.
 */
function sanitizeCustomer(customer: unknown): unknown {
  if (!isPlainObject(customer)) {
    return customer
  }
  const username = customer.username
  if (isPlainObject(username)) {
    return { username: { username: username.username } }
  }
  return typeof username === 'string' ? { username } : {}
}

/**
 * Strip customer PII from a Checkout API payment response:
 * - `customer` is reduced to the webstore username (see sanitizeCustomer)
 * - `products[].username` (gift recipient) is removed
 * Other fields pass through untouched. Returns a copy — the original object
 * is not modified.
 */
export function sanitizePayment(payment: unknown): unknown {
  if (!isPlainObject(payment)) {
    return payment
  }

  const result = { ...payment }

  if ('customer' in result) {
    result.customer = sanitizeCustomer(result.customer)
  }

  if (Array.isArray(result.products)) {
    result.products = result.products.map((product) => {
      if (!isPlainObject(product)) {
        return product
      }
      const { username: _username, ...rest } = product
      return rest
    })
  }

  return result
}

/**
 * PII fields stripped from Plugin API user lookup responses. Joely only reads
 * `payments[]` (txn_id, time, price, currency, status) — the player profile
 * and customer behaviour stats are dropped. Denylist by design: new non-PII
 * fields added by Tebex pass through automatically.
 */
const USER_LOOKUP_PII_FIELDS = ['player', 'banCount', 'chargebackRate', 'purchaseTotals'] as const

/**
 * Strip customer PII from a Plugin API user lookup response (GET /user/:id).
 * Returns a copy — the original object is not modified.
 */
export function sanitizeUserLookup(lookup: unknown): unknown {
  if (!isPlainObject(lookup)) {
    return lookup
  }

  const result = { ...lookup }
  for (const field of USER_LOOKUP_PII_FIELDS) {
    delete result[field]
  }
  return result
}

/**
 * Buyer PII returned at the top level of a Plugin API payment lookup
 * (GET /payments/:transaction). Joely identifies the buyer by the webstore
 * username only, so these are dropped outright.
 */
const PLUGIN_PAYMENT_PII_FIELDS = ['email', 'ip'] as const

/**
 * The Plugin payment `player` object carries the platform id and uuid next to
 * the name. Like the Checkout customer block, it is reduced to an allowlist:
 * only `name` (the webstore username) survives.
 */
function sanitizePlayer(player: unknown): unknown {
  if (!isPlainObject(player)) {
    return player
  }
  return typeof player.name === 'string' ? { name: player.name } : {}
}

/**
 * Strip customer PII from a Plugin API payment lookup response
 * (GET /payments/:transaction): `email` and `ip` are removed, `player` is
 * reduced to its name. Other fields (id, amount, status, currency, gateway,
 * packages, notes, dates) pass through. Returns a copy: the original object is
 * not modified.
 */
export function sanitizePluginPayment(payment: unknown): unknown {
  if (!isPlainObject(payment)) {
    return payment
  }

  const result = { ...payment }
  for (const field of PLUGIN_PAYMENT_PII_FIELDS) {
    delete result[field]
  }
  if ('player' in result) {
    result.player = sanitizePlayer(result.player)
  }
  return result
}
