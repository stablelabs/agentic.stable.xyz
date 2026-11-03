# How do agents spend on Stable, Tempo and Arc?

Checked **2026-11-03**. [Editable Excalidraw](comparison.excalidraw). The board compares selected documented flows, not exclusive capabilities or a ranking of chains. Named source links open references; bracketed IDs map to the source register below.

| Visual | Preview |
| --- | --- |
| Authorization and money movement | [authorization-flows.png](authorization-flows.png) |
| Permission boundaries and availability | [permission-matrix.png](permission-matrix.png) |
| HTTP payment negotiation and settlement | [http-payments.png](http-payments.png) |

Three layers need separate names: **spending authority**, **transaction execution**, and **HTTP payment negotiation**. An access key, an ERC-20 allowance and an HTTP 402 response solve different parts of the system.

## Where is the permission enforced?

| Selected flow | Authority and execution | Where the funds sit |
| --- | --- | --- |
| Stable demo | Owner approves the agent as token spender. Agent signs `transferFrom`; USDT0 checks allowance and balance. | Owner address; agent has separate gas funds. [S1] |
| Stable account alternative | EIP-7702 enables account code. Alchemy's session-permission module validates the session key and its rules. | Same owner address. The official walkthrough uses Stable Testnet. [S2, S3] |
| Tempo access key | Root authorizes a bounded key in Account Keychain. Agent signs **as the owner account**; protocol checks the key, scopes and applicable TIP-20 limits. | Owner's Tempo account; the key itself holds no funds. [T1–T4] |
| Circle Agent Wallet on Arc | Human funds an agent wallet and configures Circle policies. For covered operations, wallet-service controls precede 2-of-2 MPC signing and chain submission. | Funded agent-wallet address. This is a named Circle product, not an Arc consensus feature. [A1, A2] |

The Stable-style allowance route also exists on Tempo's TIP-20 and Arc's USDC interfaces. Arc additionally documents EIP-7702 and ERC-4337. Stable's retired `AgentWallet` was custom policy code at an EIP-7702-delegated owner address. Its fixed-recipient grants are **not** the same implementation as the current Alchemy walkthrough. [S1, S2, T7, A5]

## What can each control actually promise?

- **Demo allowance:** aggregate amount for a spender; no recipient restriction or expiry in that allowance. A one-payment prompt does not narrow it. Confirmed `approve(agent, 0)` disables that token permission. Local payment IDs support recovery; they are not token-level duplicate prevention. [S1]
- **Stable session module:** the showcased ERC-20 rule caps cumulative transfers and approvals and can expire. It has no fixed-recipient field. Other contract/function rules are separate. Native-value and gas permissions are separate too, despite native and ERC-20 USDT0 exposing one balance per account. [S2–S4]
- **Tempo:** optional one-time or periodic per-token budgets, expiry, top-level target/selector scopes, and narrow recipient/spender allowlists. Recipient constraints cover `transfer`, `transferWithMemo` and `approve`, not arbitrary calldata. Scopes do not recursively sandbox an allowed contract's internal calls. Approval increases consume the key budget; pulls against an existing token allowance do not. [T1–T3]
- **Circle policies:** documented outbound-USDC caps and address rules are service controls. Custom policies are mainnet-only. `approve()` and a spender's later `transferFrom` do not count toward transfer caps. The public CLI corroborates backend policy records; it does not expose the complete backend enforcement algorithm. [A2, A7]

Revocation needs the right target. Clearing Stable's Alchemy delegation retains account storage; re-enabling the same implementation can restore unexpired session permissions. That reset is not permanent revocation of the stored permissions. Tempo key revocation does not cancel existing token approvals. Circle logout clears local credentials but does not revoke server tokens; policy reset restores defaults. The current public Circle docs do not establish a universal session-revoke command. [S2, T4, A3]

## Who pays for execution?

| Flow | Fee treatment |
| --- | --- |
| Stable demo | Agent's separate address pays native USDT0 gas. No sponsor integration in this demo. [S1] |
| Stable session account | Owner account normally pays; provider sponsorship is optional. Stable's governance-gated Gas Waiver is a separate protocol rail, not a spending grant or a default paymaster. [S2, S5] |
| Tempo access key | Owner account pays in an eligible USD TIP-20 fee token, or an independent fee payer co-signs. Sender-paid fees consume the applicable key budget. Do not copy the demo's exact “10 minus 6 leaves 4” arithmetic without accounting for fees. [T2, T5] |
| Circle Agent Wallet | Arc network gas is USDC. Circle currently sponsors eligible Agent Wallet operations with caps and conditions; this is not zero-cost protocol execution. [A1, A4] |

