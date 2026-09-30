# Acceptance record

Local implementation is built and tested. Live API, browser, standalone seller/buyer, and coding-agent purchases passed on 2026-09-29. Cloudflare publication and a hosted browser purchase passed on 2026-09-30. Fresh-checkout live release acceptance remains outstanding. This is not a full public-release certification.

## Confirmed network metadata

Read-only check on 2026-09-28 verified Stable Testnet chain 2201 at block 70725055 using published `@stablechain/sdk@1.0.8` and viem. Native USDT0 uses 18 decimals. The SDK's testnet ERC-20 view reports 6 decimals and the symbol USD₮0. The explorer is https://testnet.stablescan.xyz.

## Automated checks

29 backend tests pass: session reuse, explicit purchase authorization, idempotency conflicts, cumulative budgets, concurrent-run exclusion, one-time quote consumption, quote expiry/change, insufficient balance, unknown-payment recovery, reverted-payment fees, delivery retry, session expiry/isolation, one-time payment evidence, funding caps/rates, encryption, and source validation. Additional tests verify transaction chain/payer/payee/value/input, confirmation depth, canonical blocks, signed challenges, cookie restrictions, mutation origins, database process ownership, and signed-state durability before broadcast. These use an explicitly fake chain and are not live-testnet evidence.

24 Playwright checks pass, covering all run statuses, explicit authorization, lost-response idempotency, JSON download, analytics deduplication, close/reopen recovery, quote expiry, funding, rate-limit timing, budget/balance rejection, keyboard focus return, no-JavaScript content, guides, and responsive layouts. Viewports include 1440x900, 390px, 320px, and 720x450. Native Chrome zoom was separately verified at 200%: the landing page remained legible and the dialog scrolled to its lower controls while retaining its close button. Zoom was restored to 100% afterward. Tested accessibility scans found no serious or critical axe violations.

Type checking and production build pass. An independent Docker build installed from the lockfile on Linux/Node 22, built the full project, and passed the then-current 28 backend tests. A temporary production-mode container served the root and guides with payments explicitly disabled. The production origin emitted the correct canonical link; the local/staging origin remains noindexed. Compose configuration validates. The later Cloudflare publication is recorded below.

A Lighthouse 12.8.2 mobile simulation against the built local server measured performance 100, accessibility 100, and best practices 100, with FCP 1.3 seconds, LCP 1.7 seconds, and CLS 0. SEO scored 63 solely because staging is deliberately noindexed. These are one-run local measurements, not guarantees for a deployed service or every device.

The production dependency audit reported zero vulnerabilities. Production bundle scanning found no private configuration names, signing implementation, or fake transaction identifiers. The production build rejects fixture environments; browser fixture data lives only under tests and carries a visible preview label with no live explorer link.

Machine-readable results and screenshots are saved under `evidence/`. Fixture screenshots never represent real settlement.

## Requirement map

| Gate | Evidence and remaining work |
|---|---|
| W1 | Desktop fold test and screenshot prove headline, preview, actions, and full footer fit at 1440x900. The owner supplied the private stablelabs/agentic.stable.xyz GitHub destination. |
| W2 | Backend and browser tests prove opening does not purchase and only the Run action authorizes a quote. |
| W3 | Funded live API and browser purchases completed with verified settlement and actual seller output; receipts are under evidence/live. |
| W4 | Atomic idempotency, nonce ownership, persisted signed transactions, retry/reopen tests. Live API duplicate/resume returned the same purchase; live browser reopen and reload made no new purchase request. |
| W5 | All run states, quote/budget/balance rejection, funding/outage and rate-limit behaviors exercised with fixtures or disabled dependencies. |
| W6 | Ledger, fee, reservation and receipt tests pass. Independent RPC verification matches all three receipts and the two session budgets. Price was 0.01 and actual fee was 0.0002228 USDT0 per tested purchase. |
| W7 | Live browser downloaded JSON equals delivered output, with the actual receipt URL rendered. All three explorer URLs resolved successfully. |
| W8 | Codex followed the owned buyer skill: recover first, explicitly purchase from the separate seller on port 8788, then recover the same settled receipt without --new. Tested host versions and evidence are below. |
| W9 | Keyboard, focus return, reduced-motion, contrast scans, desktop/mobile, equivalent zoom layout, and native Chrome 200% zoom checked. |
| W10 | Server-only signing and encrypted keys; bundle scan clean; production fixture rejection implemented. |
| W11 | Staging and production root metadata checked; guides serve; analytics deduplicated. The configured source URL identifies the owner-supplied private repository; anonymous source access and deployed metadata remain release gates. |
| W12 | Independent Node 22 container build/tests passed without other source projects. Funded flows passed from this working tree; a combined clean-source live release check remains outstanding. |

