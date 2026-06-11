# Tebex Bridge

Self-hosted bridge that securely connects Tebex to [Joely](https://joely.io) while keeping your API keys on your own server.

## Why

By default, Joely stores your Tebex API keys encrypted (AES-256-GCM envelope encryption) on its own servers. If you prefer your keys to **never leave your infrastructure**, run this bridge instead:

1. Your Tebex keys live in this bridge's `.env`, on your server
2. Joely calls your bridge — never the Tebex API directly
3. The bridge proxies requests to Tebex and **strips customer PII** (email, IP, username) from payment responses before they reach Joely

The whole bridge is ~400 lines of TypeScript. Audit it yourself: every route it exposes is listed below, and any other path returns 404 — it cannot be used as an arbitrary Tebex proxy.

## Setup

### 1. Configure

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `TEBEX_WEBSTORE_TOKEN` | Yes | Headless API — store info, categories, packages |
| `JOELY_SHARED_SECRET` | Yes | HMAC secret, generated in the Joely dashboard |
| `TEBEX_SECRET_KEY` | No | Plugin API — payment lookup, coupons, gift cards |
| `TEBEX_STORE_ID` + `TEBEX_PRIVATE_KEY` | No | Checkout API — transaction details |
| `PORT` | No | Listen port (default 3000) |

Optional keys only disable their feature: without `TEBEX_SECRET_KEY`, coupon/gift-card features simply won't work in Joely.

### 2. Run

**Docker:**

```bash
docker build -t tebex-bridge .
docker run -d --env-file .env -p 3000:3000 tebex-bridge
```

**Node 20+:**

```bash
npm install
npm run build
npm start
```

### 3. Expose over HTTPS

Put the bridge behind a reverse proxy (Caddy, nginx, Cloudflare Tunnel) with a valid TLS certificate. **Never expose it over plain HTTP** — the HMAC protects authenticity, not confidentiality.

### 4. Connect in Joely

In your Joely dashboard: **Settings → Tebex → your store → Self-hosted bridge**

1. Toggle "Use self-hosted bridge"
2. Enter your bridge URL (e.g. `https://bridge.yourdomain.com`)
3. Generate the shared secret, copy it into your `.env` as `JOELY_SHARED_SECRET`
4. Restart the bridge, then click "Test connection"

## Security model

- Every request from Joely is signed with **HMAC-SHA256** over `timestamp + method + path + body-hash`, with a 5-minute anti-replay window
- Signatures are compared in constant time
- The bridge exposes **only** the 13 routes Joely needs (see `src/routes/`); everything else is 404
- Customer PII (`customer.email`, `customer.ip`, `customer.username`) is stripped from Checkout payment responses — see `src/utils/sanitize.ts`
- The bridge never logs request bodies, headers, or key material — only `METHOD /path -> status`

## Routes

| Bridge route | Proxies to |
|--------------|-----------|
| `GET /v1/health` | — (public liveness check) |
| `GET /v1/auth-check` | — (signed no-op, verifies the shared secret) |
| `GET /v1/plugin/information` | `plugin.tebex.io/information` |
| `GET /v1/plugin/user/:userId` | `plugin.tebex.io/user/:userId` |
| `POST /v1/plugin/coupons` | `plugin.tebex.io/coupons` |
| `GET /v1/plugin/coupons/:id` | `plugin.tebex.io/coupons/:id` |
| `POST /v1/plugin/gift-cards` | `plugin.tebex.io/gift-cards` |
| `GET /v1/plugin/gift-cards/:id` | `plugin.tebex.io/gift-cards/:id` |
| `GET /v1/headless/accounts` | `headless.tebex.io/api/accounts/{token}` |
| `GET /v1/headless/categories` | `headless.tebex.io/api/accounts/{token}/categories` |
| `GET /v1/headless/packages` | `headless.tebex.io/api/accounts/{token}/packages` |
| `GET /v1/headless/packages/:id` | `headless.tebex.io/api/accounts/{token}/packages/:id` |
| `GET /v1/checkout/payments/:txnId` | `checkout.tebex.io/api/payments/:txnId` (PII stripped) |
| `GET /v1/checkout/validate` | `checkout.tebex.io/api/payments/tbx-validation-test` |

## Keeping the bridge up to date

When Joely adds new Tebex features, your bridge may need an update to expose the new routes. Joely will surface a clear error if a feature requires a newer bridge version. Update with:

```bash
git pull && npm install && npm run build && npm start
```

## Uptime

If your bridge is down, real-time Tebex features in Joely (transaction lookup, coupon and gift card creation, package refresh) will fail for your store until it is back. Already-synced package data stays available. You own the bridge's uptime — point your monitoring at `GET /v1/health`.

## Development

```bash
npm install
npm run dev        # watch mode
npm test           # vitest
npm run typecheck
```

## License

MIT