Stable USDT0 and Arc USDC each expose native 18-decimal and ERC-20 6-decimal views of the same balance per account. Tempo has no native gas token; eligible TIP-20 stablecoins pay fees. No measured cost or throughput ranking is claimed here. [S4, T5, A5]

## How does a paid API fit in?

HTTP negotiation sits above wallet permissions. A service returns payment terms; the client supplies a payment credential; the service verifies settlement or its accepted payment guarantee before delivering the resource.

| Integration | Documented path |
| --- | --- |
| Stable | x402 settlement through payer-signed ERC-3009 authorizations and ecosystem facilitators. The demo's spender key cannot sign an authorization for the owner's funds. Stable's MPP documentation supplies a custom-method tutorial; it identifies no shipped Stable method and no usable MPP payment-channel sessions yet. The current demo implements neither HTTP flow. [S6, S7] |
| Tempo | MPP one-time charges can send a signed transaction for the service/relay to broadcast, or use client broadcast plus a hash. MPP sessions use funded channels and cumulative offchain vouchers. They are distinct from account access keys. MPP also supports generic EVM methods and x402 exact. [T8, T9] |
| Arc / Circle | x402 `exact` can relay an EIP-3009 authorization through Circle's Facilitator to USDC settlement. Gateway Nanopayments are a separate prefunded path: offchain authorization/acceptance, then batched onchain settlement. A Gateway credit is not an individual finalized token transaction. [A8, A9] |

MPP and x402 are not exclusive chain identities. Circle Agent Wallets are multichain. A payment-channel session, a wallet-login session and a session signing key are three different uses of “session.”

## What is available, and what did we verify?

Stable documents mainnet and testnet; this CLI and the cited Alchemy walkthrough target testnet. Tempo's single-key access keys are documented on mainnet/testnet; T3 scopes and periodic limits activated on mainnet on April 27, 2026. Its configurable-account examples are devnet-only until scheduled T14; repository code can contain future-fork behavior. Arc's current chain and wallet references document mainnet/testnet; Circle custom policies require mainnet. [S2, S4, T6, A2, A6]

Evidence: official specifications and guides, pinned public implementation code, this repo's release code, and the published Circle CLI source map. Read-only RPC probes returned HTTP 403 in this environment. We did not create wallets, submit payments, benchmark fees, or claim fresh end-to-end acceptance on the three chains.

Specific current references take precedence over stale summaries: Circle's product FAQ still says Arc mainnet is coming soon, while its chain-specific Agent Wallet and Facilitator references list mainnet support. Older Tempo guides omit T3 permission extensions. [A6, T6]

## Where is the proof?

**Stable** — docs snapshot `stablelabs/dev-docs@6bc7796aa1dc6e9f4dd2089e94937308ed66c2fb`.

