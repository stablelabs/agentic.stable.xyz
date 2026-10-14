# Agent Wallet PoC — Alice creates grants

Alice creates and authorizes a grant in one Chrome MetaMask transaction. The agent only submits payments from Alice's existing EIP-7702 address, within limits enforced onchain. Alice pays creation and administration gas; the agent pays its payment transaction gas separately.

## Alice's local key

The ignored, mode-600 file is:

```text
/Users/angelagilhotra/code/stable/agentic.stable.xyz/agent-wallet/.env.alice.local
```

Put a fresh test-only key after `ALICE_PRIVATE_KEY=` on line 2. Use that same account in Chrome MetaMask. Only the enable/upgrade script reads this key. The web app accepts public grant terms and uses MetaMask to sign; it never reads a private key file.

For a fresh checkout:

```sh
umask 077
cp agent-wallet/.env.alice.example agent-wallet/.env.alice.local
chmod 600 agent-wallet/.env.alice.local
```

## Setup or upgrade

Run commands from the repository root. Node 20.18+ and [Foundry](https://getfoundry.sh/introduction/installation) are required. Solidity is pinned to 0.8.30.

```sh
npm run wallet:contracts
npm run wallet:enable
npm run wallet:init-agent
npm run wallet:dev
```

If Alice was already enabled for the previous v1 or v2 flow, use:

```sh
npm run wallet:enable -- --upgrade
```

The upgrade validates the saved implementation and current delegation, deploys v3, then uses Alice's local owner key to authorize the new implementation on chain 2201. Both v1 and v2 storage layouts are compatible with v3. Alice retains her address. The storage namespace, grant layout, status values, spending, and used-payment-ID mapping are preserved. Existing v1 deployment and activation journals are retained; the old public configuration is archived in `.agent-wallet/upgrade-v3-previous.json`. New transactions use `deployment-v3.json` and `activation-v3.json` and resume from their saved signed bytes after an interruption.

The script refuses unrelated account code, different account/RPC configuration, unsupported versions, and an unexpected activation target. The app and payment client require v3. There is no activation or upgrade button in the browser.

Agent initialization creates or retains `.agent-wallet/agent-key.json` with mode 600 in a mode-700 directory. This is a plaintext local test keystore protected by OS permissions. Its public address is included in the browser configuration to prefill the agent signer field. Fund the agent with test USDT0 for payment gas, using the [Stable faucet](https://faucet.stable.xyz) or a testnet transfer. Alice's balance does not fund an agent-signed transaction automatically.

## Alice creates the grant

Open [http://localhost:5174](http://localhost:5174) in Chrome and connect Alice in MetaMask. Enter:

- Agent signer: the address printed by `npm run wallet:init-agent`.
- Allowed recipient: the recipient's public test address.
- Cumulative budget: for example `0.01` USDT0, with at most six fractional digits.
- Expiry: a future UTC timestamp, for example `2026-10-15T18:00:00Z`.

Review the exact terms and click **Create and authorize grant**. Confirm in MetaMask. Alice pays this transaction's gas. The confirmed grant appears as **Active** and displays its full grant ID. No agent request or separate grant approval transaction is needed.

MetaMask rejects dapp-originated transactions with calldata sent directly to an account it owns. The v3 implementation route avoids that unsupported self-call form while retaining owner checks.

The browser saves the draft grant ID and terms before submission, retains them after a rejected wallet prompt, and tracks the transaction hash across reloads. Receipt success plus the exact matching `GrantCreated` event is required. A confirmed grant ID cannot be overwritten.

An optional public form-link helper prepares the fields without signing or submitting any transaction:

```sh
npm run wallet:grant-link -- \
  --recipient 0xRECIPIENT_ADDRESS \
  --budget 0.01 \
  --expires 2026-10-15T18:00:00Z
```

Adjust the example expiry and replace the recipient placeholder. The agent is prefilled from the public configuration, or may be specified with `--agent 0xAGENT_ADDRESS`. `wallet:request` is retired and exits with instructions for the new flow.

## Alice funds the agent for gas

After creation, every Active grant shows an **Agent gas** panel with the signer's native USDT0 balance and whether it covers the estimated reserve for one payment. The estimate simulates a new payment for the remaining grant budget without signing or submitting it. It includes 50% extra gas, a fee cap of twice the current base fee, and upward rounding to six decimals. Costs can change; the estimate does not guarantee a later payment. A failed RPC check is shown as unavailable rather than sufficient.

If funding is needed, review the suggested top-up for three estimated payments, or enter another positive amount with at most six decimals. Click **Fund agent gas** and confirm the separate native USDT0 transfer in MetaMask. Alice pays this transfer's fee. The destination and amount are displayed before signing. Funding is outside the grant budget, belongs to the agent, and is not recovered by revoking a grant.

The app verifies the funding receipt and exact sender, recipient, amount, and absence of calldata. It retains the transaction hash across reloads, refreshes the gas balance after confirmation and during regular grant refreshes, and provides **Check gas balance**. Unknown funding outcomes block another top-up until **Check funding confirmation** resolves the saved transaction. Rejection or a reverted transfer leaves the grant authorized.

## The agent pays

Use the grant ID confirmed in the app:

```sh
npm run wallet:pay -- \
  --grant 0xGRANT_ID \
  --recipient 0xRECIPIENT_ADDRESS \
  --amount 0.006
```

The agent signs locally and pays its own gas. Payment funds come from Alice. Another new `0.006` payment exceeds the remaining `0.004` and is blocked. A subsequent `0.004` payment can still succeed. Alice can revoke an Active grant in MetaMask at any time; there are no per-purchase approvals.

A grant is a spending permission, not a reservation of funds. Alice needs enough USDT0 for payments and her own gas. Stable's native 18-decimal gas balance and six-decimal ERC-20 balance are views of the same underlying asset and must not be added together.

## Payment recovery

The agent durably saves the payment ID, exact terms, complete signed transaction, hash, and nonce before broadcasting. Private journal writes use `fsync`, atomic rename, and directory `fsync`. Local signing commands use an exclusive lock.

After an unknown submission outcome, rerun the same command with `--payment-id 0xSAVED_PAYMENT_ID` and identical terms. Confirmed payments are reported again without another transaction; unconfirmed payments reuse identical signed bytes. Changing terms for an existing ID is refused. Omitting the ID deliberately creates a new intent. Never delete journals to resolve an unknown transaction. Check its hash first. Remove a stale command lock only after verifying its recorded process has stopped.

Receipt success and the exact matching `Payment` event are required. Cancellation or replacement with a different action is not payment confirmation. Repricing the same action is supported. A preflight rejection costs no gas; a reverted included payment may cost the agent gas while leaving Alice's funds and spending unchanged.

## Contract enforcement and legacy records

`createGrant(id, agent, recipient, budget, expiresAt)` is owner-only and creates an Active grant atomically. For MetaMask compatibility, Alice sends her transaction to the fixed implementation contract's `createGrantFor(Alice, ...)` entry point. That entry point requires Alice to be the actual transaction caller and verifies that Alice delegates to that exact implementation. It then calls Alice's account, which trusts its immutable implementation for these named owner administration operations. Direct Alice-signed self-calls remain valid for local clients. The same route supports revocation and legacy approval/rejection; there is no arbitrary forwarding function. Alice pays the outer transaction's gas. The agent cannot create grants or change permissions. There is no production `requestGrant` entry point.

Each payment checks Active status, exact agent signer, exact recipient, expiry (`block.timestamp < expiresAt`), positive amount, remaining cumulative budget, and a nonzero payment ID unused anywhere in Alice's account. Spending and the used-ID marker update before the fixed token transfer under a reentrancy guard; transfer failure reverts both updates. No arbitrary calls, token approvals, relayer, or sponsorship path is exposed. Mainnet is blocked in the contract and clients.

Old Pending and Rejected status values remain in storage for migration compatibility. Only Alice can approve or reject an existing legacy Pending grant; the UI labels these actions as legacy controls. Rejected, Revoked, expired, exhausted, and uncreated grants cannot pay. Terms cannot be edited and terminal states cannot reactivate. The test fixture under `test/fixtures/` exists solely to prove v1 storage migration and legacy-state enforcement.

The bounds constrain agent payments through this delegate. Alice's owner key retains authority over her funds and delegation. This is unaudited test-only code; production custody is outside the PoC.

## Live acceptance and transaction evidence

After enabling v3, start the app and prepare the test plan:

```sh
npm run wallet:live -- --phase prepare
```

Preparation creates public grant-form links locally and sends no agent grant transactions. In Chrome MetaMask, Alice creates the expiring grant first, then the main and revoked grants, using the printed links. Revoke the revoked grant after creating it. The expiring grant has a five-minute creation window.

Then, with the agent funded:

```sh
npm run wallet:live -- --phase exercise
# Repeat after the printed UTC expiry if the last check is waiting.
npm run wallet:live -- --phase report
```

The runner verifies Alice's creation/revocation transactions, then tests uncreated, revoked, expired, exhausted, wrong-signer, wrong-recipient, duplicate-ID, and over-budget payments. Negative cases are deliberately submitted with an explicit gas limit to obtain included reverted receipts. Each also checks the expected custom error in preflight and compares Alice's native/Token balances, recipient balance, spending, and the payment-ID marker before and after. Successful payments total `0.01` test USDT0. A fresh wrong-signer test account receives `0.01` test USDT0 from the agent for gas; forced payment attempts cap their maximum gas cost at `0.01` USDT0 each.

Each step records its hash, receipt status, block, at least two observed confirmations, gas fee, and explorer link in `.agent-wallet/live-evidence.json` and `.agent-wallet/live-evidence.md`. Repeating a phase resumes existing work. Owner receipt checks verify Alice as sender, the implementation as destination, Alice as the forwarded account, exact action/ID/terms, and the expected event emitted by Alice's account. Actual Chrome MetaMask interaction must also be observed; the runner does not read Alice's private key or sign owner actions.

## Local verification

```sh
npm run wallet:test:contracts
npm run wallet:test
npm run wallet:test:browser
npm run wallet:build
```

The root commands `npm run dev`, `npm run build`, `npm test`, `npm run test:contracts`, and `npm run test:browser` run this wallet application and its checks. The `wallet:*` names remain available for existing workflows.

Set `WALLET_SOLC=/absolute/path/to/solc-0.8.30` when using a separately installed compiler. Script tests require compiled artifacts and free local port 18545. They use generated disposable keys and Anvil only. Browser tests inject a test provider and mocked RPC, so actual MetaMask/testnet acceptance is reported separately. The budget property test runs 256 generated payment pairs.

References: [Stable Testnet](https://docs.stable.xyz/en/reference/testnet-information/), [USDT0 behavior](https://docs.stable.xyz/en/explanation/usdt0-behavior/), [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702).
