# agentic.stable.xyz: landing page and real testnet purchase demo

## 1. Outcome

A visitor understands what agents can do on Stable, tries one complete testnet purchase, sees both useful delivery and settlement evidence, and can reproduce that flow using the agent and seller examples included in this website repository.

Create a compact, single-fold landing page with an interactive demo that opens after **Try it out**. Own the entire working experience in this repository: frontend, demo backend, wallet funding, budget enforcement, paid reference service, payment verification, result delivery, and a small reproducible agent example. This project must build, pass acceptance, and ship even if a separate payments-toolkit project never ships.

### Audience and next steps

| Visitor | Question | Next step |
|---|---|---|
| Curious developer or partner | What can an agent actually do here? | Try it out on testnet |
| Agent user/builder | How do I give my agent this ability? | Use with your agent |
| API/digital-service developer | How do I let agents buy from me? | Accept agent payments |

Success is a completed useful paid request and a clear route to reproduction. Page views alone are not the success metric.

## 2. Fixed product decisions

- Headline: **This is how agents settle on Stable.** Emphasize **settle on Stable** through typography/color while preserving readable text and contrast.
- Supporting sentence: **Agents can purchase APIs and digital services using stablecoins on Stable.**
- Primary CTA: **Try it out**. Nearby clarification: **Pre-funded testnet demo. No wallet setup needed.**
- Secondary CTA: **Use with your agent**.
- Tertiary action: **Accept agent payments**.
- Footer links: **Quickstart**, **Agent setup**, **Accept payments**, **GitHub**. Link this project's own working guides and examples. Do not depend on an unreleased external CLI/package or invent live documentation paths.
- Initial viewport communicates one proposition, one example, and the next action. Desktop target: headline, supporting sentence, compact demo preview, actions, and footer visible at 1440×900 without artificial text shrinking. On narrow screens allow natural scrolling; accessibility and legibility take priority over literal one-screen fit.
- Payment and demo remain testnet-only. No PayPal/PYUSD branding or claims, no requirement to connect a Hub wallet, and no implied mainnet readiness.

## 3. Full-stack scope and ownership

The assigned agent owns every component required to ship this experience: design, frontend, API client, demo API, session funding, signing, durable budget/purchase accounting, paid seller, result delivery, self-contained examples, documentation, analytics, tests, and deployment setup.

Work in a separate website repository with its own manifests and lockfiles. Inspect an existing assigned website stack if one is available; otherwise use a TypeScript full-stack implementation. A React/Vite frontend with a Node API and a persistent database is an acceptable default. Keep backend routes under the same site origin. Choose a host with durable storage or explicitly configure a transactional external store.

Use already available upstream libraries such as viem and the released Stable SDK where appropriate. Do not import an unreleased agent toolkit, call another development project's demo backend, wait for another agent's schema artifact, or copy credentials from the existing MCP deployment. This project owns the internal API appendix and can modify its frontend/backend together.

Keep the demo backend small and specific: one known service/input, one testnet, one payment route, one bounded budget. Do not build a second general-purpose CLI, MCP platform, wallet product, or service marketplace. Reuse established chain libraries instead of writing cryptography. A future toolkit adoption can replace internal adapters after launch; it is optional and does not affect acceptance.

Suggested repository layout:

```text
web/                        # landing page, demo UI, browser client
server/                     # sessions, funding, policies, purchase runner, recovery
server/payments/             # small signer and chain-verification adapters
server/seller/               # runnable paid invoice-extraction service
examples/agent-buyer/        # minimal buyer script/tool and agent skill
examples/paid-service/       # independently runnable seller entry point
docs/                       # this project's quickstart, agent setup, seller guide
tests/                      # backend, UI, failure fixtures, live testnet smoke
```

Fixtures are for development and tests. They may not replace the real testnet backend in the public release.

## 4. Default page and visual direction

Follow Stable's existing brand assets and typography when available. Inspect supplied/local assets or the official site; do not invent a logo or assume an external brand package is licensed for reuse. Use a restrained layout, generous whitespace, and one strong highlight around the headline phrase. Avoid a long stack of hero, features, partners, testimonials, and FAQs.

