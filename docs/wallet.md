# Operating the demo

The web app manages the wallet owner’s USDT0 approvals and separate gas funding. The local CLI holds the agent key and sends `transferFrom` payments. The token enforces remaining allowance; there is no custom spending contract, recipient restriction, or automatic expiry.

Start with [standalone CLI installation](cli.md) or [local web-app setup](https://github.com/stablelabs/agentic.stable.xyz#run-the-demo). The CLI reference lists commands, state selection, and error recovery.

## Public configuration

Schema-2 settings contain:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `2` |
| `chainId` | `2201`, Stable Testnet |
| `rpcUrl` | HTTPS RPC, or HTTP loopback for local testing |
| `token` | Test USDT0: `0x78Cf24370174180738C5B8E352B6D14c83a6c9A9` |
| `alice` | Wallet owner address; the field name is retained for existing state compatibility |
| `approvalUrl` | Web app URL, HTTPS or HTTP loopback |
| `defaultAgent` | Optional public signer address to prefill; it does not select the CLI’s private key |

Standalone CLI users obtain public JSON from the operator or create it with the actual owner and approval page:

```json
{
  "schemaVersion": 2,
  "chainId": 2201,
  "rpcUrl": "https://rpc.testnet.stable.xyz",
  "token": "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9",
  "alice": "OWNER_ADDRESS",
  "approvalUrl": "https://agentic.stable.xyz"
}
```

Replace `OWNER_ADDRESS` with the account you connect in MetaMask. The web app accepts any visitor’s MetaMask account and uses it as the wallet owner for balances, approvals, revocations, and gas funding. It adds or switches to Stable Testnet during connection. You can also connect and use **Download wallet settings** to get public JSON containing your account and the selected agent address. Import with `agent-wallet config import --file /absolute/path/wallet-config.json --json` using the same state directory as `init`. Configuration does not approve allowance or transfer funds.

For web-app operators with a checkout, `npm run wallet:configure -- --owner ADDRESS --agent ADDRESS` verifies the public network/token and writes `web/public/wallet-config.json`. Options include `--rpc URL`, `--approval-url URL`, and `--output FILE`.

Development serves that generated public file. Production builds validate and copy `web/deployment/wallet-config.json` to `web/dist/wallet-config.json`; local settings never replace production settings automatically. The deployment file’s `alice` remains a schema-compatible bootstrap value; the browser replaces it with the connected account before reading balances or submitting transactions. The production configuration leaves the agent blank so an owner can paste a signer or use its CLI approval link. Neither public file contains signing keys or transaction journals.

## Approvals and gas

`approve(agent, amount)` sets one allowance for the owner/token/agent tuple. It overwrites the amount rather than adding a separate grant. Successful transfers consume it. Multiple agents have independent allowances against the same owner balance; approval reserves no funds.

The UI refuses positive-to-positive changes. Revoke the current allowance to zero, wait for confirmation, then approve the replacement amount. Revocation affects transactions confirmed afterward and cannot undo an earlier payment. The agent can choose any recipient. The token allowance does not expire.

The owner sends native USDT0 to the agent for fees in a separate transaction. That money belongs to the agent and is outside the allowance. Revoking allowance does not recover gas funding. The UI top-up amount is manually selected, not an estimate; use `gas check --recipient ADDRESS --amount AMOUNT` for a specific payment’s buffered reserve.

Stable exposes USDT0 through a six-decimal ERC-20 balance and an eighteen-decimal native balance representing the same underlying funds. Do not add these balances together. This demo intentionally supports this token/network only.

## Private state and recovery

The default private directory is `.agent-wallet-erc20` relative to the current working directory; `--state-dir` and `WALLET_STATE_DIR` override it. Set an absolute path to avoid selecting another directory when running the installed executable elsewhere. Reuse existing state when upgrading; installation does not move it. Directories require mode `700` and files `600`. It contains the plaintext signer key and signed transaction journals, not encrypted storage. Keep one persistent directory per signer. The web development server serves only the web, shared browser code, and dependencies; signer source and private state are outside its allowlist.

Before signing, the CLI checks allowance, owner balance, gas, and token simulation. It saves immutable intent and exact signed bytes, hash, and nonce before broadcasting. Confirmation requires both the exact token `Transfer` event and matching transaction terms.

A timeout means the outcome is unknown. `payments show ID` and `payments wait ID` never broadcast. `payments resume ID` checks for a receipt before reusing the same signed bytes. Do not prepare another ID for an uncertain payment: IDs are local records, and a new transaction can spend again. Retain original state through retries. Another signed payment from the same signer blocks new signing until reconciled.

The browser retains approval/funding descriptors in its existing schema-2 local-storage namespace, separately for each owner and token. Reconnect MetaMask after a reload to restore that owner’s records. Unverified operations block further submissions for that owner across reloads and account switches. Changing accounts or networks, wallet disconnection, and the app’s **Disconnect** button disable wallet actions and clear the displayed account data; reconnect to continue. Disconnecting the app leaves recovery records and onchain allowances intact. Use **Check confirmation**, or obtain the hash from MetaMask and use **Verify transaction**. Do not clear browser storage to resolve an unknown outcome. If no hash was returned, inspect wallet history and retain the record while investigating. Corrupt or inaccessible saved state blocks new submissions for that owner.

## Verified testnet example

[Transaction `0xa9f5…e678`](https://testnet.stablescan.xyz/tx/0xa9f5eb8c3d29f9ef352b85124dfd12c03844a302a01aeb98ce24d8a1af43e678) succeeded in block `73288711`:

- Agent signer: `0xE5EbdF6Fb1A09040fdBFf8B4abEEef58f4A9aBBE`.
- Target: the USDT0 token; method: `transferFrom`.
- Amount: `0.001` USDT0, from the owner to the same owner address.
- The matching token `Transfer` event was present. Remaining allowance was `0.009` when checked afterward.
- The agent paid `0.00046198` native USDT0 in gas.

The self-transfer verifies authorization and allowance consumption; it does not demonstrate funds arriving at a different wallet. Use a separate recipient for that part of the demo. This historical receipt is evidence of that transaction, not a claim about current balances or allowance.

## Acceptance and checks

Automated tests cover token approvals, reset/revocation, signer safety, direct transfer signing, the cumulative allowance example, receipt verification, lost-response recovery, CLI commands, browser flows, and development-server file isolation. They use controlled RPC/token fixtures. The receipt above is separate live evidence.

To exercise a new signer on testnet: approve `0.01`, fund gas, send `0.006` to a separate recipient, verify `0.004` remains, dry-run another `0.006` to see rejection, then send `0.004`. Approve another small amount and revoke it to demonstrate that later positive transfers fail. Save the original IDs and hashes; recheck a confirmed payment with its same ID to verify recovery does not send another transaction.

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

Linux may need `npx playwright install --with-deps chromium`. Browser tests default to port 5175, overridden by `WALLET_TEST_PORT`. Development defaults to port 5174. The installed CLI needs Node.js 22+ and no build or Foundry installation. Contributors can run the source with `npm --silent run wallet -- …` after `npm ci`.

## Migration

The root application remains private with `web/`, `agent/`, and `shared/`. `packages/cli` packages the agent as standalone `@stablechain/agent-wallet-cli@0.2.0` with the `agent-wallet` executable. It bundles its runtime and includes docs and the agent skill; there is no separately published SDK. Source development still uses the root `npm run wallet -- …` command with no `build:tools` step.

Existing schema-2 keys, public configuration, browser records, and payment journals remain compatible and are not moved or rewritten. Your selected private state directory and signer remain the same. The public development file moved from `packages/web/public/wallet-config.json` to `web/public/wallet-config.json`; only paths in commands need updating.

The retired EIP-7702 grant flow is different. Resolve its old payments and revoke any active grants with the matching historical tool (the published v3 grant flow used version 0.1.2). Retain its original state and configuration. Legacy journals are rejected rather than adopted as direct token payments. Removing old source does not revoke any onchain grants, approvals, or delegations; those remain separate owner actions.

## Hosting

`npm run build:cloudflare` runs the production build and creates `web/dist` using the versioned deployment settings. `npm run deploy:cloudflare` deploys to the configured `agentic-stable` Worker and custom domain when authorized credentials are present. Pushes to `main` run checks/tests and deploy through `.github/workflows/deploy.yml`. Keep one automatic deployment path enabled; credentials stay outside source.

The Worker serves assets and public settings only. It has no agent signer or payment API. The small unused `FundingLedger` export preserves a pre-existing Cloudflare storage namespace. Removing it would require deliberate storage retirement, so this cleanup retains the compatibility stub without exposing an API.
