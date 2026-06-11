/**
 * PII fields stripped from Tebex Checkout payment responses before they are
 * returned to Joely. This is a denylist by design: new non-PII fields added by
 * Tebex pass through automatically, while customer PII never leaves the bridge.
 */
const CUSTOMER_PII_FIELDS = ['email', 'ip', 'username'] as const

/**
 * Strip customer PII from a Checkout API payment response.
 * Mutates a shallow copy — the original object is not modified.
 */
export function sanitizePayment(payment: unknown): unknown {
  if (payment === null || typeof payment !== 'object' || Array.isArray(payment)) {
    return payment
  }

  const result = { ...(payment as Record<string, unknown>) }
  const customer = result.customer

  if (customer !== null && typeof customer === 'object' && !Array.isArray(customer)) {
    const cleanCustomer = { ...(customer as Record<string, unknown>) }
    for (const field of CUSTOMER_PII_FIELDS) {
      delete cleanCustomer[field]
    }
    result.customer = cleanCustomer
  }

  return result
}
