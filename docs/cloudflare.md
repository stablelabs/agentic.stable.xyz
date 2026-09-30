# Cloudflare deployment

Status: the Worker and SQLite-backed Durable Object adapter are implemented and locally tested. No Cloudflare deployment or DNS change has been made yet. The existing login lacks required permissions; its OAuth refresh timed out awaiting browser approval.

## Runtime

Cloudflare serves the built frontend as Worker assets. Payment API requests go through a private binding to a Durable Object that exclusively owns this deployment's funding-wallet ledger. It uses the same SQL schema, Express routes, transaction rules, seller and payment engine as the Node application. Synchronous storage transactions reserve budgets atomically. Explicit storage flushes complete before transaction broadcast. Durable alarms continue reconciliation without relying on a running browser or Node interval.

This adapter does not store SQLite on a container filesystem. Keep the `funding-wallet-v1` object identity and its storage across deployments. Do not create another object/Worker using the same funding signer, delete its storage, or restore an old ledger without reconciling on-chain activity.

## Local validation

Use Node 22 or newer. The normal Node development server can continue to use the existing local setup. Cloudflare's CLI requires the newer runtime.

```sh
npm ci
npm run build
npm run cloudflare:types
npm run cloudflare:check
npm run test:cloudflare
npx wrangler deploy --dry-run
```

For local Worker development create an ignored `.dev.vars` containing only:

```ini
PAYMENTS_ENABLED=false
FUNDING_PRIVATE_KEY=
SESSION_ENCRYPTION_KEY=
SELLER_ADDRESS=
```

This prevents Wrangler from loading the funded Node `.env` during local runtime tests. Run `npx wrangler dev --local --port 8790`. The fixture harness uses fake transfers only and verifies actual Durable Object SQLite persistence across a complete runtime restart. Fixtures are not imported by the deployment entry point.

## Release sequence

1. Refresh the logged-in account with `npx wrangler login` and approve Cloudflare's consent page. Verify the intended account with `npx wrangler whoami`.
2. Inspect account and stable.xyz zone access. Do not overwrite an existing agentic.stable.xyz DNS record or route without checking its owner.
3. Deploy the Worker with payments disabled using `npm run deploy:cloudflare`. Verify static content, guides, API errors, and persistence before adding secrets.
4. Stop local use of the funding signer and reconcile every pending local transaction. Migrate accounting or reconcile the hosted funding cap against the amount already allocated locally. The provisional hosted cap of 7 test USDT0 must be rechecked; it is not permission to reset a spent cap.
5. Store only FUNDING_PRIVATE_KEY, SESSION_ENCRYPTION_KEY and SELLER_ADDRESS using Wrangler secret commands or its secure bulk input. Never upload BUYER_PRIVATE_KEY. Never pass secrets as command arguments or commit them. Secret changes and funding signers require operator-controlled cutover.
6. Configure the verified public origin and custom domain, enable payments, then repeat live browser/API/standalone acceptance from the deployed source. Keep the same object identity through every deployment.

Production configuration begins with payments disabled. Do not claim this is a working hosted purchase flow until the hosted live tests pass. The source repository remains private.

## Rollback

Disable new purchase/session authorization if readiness or accounting checks fail. Preserve the Durable Object and its signing state and continue reconciliation of already signed transactions. Do not erase storage or start a fresh funding object. Roll back Worker code only to a version compatible with the durable schema, then verify receipts and reservations before re-enabling new work.

The parent workspace requests Stripe Projects for providers. Its Cloudflare catalog returned no deployable services, and no Stripe project was initialized. Wrangler uses the user's existing Cloudflare login; no new paid subscription was provisioned.
