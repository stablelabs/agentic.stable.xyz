# Cloudflare deployment

Status: deployed on 2026-09-30 at https://agentic-stable.angela-f4b.workers.dev in the owner's existing Cloudflare account. The SQLite-backed Durable Object, assets, testnet funding, settlement, and invoice delivery are live. A browser purchase and reload recovery passed. No custom-domain DNS change was made.

The existing Wrangler login successfully deployed when the browser-verified account ID was supplied explicitly; broader OAuth authorization was not required. Only FUNDING_PRIVATE_KEY, SESSION_ENCRYPTION_KEY, and SELLER_ADDRESS were uploaded as Worker secrets. BUYER_PRIVATE_KEY remains local.

At signer cutover, the local server was stopped and local `.env` payments were disabled. All four local funding transactions were independently verified as settled. The local ledger had reserved 4.04 test USDT0, so the hosted lifetime funding cap is 5.96, preserving the original combined cap of 10. Never increase or reset either allowance without operator approval and reconciliation. This is a small, exhaustible demo allowance, not unlimited public funding.

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

1. Verify the logged-in account with `npx wrangler whoami` and the dashboard. This deployment pins the verified account ID in wrangler.jsonc; do not request broader OAuth scopes merely because account listing is unavailable.
2. Inspect account and stable.xyz zone access. Do not overwrite an existing agentic.stable.xyz DNS record or route without checking its owner.
3. Deploy the Worker with payments disabled using `npm run deploy:cloudflare`. Verify static content, guides, API errors, and persistence before adding secrets.
4. Stop local use of the funding signer and reconcile every pending local transaction. Migrate accounting or reconcile the hosted funding cap against the amount already allocated locally. The current 5.96 cap is already net of 4.04 allocated locally; it is not permission to reset a spent cap.
5. Store only FUNDING_PRIVATE_KEY, SESSION_ENCRYPTION_KEY and SELLER_ADDRESS using Wrangler secret commands or its secure bulk input. Never upload BUYER_PRIVATE_KEY. Never pass secrets as command arguments or commit them. Secret changes and funding signers require operator-controlled cutover.
6. Configure the verified public origin, enable payments only after operator approval, then repeat live browser/API/standalone acceptance from the deployed source. The current origin is the workers.dev URL. A future custom-domain cutover requires checking zone ownership and changing PUBLIC_ORIGIN together. Keep the same object identity through every deployment.

The initial deployment had payments disabled; the owner subsequently approved activation. The hosted browser purchase delivered invoice DEMO-001 and recovered the same receipt after reload: https://testnet.stablescan.xyz/tx/0xc410c6184e8c9f7268bd1eaa2ee023d20838f08f5cb32611ef550853d7ffe854. Service price was 0.01 and actual fee was 0.0002228 test USDT0. The source repository remains private.

Hosted testing exposed an Express/Worker response-encoding issue for large JSON. Worker API mode now delegates compression to Cloudflare; the local runtime regression checks a completed response above the compression threshold through the actual Node HTTP bridge. The first hosted API smoke attempt failed parsing its response; it is not recorded as a passing API acceptance run. Do not retry that purchase by creating a new intent or reset its ledger.

## Verification update, 2026-10-01

The full post-fix hosted API smoke test passed: run `7b6ea678-3abe-4567-9b49-b8384b6e7fc8`, transaction https://testnet.stablescan.xyz/tx/0x13635526a6405587ef81b33860c5f7caa0e9e6a2dca92876ced21b5732df03e8. Duplicate authorization and resume returned the same purchase and receipt, and the explorer resolved successfully. Evidence is in `evidence/live/7b6ea678-3abe-4567-9b49-b8384b6e7fc8.json`.

The logged-in account's Domains overview contains no DNS zones. To attach agentic.stable.xyz, an operator with the stable.xyz zone must authorize the route/custom-domain setup. Inspect existing records before changing anything, configure the Worker domain and PUBLIC_ORIGIN together, and verify HTTPS, origin restrictions, and canonical metadata afterward. The workers.dev origin remains the verified deployment; no DNS change or repository visibility change has been made.

## Rollback

Disable new purchase/session authorization if readiness or accounting checks fail. Preserve the Durable Object and its signing state and continue reconciliation of already signed transactions. Do not erase storage or start a fresh funding object. Roll back Worker code only to a version compatible with the durable schema, then verify receipts and reservations before re-enabling new work.

The parent workspace requests Stripe Projects for providers. Its Cloudflare catalog returned no deployable services, and no Stripe project was initialized. Wrangler uses the user's existing Cloudflare login; no new paid subscription was provisioned.
