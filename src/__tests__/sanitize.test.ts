import { describe, it, expect } from 'vitest'
import { sanitizePayment, sanitizeUserLookup } from '../utils/sanitize.js'

describe('sanitizePayment', () => {
  it('reduces customer to the webstore username only', () => {
    const payment = {
      transaction_id: 'tbx-123',
      price: 9.99,
      customer: {
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        ip: '1.2.3.4',
        marketing_consent: true,
        country: 'FR',
        postal_code: '75001',
        username: { id: '76561198000000000', username: 'john_doe' },
      },
    }

    const result = sanitizePayment(payment) as Record<string, any>

    expect(result.customer).toEqual({ username: { username: 'john_doe' } })
    expect(result.transaction_id).toBe('tbx-123')
    expect(result.price).toBe(9.99)
  })

  it('keeps a string customer username', () => {
    const result = sanitizePayment({
      customer: { email: 'x@y.z', username: 'john_doe' },
    }) as Record<string, any>

    expect(result.customer).toEqual({ username: 'john_doe' })
  })

  it('returns an empty customer when there is no username', () => {
    const result = sanitizePayment({
      customer: { email: 'x@y.z', ip: '1.2.3.4' },
    }) as Record<string, any>

    expect(result.customer).toEqual({})
  })

  it('strips gift-recipient usernames from products', () => {
    const result = sanitizePayment({
      products: [
        { id: 'p1', name: 'VIP', quantity: 1, username: 'recipient_user' },
        { id: 'p2', name: 'Car pack', quantity: 2, username: null },
      ],
    }) as Record<string, any>

    expect(result.products).toEqual([
      { id: 'p1', name: 'VIP', quantity: 1 },
      { id: 'p2', name: 'Car pack', quantity: 2 },
    ])
  })

  it('passes through unknown top-level fields (denylist behavior)', () => {
    const result = sanitizePayment({
      new_tebex_field: 'value',
      customer: { email: 'x@y.z' },
    }) as Record<string, any>

    expect(result.new_tebex_field).toBe('value')
    expect(result.customer.email).toBeUndefined()
  })

  it('does not mutate the original object', () => {
    const payment = {
      customer: { email: 'x@y.z' },
      products: [{ name: 'VIP', username: 'recipient' }],
    }
    sanitizePayment(payment)
    expect(payment.customer.email).toBe('x@y.z')
    expect(payment.products[0]!.username).toBe('recipient')
  })

  it('handles payments without a customer object', () => {
    expect(sanitizePayment({ price: 5 })).toEqual({ price: 5 })
    expect(sanitizePayment(null)).toBeNull()
    expect(sanitizePayment([1, 2])).toEqual([1, 2])
  })
})

describe('sanitizeUserLookup', () => {
  it('strips the player profile and customer behaviour stats', () => {
    const lookup = {
      player: { id: 1, username: 'john_doe', meta: 'data' },
      banCount: 0,
      chargebackRate: 2,
      purchaseTotals: { USD: 49.99 },
      payments: [{ txn_id: 'tbx-1', time: 1700000000, price: 9.99, currency: 'EUR', status: 1 }],
    }

    const result = sanitizeUserLookup(lookup) as Record<string, any>

    expect(result.player).toBeUndefined()
    expect(result.banCount).toBeUndefined()
    expect(result.chargebackRate).toBeUndefined()
    expect(result.purchaseTotals).toBeUndefined()
    expect(result.payments).toEqual(lookup.payments)
  })

  it('passes through unknown fields (denylist behavior)', () => {
    const result = sanitizeUserLookup({
      new_tebex_field: 'value',
      player: { username: 'x' },
    }) as Record<string, any>

    expect(result.new_tebex_field).toBe('value')
    expect(result.player).toBeUndefined()
  })

  it('does not mutate the original object', () => {
    const lookup = { player: { username: 'x' }, payments: [] }
    sanitizeUserLookup(lookup)
    expect(lookup.player.username).toBe('x')
  })

  it('handles non-object responses', () => {
    expect(sanitizeUserLookup(null)).toBeNull()
    expect(sanitizeUserLookup([1, 2])).toEqual([1, 2])
  })
})
