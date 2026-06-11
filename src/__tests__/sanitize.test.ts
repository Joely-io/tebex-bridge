import { describe, it, expect } from 'vitest'
import { sanitizePayment } from '../utils/sanitize.js'

describe('sanitizePayment', () => {
  it('strips customer email, ip and username', () => {
    const payment = {
      transaction_id: 'tbx-123',
      price: 9.99,
      customer: {
        first_name: 'John',
        email: 'john@example.com',
        ip: '1.2.3.4',
        username: 'john_doe',
      },
    }

    const result = sanitizePayment(payment) as Record<string, any>

    expect(result.customer.email).toBeUndefined()
    expect(result.customer.ip).toBeUndefined()
    expect(result.customer.username).toBeUndefined()
    expect(result.customer.first_name).toBe('John')
    expect(result.transaction_id).toBe('tbx-123')
  })

  it('passes through unknown fields (denylist behavior)', () => {
    const payment = {
      new_tebex_field: 'value',
      customer: { new_customer_field: 'kept', email: 'x@y.z' },
    }

    const result = sanitizePayment(payment) as Record<string, any>

    expect(result.new_tebex_field).toBe('value')
    expect(result.customer.new_customer_field).toBe('kept')
    expect(result.customer.email).toBeUndefined()
  })

  it('does not mutate the original object', () => {
    const payment = { customer: { email: 'x@y.z' } }
    sanitizePayment(payment)
    expect(payment.customer.email).toBe('x@y.z')
  })

  it('handles payments without a customer object', () => {
    expect(sanitizePayment({ price: 5 })).toEqual({ price: 5 })
    expect(sanitizePayment(null)).toBeNull()
    expect(sanitizePayment([1, 2])).toEqual([1, 2])
  })
})