The demo preview should reveal what happens after clicking without suggesting payment already occurred: an owned sample invoice, a compact “Agent → service → settlement → result” illustration, and “Extract an invoice within a spending budget.” Prices shown before session creation must be explicitly example values or loaded from verified backend data.

Use a panel that expands in place or an accessible dialog for the demo. Maintain page identity, heading, and a clear close/back action. Closing the UI does not cancel a submitted payment. On return, recover the active run instead of silently starting another purchase.

No installation scripts, RPC addresses, contract addresses, raw logs, or internal package diagrams in the initial product flow. Expose technical details through receipt expansion and the developer handoff panels.

## 5. Interactive demo specification

### Fixed first task

**“Extract the vendor, line items, and total from this sample invoice.”**

The service is `invoice-extract`, the input is the owned synthetic `sample-invoice-01`, and delivery is validated structured JSON. Show the sample as an HTML document/card rather than requiring a PDF download. The merchant sells the extraction operation in this reference flow. Label sample data honestly; do not present it as a real user's invoice or proprietary dataset. No uploads, arbitrary URLs, or additional services are required for launch.

### Interaction sequence

1. **Try it out:** create/recover a constrained demo session; show “Preparing your testnet wallet” while funding is pending. Do not begin a purchase solely by opening the panel.
2. **Ready:** show testnet identity, demo budget, sample invoice, and the task. Request a quote and show price, maximum network fee, and maximum total before the spending action.
3. **Run the demo:** one explicit action authorizes this quoted purchase within the displayed session policy. Call `POST /runs` once with a stable idempotency key; disable duplicate submission while recovering any uncertain response.
4. **Progress:** show real backend events: checking budget, submitting payment, confirming settlement, retrieving result. Do not invent transaction hashes, elapsed times, reasoning, or tool activity.
5. **Delivered:** display a readable result table, a JSON view/download, amount paid, actual network fee, remaining budget, and an expandable receipt with explorer link.
6. **Reproduce:** emphasize **Use with your agent**, with **Accept agent payments** alongside it. The next steps must reproduce this project's demo using its included buyer and seller examples.

The v1 backend runner is a bounded deterministic purchase workflow using real tools. Describe it as a sample agent workflow; do not imply an LLM reasoned through choices if none ran. This project must also include and test its own minimal real agent-host integration. A model-backed website runner is an optional later enhancement.

### State-to-UI mapping

| Backend state | UI behavior |
|---|---|
| Session funding | Progress label, no purchase action yet; poll session |
| Session ready | Quote, budget, task, enabled Run the demo action |
| queued / authorizing | Checking purchase permissions; preserve run ID |
| submitted / confirming | Payment submitted / waiting for confirmation; optional actual hash, not a success badge |
| settled / delivering | Payment settled, retrieving result; receipt visible if returned |
| completed | Result and verified receipt; reproduction CTAs |
| blocked | Plain explanation of budget, balance, or quote problem; no success styling |
| payment_unknown | “Checking payment status”; resume/status actions only, no new purchase CTA |
| delivery_failed | “Payment settled; result delivery needs another attempt”; retain receipt, resume same purchase |
| failed | Explain known failure; show any network fee spent; a new purchase requires a new deliberate action after the old result is known |
| expired / unavailable | Explain expiry/outage; do not promise restored funds or fabricate availability |

Quote expiry requires a new quote and renewed visible acceptance. A changed total is never accepted in the background. Poll at a modest interval (e.g. 1–2 seconds while active), back off on errors, stop on completion/unmount, and honor rate-limit retry timing. A local polling timeout is not a payment failure. Event sequence numbers deduplicate updates after reconnect.

## 6. Make the experience reproducible

### Use with your agent panel

Ship a minimal TypeScript buyer script/tool and an agent skill inside this repository. The script calls this project's seller, obtains a quote, enforces an operator-set budget, signs a testnet payment using a local user-controlled signer, and retrieves output/receipt. It must work without the browser demo cookie and without any external unreleased CLI or MCP package.

Provide an exact source-based setup command, wallet/funding instructions, a budget configuration, and a copyable prompt asking an existing coding agent to buy extraction of the sample invoice and return the result/receipt. Test at least one real agent host invoking the example; record the tested version. The agent skill uses only this repository's runnable commands and docs. Keep it an example, not a new general-purpose toolkit.

