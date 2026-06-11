import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { config } from '../config.js'

/** Maximum age of a signed request, in seconds (anti-replay window) */
const MAX_TIMESTAMP_AGE_SECONDS = 5 * 60

/**
 * Compute the HMAC-SHA256 signature for a request.
 *
 * The signed message is:
 *   timestamp + "\n" + METHOD + "\n" + path-with-query + "\n" + sha256(body).hex
 *
 * This is the exact same construction used by Joely when signing requests.
 */
export function computeSignature(
  secret: string,
  timestamp: string,
  method: string,
  pathWithQuery: string,
  body: string
): string {
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex')
  const message = `${timestamp}\n${method.toUpperCase()}\n${pathWithQuery}\n${bodyHash}`
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex')
}

/** Constant-time comparison of two hex signatures */
function signaturesMatch(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'hex')
  const receivedBuffer = Buffer.from(received, 'hex')
  if (expectedBuffer.length !== receivedBuffer.length) return false
  return timingSafeEqual(expectedBuffer, receivedBuffer)
}

/**
 * Hono middleware that authenticates every request coming from Joely.
 *
 * Rejects with 401 when:
 * - the timestamp or signature header is missing
 * - the timestamp is outside the 5-minute replay window
 * - the recomputed signature does not match
 */
export const hmacAuth: MiddlewareHandler = async (c, next) => {
  const timestamp = c.req.header('x-joely-timestamp')
  const signature = c.req.header('x-joely-signature')

  if (!timestamp || !signature) {
    return c.json({ error: 'UNAUTHORIZED', message: 'Missing signature headers' }, 401)
  }

  const requestTime = Number(timestamp)
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(requestTime) || Math.abs(now - requestTime) > MAX_TIMESTAMP_AGE_SECONDS) {
    return c.json({ error: 'UNAUTHORIZED', message: 'Request timestamp expired' }, 401)
  }

  const url = new URL(c.req.url)
  const pathWithQuery = url.pathname + url.search
  const body = c.req.method === 'GET' || c.req.method === 'HEAD' ? '' : await c.req.text()

  const expected = computeSignature(config.sharedSecret, timestamp, c.req.method, pathWithQuery, body)

  if (!signaturesMatch(expected, signature)) {
    return c.json({ error: 'UNAUTHORIZED', message: 'Invalid signature' }, 401)
  }

  await next()
}