## Live evidence, 2026-09-29

Following the user's funding configuration and confirmation, three real extraction purchases completed on Stable Testnet (chain 2201). The API and browser tests each funded a separate session with 1 test USDT0. The standalone buyer used its separate operator-funded wallet. Each extraction cost 0.01 test USDT0 plus 0.0002228 test USDT0 in network fees. No mainnet payment was made.

Read-only verification in evidence/live/chain-verification.json independently checks chain identity, successful receipts, payer, payee, transfer value, actual gas fees, canonical blocks, session spent/reserved/remaining budgets, and successful explorer responses for all three payments.

| Path | Evidence | Transaction |
|---|---|---|
| API, duplicate request, resume | evidence/live/c1fe91f2-daa0-4fcf-ad0c-b04eea40d744.json | 0x962456109457ceab5a4a6b696ab74b8d304999dbe4be27812072f0652beb07dd |
| Browser, JSON download, reopen, reload | evidence/live/browser.json and browser screenshots | 0xa03d67caf59df1e4939c2533b9c781ec91df69b4442468f23e76eb0eb133a5b8 |
| Standalone buyer/seller and agent host | evidence/live/standalone-buyer.json | 0xffcb0db26213ea362df90a8e0b66f487c8962a644feb2dc8a472b67288b250d7 |

The real coding-agent host was Codex in the desktop application version 26.924.22138, using its bundled codex-cli 0.158.0-alpha.2.1. The agent read examples/agent-buyer/SKILL.md and docs/agent-setup.md, ran the network check, invoked `npm run buyer` (no existing purchase), then `npm run buyer -- --new`, then `npm run buyer` again. The latter returned the identical completed receipt. This records an actual agent tool invocation, not a separate autonomous agent session or an LLM-backed website runner.

Secrets were moved from the edited example template into ignored, mode-600 .env configuration without displaying them. The public .env.example was restored to blank credential values. Never commit the private configuration or signing databases.

## Outstanding release gates

Cloudflare deployment on 2026-09-30 uses a shared SQL ledger and a SQLite-backed Durable Object at https://agentic-stable.angela-f4b.workers.dev. Existing credentials worked with an explicit, browser-verified account ID. The owner approved uploading the three required Worker secrets and activating capped testnet payments. Local funding was stopped, local payments disabled, and all local funding receipts reconciled; the hosted cap is 5.96 test USDT0 after 4.04 already reserved locally. No DNS changes were made.

The hosted browser purchase delivered the invoice and recovered the same transaction after reload: https://testnet.stablescan.xyz/tx/0xc410c6184e8c9f7268bd1eaa2ee023d20838f08f5cb32611ef550853d7ffe854. Independent RPC checks verified chain 2201, successful canonical receipt, seller, 0.01 value, and 0.0002228 actual fee; the explorer returned 200. The browser showed 0.0397772 remaining and zero reserved from its 0.05 budget. Evidence is in evidence/cloudflare-hosted.json and evidence/cloudflare-hosted-result.png.

The first hosted API smoke attempt exposed a large-JSON response encoding problem and did not pass. Express compression is now disabled in Worker API mode so Cloudflare owns encoding. The local runtime regression covers large completed JSON through the actual HTTP bridge, along with fake-chain transactions, idempotency, recovery, and full-runtime-restart persistence. The later hosted browser purchase passed with the fix. There are now 29 passing backend tests, including the signed-state durability boundary.

W12 still requires a clean-source full-stack live run in the release environment; the independent clean Node 22 image build and backend suite passed earlier, and live flows passed from this working tree, but these are separate evidence. Do not claim they prove the combined clean-checkout live gate.

The owner supplied https://github.com/stablelabs/agentic.stable.xyz, verified as an empty private repository before the initial publication. Its visibility has not been changed. Public source access requires a separate owner decision.

The workers.dev deployment and hosted browser payment flow are verified. Custom-domain DNS mapping, a full post-fix hosted API smoke run, and clean-source live release acceptance remain outstanding. Stripe Projects reports no initialized project and no deployable Cloudflare catalog service; deployment used Wrangler with the existing login.