The browser's wallet stays server-side. The downloadable example uses its own testnet signer and independently authenticated seller requests; never export a demo session's key. Put placeholders in configuration examples and keep real credentials out of docs.

This source-based path is the launch-ready reproduction route. Optional links to existing external tools can be added if verified, but neither npm publication nor another project's new CLI/MCP release is required.

### Accept agent payments panel

Provide a runnable seller entry point and guide in this repository: configure a testnet recipient, expose a quote, verify payment, deliver the extraction result, and retry delivery without charging again. The example may reuse this project's server modules but must run separately from the website UI. Link these owned examples and guides. Do not claim compatibility with arbitrary agents or payment protocols without testing.

Keep the two examples aligned with the actual demo implementation so “Use with your agent” and “Accept agent payments” both work at this project's release.

### Documentation and search discoverability

- Proposed title: **Stable Agentic Payments | Build, Pay & Try on Testnet**.
- Meta description describes the working demo and included agent/seller examples, without unsupported throughput/fee claims.
- Put the headline, description, supported capabilities, and this project's working quickstart links in indexable HTML. The page must still communicate the proposition if JavaScript fails.
- Include a canonical URL for `https://agentic.stable.xyz` only when deployed there. Staging should not claim to be the canonical live site and should be noindexed.
- Include meaningful link text and a small agent-readable setup page or documentation link. Do not publish a separate conflicting copy of SDK documentation.
- Prepare link placements for the main Stable site/docs/blog/repo as a handoff recommendation; modifying those other properties is outside this coding task unless separately assigned.

## 7. Quality, accessibility, and operational requirements

- Keyboard-operable controls, visible focus, correct dialog semantics/focus return, accessible status announcements, and reduced-motion support. No rapidly flashing settlement animation or timer-based fake progress.
- Verify desktop, 390px mobile, narrow 320px layout, and 200% zoom. Do not force the footer into a viewport at the expense of usable content.
- Escape and render result/service text as untrusted data. JSON downloads use delivered validated output. External explorer/doc URLs must use approved HTTPS destinations; no rendering arbitrary HTML from API errors.
- Browser contains no signing code, master tokens, private keys, or model-provider secrets. Session cookies are handled through the same-origin backend proxy; do not add wildcard credentialed CORS.
- Before calling a mutation, validate the intended environment is the live testnet API or an explicitly labeled fixture/local environment. Never fall back silently from backend errors to a success fixture.
- Keep the initial page light; lazy-load demo/developer panels. Suggested quality targets: Lighthouse performance ≥90 in a representative mobile run and no serious accessibility violations, recorded as measurements rather than guarantees about all devices.
- Backend unavailability must leave the narrative and documentation usable, with Try it out explaining temporary unavailability.

### Product analytics

Use the site's existing approved analytics integration if available; otherwise implement a documented optional event adapter without inventing credentials. Events: `demo_opened`, `session_ready`, `quote_viewed`, `run_started`, `payment_settled`, `result_delivered`, `demo_error`, `agent_setup_opened`, `seller_guide_opened`, `setup_copied`.

Count successful delivery from authoritative run state once per run. Do not log wallet addresses, raw invoices/results, cookies, or signing material to analytics. Use opaque run/session correlation only where necessary. Report the funnel from demo start to delivery to reproduction intent; “copy setup” is intent, not proof of installation.

## 8. Independent execution plan

1. **Foundation:** inspect brand context, choose the stack, create this project's API schemas and fixtures, and establish frontend/server/database development commands.
2. **Working payment slice:** build the owned seller and buyer flow, verify chain identity, implement exact amounts, budget reservations, transaction persistence, payment verification, and delivery recovery. Prove a real testnet purchase before considering the demo complete.
3. **Website:** implement the single-fold page, demo states, receipt/result views, accessibility, and responsive layouts against the owned backend.
4. **Reproduction:** finish the small agent buyer/skill and runnable seller example, write guides, and verify both from a fresh checkout without the website UI.
5. **Release candidate:** test abuse controls and recovery, validate all links and analytics, record live testnet receipts, and prepare the full-stack deployment.