- **S1 · Demo:** [approval](https://github.com/stablelabs/agentic.stable.xyz/blob/f8c381aa5b6345ac2bce43c455e80fd4dbc89b85/shared/owner.ts), [agent execution/recovery](https://github.com/stablelabs/agentic.stable.xyz/blob/f8c381aa5b6345ac2bce43c455e80fd4dbc89b85/agent/payments.ts), [historical mechanism notes](../../marketing/agent-payment-mechanisms.md).
- **S2 · Account alternative:** [EIP-7702](https://docs.stable.xyz/en/explanation/eip-7702/), [session walkthrough, pinned source](https://github.com/stablelabs/dev-docs/blob/6bc7796aa1dc6e9f4dd2089e94937308ed66c2fb/docs/pages/en/how-to/session-keys.mdx).
- **S3 · Module semantics:** [Alchemy permission reference](https://www.alchemy.com/docs/wallets/reference/wallet-apis-session-keys), [supported networks](https://www.alchemy.com/docs/wallets/supported-chains).
- **S4 · Asset/network:** [USDT0 behavior](https://docs.stable.xyz/en/explanation/usdt0-behavior/), [connection details](https://docs.stable.xyz/en/reference/connect/).
- **S5 · Fee alternative:** [Gas Waiver](https://docs.stable.xyz/en/explanation/gas-waiver/), [hosted integration/access conditions](https://docs.stable.xyz/en/how-to/integrate-gas-waiver/).
- **S6 · HTTP settlement:** [agent settlement](https://docs.stable.xyz/en/explanation/agent-settlement/), [facilitators](https://docs.stable.xyz/en/reference/agentic-facilitators/).
- **S7 · MPP scope:** [custom-method status](https://docs.stable.xyz/en/explanation/mpp/), [session status](https://docs.stable.xyz/en/explanation/mpp-sessions/).

**Tempo** — protocol `fe75661deacab6399852b33a9939b51c0f34a63a`; docs `766f03ad9062b973c9fbd5c35d0eaca69c88b922`.

- **T1 · Authorization:** [access keys](https://tempo.xyz/developers/docs/accounts/access-keys), [keychain implementation](https://github.com/tempoxyz/tempo/blob/fe75661deacab6399852b33a9939b51c0f34a63a/crates/precompiles/src/account_keychain/mod.rs), [transaction handler](https://github.com/tempoxyz/tempo/blob/fe75661deacab6399852b33a9939b51c0f34a63a/crates/evm/src/handler.rs#L632).
- **T2 · Budgets:** [spending-limit semantics](https://tempo.xyz/developers/docs/accounts/access-keys/spending-limits).
- **T3 · Scope:** [call/recipient scopes](https://tempo.xyz/developers/docs/accounts/access-keys/scopes), [TIP-1011](https://github.com/tempoxyz/tempo/blob/fe75661deacab6399852b33a9939b51c0f34a63a/tips/tip-1011.md).
- **T4 · Stop signing:** [revocation](https://tempo.xyz/developers/docs/accounts/access-keys/revocation), [expiry](https://tempo.xyz/developers/docs/accounts/access-keys/expiry).
- **T5 · Fees:** [eligible tokens](https://tempo.xyz/developers/docs/accounts/fees/fee-tokens), [fee-payer signatures](https://tempo.xyz/developers/docs/accounts/fees/fee-sponsorship).
- **T6 · Availability:** [T3 activation](https://tempo.xyz/developers/docs/protocol/upgrades/t3), [T14 schedule](https://tempo.xyz/developers/docs/protocol/upgrades/t14), [network reference, pinned](https://github.com/tempoxyz/docs/blob/766f03ad9062b973c9fbd5c35d0eaca69c88b922/src/pages/docs/quickstart/connection-details.mdx).
- **T7 · Shared allowance baseline:** [TIP-20 spec](https://tempo.xyz/developers/docs/protocol/tip20/spec), [transferFrom implementation](https://github.com/tempoxyz/tempo/blob/fe75661deacab6399852b33a9939b51c0f34a63a/crates/precompiles/src/tip20/mod.rs#L886).
- **T8 · HTTP billing:** [MPP charge](https://mpp.dev/payment-methods/tempo/charge), [EVM/x402 support](https://mpp.dev/blog/evm-x402-support), [client charge code at `9957b101`](https://github.com/wevm/mppx/blob/9957b101e98c63a9f972aeb9cc305edff799020f/src/tempo/client/Charge.ts#L519).
- **T9 · Channel billing:** [MPP sessions](https://mpp.dev/payment-methods/tempo/session).

**Arc / Circle** — current official product and chain references; public CLI package pinned below.

- **A1 · Wallet/signing:** [Agent Wallets](https://developers.circle.com/agent-stack/agent-wallets), [quickstart](https://developers.circle.com/agent-stack/agent-wallets/quickstart).
- **A2 · Policy boundary:** [custom policies](https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/custom-policies).
- **A3 · Sessions:** [authentication/logout](https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/authenticate), [CLI reset/logout reference](https://developers.circle.com/agent-stack/circle-cli/command-reference).
- **A4 · Fee conditions:** [Agent Wallet fees](https://developers.circle.com/agent-stack/agent-wallets/fees).
- **A5 · Chain primitives:** [EVM differences](https://docs.arc.io/arc/references/evm-differences), [ERC-4337](https://docs.arc.io/arc/tools/account-abstraction), [USDC interface](https://docs.arc.io/arc/references/contract-addresses).
- **A6 · Availability:** [Arc network reference](https://docs.arc.io/arc/references/connect-to-arc), [Agent Wallet networks](https://developers.circle.com/agent-stack/agent-wallets/supported-blockchains), [Facilitator networks](https://developers.circle.com/facilitator-service/supported-networks).
- **A7 · Service implementation evidence:** [CLI 1.2.2 archive](https://registry.npmjs.org/@circle-fin/cli/-/cli-1.2.2.tgz), SHA1 `6485c15665e704c0dbcc924d00c101804fe17f83`. In `dist/index.js.map`, `src/commands/wallet/limit-set.ts` posts `/v1/policy`; `limit-reset.ts` deletes backend policy records. This corroborates service-side storage, not an audit of the unpublished policy engine.
- **A8 · Per-request relay:** [Facilitator exact and upto flows](https://developers.circle.com/facilitator-service/how-it-works).
- **A9 · Batched path:** [Gateway batch lifecycle/security](https://developers.circle.com/gateway-nanopayments/concepts/batched-settlement), [signing domains/networks](https://developers.circle.com/gateway-nanopayments/supported-networks), [official Arc Testnet reference implementation](https://github.com/circlefin/arc-nanopayments).

For presenting: select a frame title in Excalidraw and press **Shift+2**. **Shift+1** fits the full board. The original two-mechanism Stable sketch remains [here](../../marketing/agent-payment-mechanisms.excalidraw).
