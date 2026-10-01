# Deployment

For the live Cloudflare deployment, use the [Cloudflare guide](/docs/cloudflare/). The site runs at https://agentic-stable.angela-f4b.workers.dev with verified hosted browser and API purchases. The Node/Docker deployment below remains supported.

Run the API and built frontend together as one Node 22 process, backed by a durable local volume. The supplied Dockerfile and Compose configuration preserve SQLite state. This is not a static-only deployment.

```sh
npm ci
npm run build
NODE_ENV=production npm start
```

Set `PUBLIC_ORIGIN` to the actual HTTPS site origin, plus the private funding and encryption configuration in `.env.example`. Route HTTPS traffic through the supplied Caddy configuration. All browser API routes remain under `/api/agentic/v1` on that same origin. Do not add credentialed wildcard CORS or cache session responses.

## Durable state and limits

Mount `/app/data` as a persistent local volume. Run one API replica only. The SQLite ownership lock prevents concurrent processes signing from the same database. Back up the database with the SQLite backup API and keep the encryption key separately protected. Restoring an old database snapshot while transactions are still in flight requires manual on-chain reconciliation before enabling spending.

The funding cap includes each session's funding amount and maximum funding fee. It is lifetime cumulative and conservative: unused funding allowances are not automatically recycled. A single pending funding transaction blocks new funding nonces until reconciled. Session expiry does not stop reconciliation of submitted payments. Idempotency and payment evidence are retained indefinitely, exceeding the seven-day minimum.

The funding wallet must be dedicated to this process; do not use it from another wallet or application. Changing that signer's nonce externally can require operator reconciliation. Unknown transactions keep reservations and never trigger a new transfer.

## Origin, rate limits, and health

Set the reverse proxy so the application cannot be reached directly. The application currently uses the direct peer IP, not arbitrary forwarded headers. Behind Caddy, the funding rate limit is conservatively shared by all visitors. Add a specifically trusted proxy configuration and test spoofing resistance before changing that behavior.

`GET /api/health` returns 200 only when live payments are enabled and chain verification succeeds, otherwise 503 with separate database and chain flags. This is readiness; the web page remains available when payments are not. Never substitute fixtures when dependencies fail.

Staging is noindexed. The root response includes the canonical URL only when `PUBLIC_ORIGIN=https://agentic.stable.xyz`. DNS must be explicitly mapped and verified before claiming the domain is live.

## Hosting prerequisites

The parent workspace instructions require the Stripe Projects CLI for provider provisioning. Its Cloudflare catalog offered no deployable service, so this deployment used Wrangler with the owner's existing Cloudflare login and SQLite-backed Durable Objects. The account's Domains overview was checked on 2026-10-01 and contains no zones; custom-domain authorization is still needed.

Required before public launch: dedicated funded testnet wallet, protected encryption key, verified seller recipient, persistent host and backups, TLS, authorized domain mapping, a published repository URL, and passing live acceptance evidence. See [acceptance](/docs/acceptance/).

## Analytics and handoff

Analytics is optional. An approved first-party integration can provide `window.agenticAnalytics(event, properties)`. No analytics credentials are embedded. Events include demo opening, session readiness, quote views, run starts, settlement, delivery, errors, guide opens, and setup copies. Settlement and delivery deduplicate by opaque run ID. No wallet address, invoice, cookie, key, or result is emitted. Copying setup indicates intent, not installation.

After release, propose links from the main Stable site, documentation, developer blog, and repository README to this experience. Those other properties have not been modified.