The assigned agent owns frontend and backend hosting configuration, persistence, testnet funding setup, and domain mapping instructions. Prepare `agentic.stable.xyz` deployment without assuming DNS access or claiming it is live before verification. Only ordinary external prerequisites such as RPC, testnet funding, hosting credentials, and DNS authorization may block deployment; another coding project's deliverables may not.

Future integration with a broader toolkit is optional follow-up work. It does not require identical schema files, synchronized package releases, matching sample services, cross-repository tests, or another agent's approval for this release.

## 9. Acceptance tests

| ID | Required evidence |
|---|---|
| W1 | Default desktop fold contains the exact narrative, highlighted phrase, meaningful preview, primary CTA, developer paths, and footer |
| W2 | Opening demo provisions/reuses a session but does not buy; only Run the demo starts a purchase |
| W3 | Live demo uses prefunded testnet balance, correct quoted units/fees, and real seller output after verified settlement |
| W4 | Repeated clicks, lost mutation responses, refresh, close/reopen, and repeated polling do not create duplicate runs/payments |
| W5 | All contract failure fixtures produce distinct correct recovery actions; unknown payment cannot restart buying; delivery retry cannot repay |
| W6 | Result, actual fee, remaining budget, and receipt agree with backend; a submitted hash is never labeled completed |
| W7 | JSON download equals delivered output; explorer link resolves to the actual testnet transaction |
| W8 | Both agent setup and seller path use verified instructions; a tester can follow the agent path and reproduce the purchase outside the website |
| W9 | Keyboard, mobile, zoom, reduced motion, focus, contrast, and status announcements verified |
| W10 | Public production build excludes fixture success fallback; no private keys/master credentials in bundle or network payloads |
| W11 | Metadata, canonical/staging behavior, documentation links, and deduplicated analytics events verified |
| W12 | With no other new project checked out or running, a fresh checkout starts the full stack and examples, and completes the real testnet flow using only upstream dependencies and configured funding/RPC |

Automate meaningful flow/state tests and browser checks. Keep fixture tests and live testnet tests separate in reports. If funding/RPC/deployment access blocks W3/W7/W8, finish the independent site work and state the exact blocker; do not mark the whole project complete.

## 10. Handoff

Deliver the site source, setup instructions, `.env.example` with public/private values clearly separated, proxy configuration, fixtures, contract version, browser tests, screenshots of default/demo/result/error/mobile states, verified documentation links, and live testnet run IDs/receipts. Include full-stack deployment/funding instructions and a short list of actual remaining infrastructure prerequisites such as hosting credentials or domain mapping. Package publication is not required.

### Coding-agent kickoff

Implement this PRD as a self-contained full-stack project. Own the frontend, demo backend, paid service, funding/policy/payment logic, and minimal agent/seller examples. Preserve the single-fold concept, exact headline, and three user paths. Keep browser signing keys and budgets server-side; use a separate local signer for the reproducible buyer example. Do not wait for another coding project, import its unreleased packages, or treat fixtures as a real testnet integration. Finish with an independently deployment-ready site and complete acceptance evidence.

## 11. Backend requirements for the owned demo

Implement all of these inside this website project:

- **Funding and sessions:** isolated per-session testnet wallets, capped funding wallet, fixed expiry, one active purchase at a time, rate limits, and a global funding cap. Store signing keys encrypted in private server storage; never expose a reusable funding/signer API to arbitrary browser recipients.
- **Persistence:** a durable transactional database for session ownership, quotes, policy spent/reserved balances, purchases, signed transaction identity, settlement evidence, and delivered results. A single server with persistent SQLite is acceptable; document that it cannot be replicated without redesigning coordination.
- **Native transfer adapter:** use native USDT0 on verified Stable testnet with integer arithmetic. Verify network identity and metadata against the installed SDK and RPC. Do not call a plain transfer flow x402-compatible. Payment protocol expansion is outside this release.
- **Budget enforcement:** reserve quoted price plus maximum fee atomically before signing; include actual fees in spent, release unused reservation only after reconciliation, and keep uncertain transactions reserved. A JavaScript UI budget or agent prompt is not enforcement.
- **Submission recovery:** persist the purchase and signed transaction/hash before broadcast. Serialize nonces per signer. After a crash or timeout, reconcile or rebroadcast that same transaction; do not produce an unrelated new transfer.
- **Seller verification:** independently check successful settlement on the correct chain, payer, payee, asset, amount, and purchase binding. Consume payment evidence once, atomically, so another order cannot claim it. A hash alone is not an access credential. Local buyer examples authenticate quote/result ownership with a wallet-signed challenge and nonce.
- **Delivery:** release the actual validated result only after payment verification. Persist paid entitlement and result so retries do not recharge. The public expected-output fixture does not replace executing the service.
- **Authentication:** same-origin restricted session cookies and Origin checks for browser mutations; no shared MCP credentials. Expired sessions cannot initiate spending. Server reconciliation continues for already submitted transactions.
- **Operational behavior:** funding outages, RPC outages, failed transactions, and failed delivery remain visible and recoverable. Health checks distinguish dependency readiness. Keep fixtures disabled in the public build.

