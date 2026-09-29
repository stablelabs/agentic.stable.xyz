# Accept agent payments

Run the reference invoice seller independently from the website. The entry point reuses the site's quote, payment-verification, and extraction modules. It serves only the owned synthetic sample, with no uploads or arbitrary URLs.

## Start a seller

```sh
npm ci
cp .env.example .env
```

```ini
PAYMENTS_ENABLED=true
PUBLIC_ORIGIN=http://localhost:8788
STABLE_RPC_URL=https://rpc.testnet.stable.xyz
SELLER_ADDRESS=<your nonzero testnet recipient>
SELLER_PORT=8788
SELLER_DATABASE_PATH=./data/seller.sqlite
PRICE_USDT0=0.01
MAX_FEE_USDT0=0.01
```

The standalone seller does not require a funding key or session encryption key.

```sh
npm run check:network
npm run seller
```

Use a separate `.env` or shell environment for the website when its origin is different. Set the buyer's `SELLER_URL` to this origin. Host the seller behind HTTPS and persist its database before sharing a remote URL.

## Protocol

All routes are under `/api/seller/v1`. Requests and responses use JSON. Obtain a one-use, expiring nonce from `POST /challenge` with `{address}`. Sign the returned scoped message using that wallet, then exchange it through `POST /authenticate` with `{challengeId,signature}`. Use the returned token in `Authorization: Bearer ...`. Tokens expire after 30 minutes; reauthentication retains ownership of old orders.

`POST /quotes` accepts `{serviceId:"invoice-extract",sampleId:"sample-invoice-01"}` and a UUID `Idempotency-Key`. The response binds payer, payee, asset, exact price, fee ceiling, service, sample, and expiry in a SHA-256 digest. Native transfer calldata must contain that digest as 32 bytes. No smart contract deployment is required.

`POST /orders/:id/redeem` accepts `{txHash}`. The seller independently verifies RPC chain identity, transaction sender/recipient/value/calldata, successful receipt, canonical block, and confirmation depth. It atomically consumes the transaction for one order. A transaction hash alone cannot retrieve someone else's result.

`GET /orders/:id` retrieves the authenticated wallet's order, persisted receipt, and result if available. Retrying redeem verifies the same payment and returns the same persisted result. It cannot authorize another payment.

## Deployment limits

This is a single-process SQLite reference service, with an OS-released database ownership lock. Do not replicate it across hosts, use a network filesystem, or share its database between processes. A horizontally scaled service needs redesigned transactional coordination. This native-transfer protocol is not x402. Only the included buyer has been designed for this protocol.
