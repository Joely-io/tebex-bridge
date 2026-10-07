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

/**
 * Keep only the allowed keys of an object (a copy), or return a non-object as
 * is. Used by the basket sanitizers, which are allowlists end to end: a basket
 * holds the buyer's email, name, address and IP next to what Joely reads.
 */
function pick(value: unknown, keys: readonly string[]): unknown {
  if (!isPlainObject(value)) {
    return value
  }
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    if (key in value) result[key] = value[key]
  }
  return result
}

/** Apply `sanitize` to the basket, whether Tebex wraps it in `data` or not */
function sanitizeBasketEnvelope(body: unknown, sanitize: (basket: unknown) => unknown): unknown {
  if (!isPlainObject(body)) {
    return body
  }
  return isPlainObject(body.data) ? { data: sanitize(body.data) } : sanitize(body)
}

/**
 * Headless basket fields Joely reads: completion, the Cfx.re identity the
 * buyer logged in with (webstore username + id) and the package ids.
 */
const HEADLESS_BASKET_FIELDS = ['ident', 'complete', 'username', 'username_id', 'packages'] as const
/** Basket packages keep their id and name only (`in_basket` can name a gift recipient) */
const HEADLESS_BASKET_PACKAGE_FIELDS = ['id', 'name'] as const

/**
 * Reduce a Headless basket response (create, read, add/remove package) to an
 * allowlist: `ident`, `complete`, `username`, `username_id` and
 * `packages[].{id,name}`. Email, name, address, IP, `custom`, coupons, gift
 * cards and links are dropped. Returns a copy.
 */
export function sanitizeHeadlessBasket(body: unknown): unknown {
  return sanitizeBasketEnvelope(body, (basket) => {
    const result = pick(basket, HEADLESS_BASKET_FIELDS)
    if (isPlainObject(result) && Array.isArray(result.packages)) {
      result.packages = result.packages.map((pkg) => pick(pkg, HEADLESS_BASKET_PACKAGE_FIELDS))
    }
    return result
  })
}

/**
 * Reduce a Checkout basket response (read, add sale) to what proves a payment:
 * `ident`, `complete`, `payment.status` and `links.payment` (the transaction
 * link). Customer details, address, items and totals are dropped. Returns a
 * copy.
 */
export function sanitizeCheckoutBasket(body: unknown): unknown {
  return sanitizeBasketEnvelope(body, (basket) => {
    const result = pick(basket, ['ident', 'complete', 'payment', 'links'])
    if (isPlainObject(result)) {
      if ('payment' in result) result.payment = pick(result.payment, ['status'])
      if ('links' in result) result.links = pick(result.links, ['payment'])
    }
    return result
  })
}

/** Player package row fields Joely reads (`GET /player/:id/packages`) */
const PLAYER_PACKAGE_FIELDS = ['txn_id', 'date', 'quantity', 'package'] as const

/**
 * Reduce a Plugin API player packages response (GET /player/:id/packages, the
 * purchase history of a store below Tebex's Plus plan) to an allowlist: each
 * row keeps `txn_id`, `date`, `quantity` and `package.{id,name}`. Returns a
 * copy; a non-array body passes through unchanged.
 */
export function sanitizePlayerPackages(rows: unknown): unknown {
  if (!Array.isArray(rows)) {
    return rows
  }
  return rows.map((row) => {
    const result = pick(row, PLAYER_PACKAGE_FIELDS)
    if (isPlainObject(result) && 'package' in result) {
      result.package = pick(result.package, ['id', 'name'])
    }
    return result
  })
}
