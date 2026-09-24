# Tebex Bridge

Self-hosted bridge that securely connects Tebex to [Joely](https://joely.io) while keeping your API keys on your own server.

## Why

By default, Joely stores your Tebex API keys encrypted (AES-256-GCM envelope encryption) on its own servers. If you prefer your keys to **never leave your infrastructure**, run this bridge instead:

1. Your Tebex keys live in this bridge's `.env`, on your server
2. Joely calls your bridge — never the Tebex API directly
3. The bridge proxies requests to Tebex and **strips customer PII** (name, email, IP, address, player profile) from payment and customer lookup responses before they reach Joely

The whole bridge is ~400 lines of TypeScript. Audit it yourself: every route it exposes is listed below, and any other path returns 404 — it cannot be used as an arbitrary Tebex proxy.

## Setup

### 1. Configure

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `TEBEX_PUBLIC_KEY` | Yes | Headless API — store info, categories, packages |
| `JOELY_SHARED_SECRET` | Yes | HMAC secret, generated in the Joely dashboard |
| `TEBEX_GAME_SERVER_SECRET_KEY` | No | Plugin API — payment lookup, coupons, gift cards, manual payments |
| `TEBEX_PRIVATE_KEY` | No | Checkout API — transaction details (the store ID is resolved automatically from your public key) |
| `PORT` | No | Listen port (default 3000) |

Optional keys only disable their feature: without `TEBEX_GAME_SERVER_SECRET_KEY`, coupon / gift-card / manual-payment features simply won't work in Joely.

On startup, the bridge verifies each configured key against the Tebex API and logs one `✓` / `✗` line per key (public key, Checkout private key, game server secret key), so an invalid or mistyped key is visible immediately instead of failing on the first real request.

### 2. Run

**Docker:**

```bash
docker build -t tebex-bridge .
docker run -d --env-file .env -p 3000:3000 tebex-bridge
```

**Node 20+** (no pnpm yet? run `corepack enable` once — it ships with Node):

```bash
pnpm install
pnpm build
pnpm start
```

### 3. Expose over HTTPS

Put the bridge behind a reverse proxy (Caddy, nginx, Cloudflare Tunnel) with a valid TLS certificate. **Never expose it over plain HTTP** — the HMAC protects authenticity, not confidentiality.

### 4. Connect in Joely

In your Joely dashboard: **Settings → Tebex → your store → Self-hosted bridge**

1. Toggle "Use self-hosted bridge"
2. Enter your bridge URL (e.g. `https://bridge.yourdomain.com`)
3. Generate the shared secret, copy it into your `.env` as `JOELY_SHARED_SECRET`
4. Restart the bridge, then click "Test connection"

## What the bridge sends to Joely

The bridge is a proxy: it forwards Tebex's responses to Joely. On the routes that carry buyer PII, it first runs the JSON sanitizer (`src/utils/sanitize.ts`) to drop fields Joely never uses. Joely only consumes transaction data (ids, prices, statuses, currency, product names) and the buyer's webstore username — nothing that identifies the person.

**`GET /v1/checkout/payments/:txnId`** (Checkout API — order detail) — `sanitizePayment()`:

| Tebex field | Sent to Joely? |
|-------------|----------------|
| `customer.username` (webstore username) | ✅ kept |
| `customer.first_name`, `last_name`, `email`, `ip`, `country`, `postal_code`, `marketing_consent` | ❌ stripped |
| `products[].username` (gift recipient) | ❌ stripped |
| everything else (txn id, status, prices, currency, product names, dates, fees…) | ✅ passes through |

**`GET /v1/plugin/user/:userId`** (Plugin API — purchase history) — `sanitizeUserLookup()`:

| Tebex field | Sent to Joely? |
|-------------|----------------|
| `payments[]` (txn id, time, price, currency, status) | ✅ kept |
| `player` (player profile), `banCount`, `chargebackRate`, `purchaseTotals` | ❌ stripped |

**`GET /v1/plugin/payments/:transaction`** (Plugin API: payment by transaction id, fallback when the Checkout API cannot find it), sanitized by `sanitizePluginPayment()`:

| Tebex field | Sent to Joely? |
|-------------|----------------|
| `player.name` (webstore username) | ✅ kept |
| `player.id`, `player.uuid`, `email`, `ip` | ❌ stripped |
| everything else (id, amount, status, currency, gateway, packages, notes, dates…) | ✅ passes through |

Only successful responses are sanitized. A Tebex error (404 for an unknown transaction included) is passed through with its original status and body, and an id outside `[A-Za-z0-9_-]{1,64}` is refused with a `400 INVALID_TRANSACTION_ID` without ever reaching Tebex.

**Payment link baskets** (Headless `POST /v1/headless/baskets`, `GET /v1/headless/baskets/:ident`, `POST .../packages`, `POST .../packages/remove`), sanitized by `sanitizeHeadlessBasket()`:

| Tebex field | Sent to Joely? |
|-------------|----------------|
| `ident`, `complete`, `username`, `username_id` (the Cfx.re account the buyer logged in with), `packages[].id`, `packages[].name` | ✅ kept |
| everything else (`email`, `ip`, `address`, `custom`, coupons, gift cards, links, `packages[].in_basket` with any gift recipient…) | ❌ stripped |

**Checkout baskets** (`GET /v1/checkout/baskets/:ident`, `POST /v1/checkout/baskets/:ident/sales`), sanitized by `sanitizeCheckoutBasket()`:

| Tebex field | Sent to Joely? |
|-------------|----------------|
| `ident`, `complete`, `payment.status`, `links.payment` (the transaction link) | ✅ kept |
| everything else (customer details, address, items, totals, other payment and link fields…) | ❌ stripped |

The auth links of a basket (`GET /v1/headless/baskets/:ident/auth`) carry no buyer data and pass through unmodified.

The sanitizer **never mutates** the upstream object — it returns a copy, so a parsing bug can only ever drop fields, never expose more than intended. The Checkout customer block is an **allowlist** (only `username` survives, so any new PII field Tebex adds is removed by default); the Plugin lookup is a **denylist** (the four behaviour/profile fields are removed, so new non-PII fields pass through automatically); the Plugin payment lookup combines both (`email` and `ip` are removed, and `player` is an allowlist where only `name` survives); the basket sanitizers are **allowlists** end to end.

**All other routes pass through unmodified** because they carry no buyer PII: store information, the package catalog (Headless API), the basket auth links, and coupons / gift cards / manual payments (which Joely itself creates). See the [Routes](#routes) table.

## Security model

- Every request from Joely is signed with **HMAC-SHA256** over `timestamp + method + path + body-hash`, with a 5-minute anti-replay window
- Signatures are compared in constant time
- The bridge exposes **only** the 26 routes Joely needs (see `src/routes/`); everything else is 404
- Customer PII is stripped before responses leave the bridge — see [What the bridge sends to Joely](#what-the-bridge-sends-to-joely) above and `src/utils/sanitize.ts`
- The bridge never logs request bodies, headers, or key material — only `METHOD /path -> status`

## Routes

| Bridge route | Proxies to |
|--------------|-----------|
| `GET /v1/health` | — (public liveness check) |
| `GET /v1/auth-check` | — (signed; verifies the shared secret and reports the startup key check as `keys: { public, private, game }` booleans) |
| `GET /v1/plugin/information` | `plugin.tebex.io/information` |
| `GET /v1/plugin/user/:userId` | `plugin.tebex.io/user/:userId` (PII stripped) |
| `POST /v1/plugin/coupons` | `plugin.tebex.io/coupons` |
| `GET /v1/plugin/coupons/:id` | `plugin.tebex.io/coupons/:id` |
| `DELETE /v1/plugin/coupons/:id` | `plugin.tebex.io/coupons/:id` (revoke a coupon) |
| `POST /v1/plugin/gift-cards` | `plugin.tebex.io/gift-cards` |
| `GET /v1/plugin/gift-cards/:id` | `plugin.tebex.io/gift-cards/:id` |
| `DELETE /v1/plugin/gift-cards/:id` | `plugin.tebex.io/gift-cards/:id` (void a gift card) |
| `GET /v1/plugin/payments/fields/:packageId` | `plugin.tebex.io/payments/fields/:packageId` |
| `GET /v1/plugin/payments/:transaction` | `plugin.tebex.io/payments/:transaction` (PII stripped) |
| `POST /v1/plugin/payments` | `plugin.tebex.io/payments` (manual payment, delivers packages) |
| `GET /v1/headless/accounts` | `headless.tebex.io/api/accounts/{token}` |
| `GET /v1/headless/categories` | `headless.tebex.io/api/accounts/{token}/categories` |
| `GET /v1/headless/packages` | `headless.tebex.io/api/accounts/{token}/packages` |
| `GET /v1/headless/packages/:id` | `headless.tebex.io/api/accounts/{token}/packages/:id` |
| `POST /v1/headless/baskets` | `headless.tebex.io/api/accounts/{token}/baskets` (payment links, PII stripped) |
| `GET /v1/headless/baskets/:ident` | `headless.tebex.io/api/accounts/{token}/baskets/:ident` (PII stripped) |
| `GET /v1/headless/baskets/:ident/auth` | `headless.tebex.io/api/accounts/{token}/baskets/:ident/auth` (forwards `returnUrl` only) |
| `POST /v1/headless/baskets/:ident/packages` | `headless.tebex.io/api/baskets/:ident/packages` (PII stripped) |
| `POST /v1/headless/baskets/:ident/packages/remove` | `headless.tebex.io/api/baskets/:ident/packages/remove` (PII stripped) |
| `GET /v1/checkout/payments/:txnId` | `checkout.tebex.io/api/payments/:txnId` (PII stripped) |
| `GET /v1/checkout/validate` | `checkout.tebex.io/api/payments/tbx-validation-test` |
| `GET /v1/checkout/baskets/:ident` | `checkout.tebex.io/api/baskets/:ident` (payment proof only) |
| `POST /v1/checkout/baskets/:ident/sales` | `checkout.tebex.io/api/baskets/:ident/sales` (payment proof only) |

Every id taken from the path (`:id`, `:userId`, `:packageId`, `:transaction`, `:txnId`, `:ident`) must match `[A-Za-z0-9_-]{1,64}`; anything else is refused with a 400 and never reaches Tebex. Any other route answers 404 with `{"error":"ROUTE_NOT_FOUND"}`, which Joely reports as "update your bridge". The same list lives in [`routes.json`](routes.json): the tests keep it in sync with `src/routes/`, and Joely checks its own calls against it.

## Keeping the bridge up to date

When Joely adds new Tebex features, your bridge may need an update to expose the new routes. Joely will surface a clear error if a feature requires a newer bridge version. Update with:

```bash
git pull && pnpm install && pnpm build && pnpm start
```

## Uptime

If your bridge is down, real-time Tebex features in Joely (transaction lookup, coupon and gift card creation, package refresh) will fail for your store until it is back. Already-synced package data stays available. You own the bridge's uptime — point your monitoring at `GET /v1/health`.

## Development

```bash
pnpm install
pnpm dev           # watch mode
pnpm test          # vitest
pnpm typecheck
```

## License

GNU AGPL v3