Add backend acceptance cases for concurrent budget exhaustion, duplicate idempotency keys, altered quote terms, wrong payment evidence, crash around broadcast, payment reversion with gas spent, paid-but-undelivered recovery, session isolation, and funding rate limits. The website's success criteria include this backend behavior, not just rendering its states.

## 12. Context and sources

- [Official Stable documentation](https://docs.stable.xyz/) is a technical reference. Confirm current chain/asset configuration from installed upstream libraries and live RPC before testnet writes.
- The existing [Stable MCP source snapshot](https://github.com/stablelabs/mcp/blob/de000877aef660d981fafa1a85b427a1e610d5b0/packages/mcp/src/index.ts) is useful background for USDT0 balance semantics. It is not this site's backend or a prerequisite for this project's implementation. The inspected code distinguishes native and ERC-20 balance views and uses a shared testnet signer; do not expose that deployment to anonymous visitors.
- All product guides, sample code, internal schemas, and demo endpoints required by this PRD are owned and delivered by this project.


## 13. Website-owned internal API baseline — `site-demo/v1`

This proposed internal API belongs entirely to this website repository. The assigned agent implements both producer and consumer, schemas, fixtures, and tests. It may refine the API coherently within this project. No external schema package, service deployment, or other agent delivery is required.

### Ownership and transport

- This project owns the API, schemas, payment semantics, service fulfillment, funding, demo runner, persistence, frontend client, and deployment configuration. Keep one internal payment implementation behind adapters and reuse it for this project's examples.
- Browser base path: `/api/agentic/v1`. Route this path to this project's own backend, preserving cookies and request identifiers. Local development uses the same path through a development proxy. Backend deployment can be independent of the frontend.
- Sessions use an opaque, HttpOnly, Secure, SameSite=Lax cookie, restricted to this API path. HTTPS is required outside localhost. Mutations check the allowed Origin and JSON content type. The browser never receives a funding key, MCP master bearer token, or private signing key.
- `POST /sessions` is public but rate-limited. It creates only a constrained, testnet-only demo session. All other session-specific operations derive ownership from the cookie; never accept a browser-supplied payer or session owner. Unauthorized reads do not reveal another session's existence.
- All responses are JSON, with `Cache-Control: no-store` for session data. Errors have `{error:{code,message,retryable},requestId}`. No stack traces, secrets, or upstream credentials.

### Routes

| Method and path | Request | Response and behavior |
|---|---|---|
| `GET /capabilities` | None; public | `{contractVersion:"site-demo/v1", network:Network, services:Service[], links:Links}`. Indicates live availability; contains no session secrets. |
| `POST /sessions` | `{}`; `Idempotency-Key` | `201 Session`; cookie set. Funding may still be pending. Concurrent/retried provisioning with the same key creates one session and one funding operation. |
| `GET /session` | Cookie | `200 Session`; funding progress and authoritative budget; `401 SESSION_EXPIRED` when expired. |
| `POST /quotes` | `{serviceId:"invoice-extract", sampleId:"sample-invoice-01"}` | `201 Quote`; valid only for this session. No spending or budget reservation yet. |
| `POST /runs` | `{quoteId:string}`; `Idempotency-Key` | `202 Run`; commits the displayed quote under the session's existing budget. Expired/changed quotes return an error without spending. |
| `GET /runs/:runId` | Cookie | `200 Run`; caller's own run only. Includes durable ordered events and receipt/result as available. |
| `POST /runs/:runId/resume` | `{}`; `Idempotency-Key` | `202 Run`; reconciles the SAME purchase or retries delivery. Never creates a new purchase or fresh payment authorization. |

Idempotency keys are random UUIDs generated once per user intent. Persist the key and operation ID across browser reloads, but not credentials. The server binds the key to owner, route, and request digest; conflicting reuse returns `409 IDEMPOTENCY_CONFLICT`. Retain records for at least seven days, beyond session expiry, and never reuse payment nonces. Resuming requires an unexpired owning session. Read polling never initiates a payment. A lost response is recovered by repeating the SAME idempotent mutation or reading the existing run, not generating a new key.

### Types and invariant meanings

```ts
type Network = {
  name: "Stable Testnet";
  chainId: number;                 // verified runtime configuration; never guessed
  explorerBaseUrl: string;         // verified HTTPS URL
};
type Asset = {
  id: string;                      // stable identifier within this deployment
  symbol: "USDT0";
  kind: "native" | "erc20";
  address: string | null;          // null ONLY for native
  decimals: number;
};
type Money = { assetId: string; amountAtomic: string };
// amountAtomic: nonnegative integer string. All arithmetic uses integers.
// Never add native and ERC-20 balance views of the same USDT0 holdings.
type Links = {
  quickstart: string | null;
  agentSetup: string | null;
  sellerGuide: string | null;
  repository: string;
};
type Service = {
  id: "invoice-extract";
  name: string;
  description: string;
  sampleIds: ["sample-invoice-01"];
  available: boolean;
};
type Session = {
  id: string;
  mode: "testnet";
  status: "funding" | "ready" | "unavailable" | "expired";
  expiresAt: string;               // ISO 8601 UTC
  network: Network;
  asset: Asset;
  walletAddress: string;
  balance: Money;                  // one canonical asset view, not a sum
  budget: { limit: Money; spent: Money; reserved: Money; remaining: Money };
  activeRunId: string | null;
};
type Quote = {
  id: string;
  serviceId: "invoice-extract";
  sampleId: "sample-invoice-01";
  expiresAt: string;
  network: Network;
  asset: Asset;
  payee: string;
  price: Money;
  maxNetworkFee: Money;
  maxTotal: Money;                 // price + maximum fee; same asset in v1
  requestDigest: string;           // binds input, service, payer, and terms
};
type RunStatus = "queued" | "authorizing" | "submitted" | "confirming"
  | "settled" | "delivering" | "completed" | "blocked"
  | "failed" | "payment_unknown" | "delivery_failed";
type RunEvent = {
  seq: number;                    // strictly increasing within run
  at: string;
  status: RunStatus;
  message: string;                // factual action/status; not fabricated reasoning
};
type Receipt = {
  id: string;
  purchaseId: string;
  quoteId: string;
  network: Network;
  asset: Asset;
  payer: string;
  payee: string;
  pricePaid: Money;
  networkFeePaid: Money;
  totalPaid: Money;
  txHash: string;
  explorerUrl: string;
  settledAt: string;
};
type InvoiceResult = {
  type: "invoice-extraction";
  sampleId: "sample-invoice-01";
  vendor: string;
  invoiceNumber: string;
  currency: "USD";
  lineItems: {description:string; quantity:string; unitPrice:string; total:string}[];
  total: string;                   // decimal string from sample, unrelated to payment
};
type Run = {
  id: string;
  purchaseId: string;
  quoteId: string;
  status: RunStatus;
  events: RunEvent[];
  txHash: string | null;           // may exist before settlement
  receipt: Receipt | null;        // exists only after verified settlement
  result: InvoiceResult | null;   // exists only after fulfillment
  session: Session;               // updated budget snapshot
  error: {code:string; message:string; retryable:boolean} | null;
};
```

The demo uses native USDT0 payments and native USDT0 fees for the initial release. The assigned agent verifies chain ID, decimals, RPC, and explorer configuration against the installed SDK and a live testnet RPC before enabling live mode. The current MCP source distinguishes an 18-decimal native view and a 6-decimal ERC-20 view; do not infer one from the other's raw integer. The UI formats `Money` using the supplied `Asset`; it never hardcodes decimals or performs floating-point monetary arithmetic.

Planning defaults, configurable by the backend: fund each session with 1 test USDT0, lifetime spending limit 0.05 test USDT0 including gas, service price 0.01 test USDT0, quote maximum fee 0.01 test USDT0, 120-second quote expiry, 30-minute fixed session lifetime, one active run per session. These are demo settings, not assertions about live network fees. If the actual fee ceiling cannot cover the transaction, block or re-quote; never raise a cap silently. Existing submitted payments continue reconciliation after session expiry, but new spending is disabled.

Budget arithmetic is authoritative: remaining equals limit minus spent minus reserved. Never clamp away an accounting error. During confirmation, reservations remain visible; after reconciliation, the actual price/fee moves to spent. A reverted payment adds only its actual fee to spent. Public capabilities return the configured testnet even when the seller is unavailable; Service.available=false disables new purchase entry. Session provisioning may independently return FUNDING_UNAVAILABLE.

### Owned sample and fixture seed

Use this synthetic invoice, owned by the project: vendor **Example Studio**, invoice **DEMO-001**, currency **USD**, one line **Design review**, quantity **2**, unit price **25.00**, line total **50.00**, invoice total **50.00**. This USD invoice total is the content being extracted, not the testnet service price. Render a visible “Sample invoice” label. Populate InvoiceResult with exactly those values and sampleId sample-invoice-01.

The sample service must parse/validate the sample input or process its stored source document; the website cannot manufacture this response or reveal it as a delivered result before the seller responds. The input/result fixtures are public examples, so the demo demonstrates payment-gated execution and delivery, not secrecy of the sample's known expected output. Keep the canonical fixture inside this website repository, used by its seller, UI preview, buyer example, and tests.

### State and error semantics

- Happy path: `queued → authorizing → submitted → confirming → settled → delivering → completed`. Events can arrive together; no cosmetic timers invent progress.
- `blocked`: policy/balance/quote rejection before broadcast. No purchase payment. `failed`: a known terminal failure; a reverted transaction can still incur a fee, which must be recorded in session spending.
- `payment_unknown`: submission/confirmation outcome is uncertain. Preserve reservations and reconcile the original transaction. Never offer “buy again” as recovery.
- `delivery_failed`: settlement succeeded, delivery did not. Receipt remains visible; resume retries fulfillment for that same purchase without charging again.
- `completed` requires successful chain verification AND a valid delivered result. A hash, signature, or broadcast response alone is not settlement.
- Codes: `BUDGET_EXCEEDED`, `INSUFFICIENT_FUNDS`, `QUOTE_EXPIRED`, `QUOTE_CHANGED`, `SESSION_EXPIRED`, `RATE_LIMITED`, `FUNDING_UNAVAILABLE`, `SERVICE_UNAVAILABLE`, `RPC_UNAVAILABLE`, `PAYMENT_UNKNOWN`, `PAYMENT_REVERTED`, `DELIVERY_FAILED`, `IDEMPOTENCY_CONFLICT`, `UNSUPPORTED_NETWORK`, `INVALID_REQUEST`, `RUN_IN_PROGRESS`.
- Malformed input: 400; unauthenticated/expired session: 401; forbidden mutation origin: 403; unknown or unowned run: 404; quote/policy/idempotency/concurrency conflicts: 409; rate limit: 429 plus Retry-After; temporarily unavailable dependency: 503. Once a run exists, `GET /runs/:id` returns 200 with its domain status/error, including failures.

### Independent acceptance gate

Implement fixtures for funding, ready, each happy-path status, budget rejection, expired quote, insufficient funds, funding outage, rate limit, payment unknown, reverted payment with a fee, and paid-but-undelivered. Fixture identifiers are explicitly fake, with no live explorer link. Fixture mode displays “Preview — no payment is sent” and is disabled for the public production build.

Live acceptance requires this project's browser demo and included standalone buyer example to buy from its owned seller, yielding real testnet receipts and actual output. Prove retries do not double-charge. Run these checks with no other development project running or checked out. An optional future toolkit integration is not part of this gate.
