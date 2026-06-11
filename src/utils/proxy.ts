import type { Context } from 'hono'

const TEBEX_TIMEOUT_MS = 10_000

export interface ProxyOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** Transform the parsed JSON body before returning it (e.g. PII stripping) */
  transform?: (data: unknown) => unknown
}

/**
 * Proxy a request to the Tebex API and return its response to Joely.
 *
 * - The Tebex HTTP status is passed through as-is (Joely interprets 404s etc.)
 * - The response body is passed through verbatim, unless a `transform` is
 *   provided (used to strip PII from Checkout payment responses)
 * - Network errors / timeouts return 502
 */
export async function proxyToTebex(c: Context, url: string, options: ProxyOptions = {}) {
  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: AbortSignal.timeout(TEBEX_TIMEOUT_MS),
    })
  } catch {
    return c.json({ error: 'TEBEX_UNREACHABLE', message: 'Could not reach the Tebex API' }, 502)
  }

  const rawBody = await response.text()

  if (!options.transform || !response.ok) {
    return c.newResponse(rawBody, response.status as never, {
      'Content-Type': response.headers.get('content-type') ?? 'application/json',
    })
  }

  let data: unknown
  try {
    data = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'TEBEX_INVALID_RESPONSE', message: 'Tebex returned a non-JSON response' }, 502)
  }

  return c.json(options.transform(data) as never, response.status as never)
}
