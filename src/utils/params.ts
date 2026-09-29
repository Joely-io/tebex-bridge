import type { MiddlewareHandler } from 'hono'

/**
 * Tebex ids forwarded in a URL path segment (coupon, gift card, package,
 * transaction and user ids). No dot, slash or percent sign is allowed:
 * `encodeURIComponent` keeps `..` as is and `fetch` would normalize it, so an
 * unchecked id could walk out of its Tebex path (e.g. `/coupons/..`).
 */
export const TEBEX_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Refuse the request with a 400 when the `param` path parameter does not
 * match `TEBEX_ID_PATTERN`, so an invalid id never reaches Tebex.
 */
export function validateIdParam(param: string, errorCode = 'INVALID_ID'): MiddlewareHandler {
  return async (c, next) => {
    if (!TEBEX_ID_PATTERN.test(c.req.param(param) ?? '')) {
      return c.json(
        {
          error: errorCode,
          message: 'The id may only contain letters, digits, "-" and "_" (64 characters max)',
        },
        400
      )
    }
    await next()
  }
}
