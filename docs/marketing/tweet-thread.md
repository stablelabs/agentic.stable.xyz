# Tweet thread

## 1/6

Give your agent a USDT0 allowance, then have it send a test payment.

Try the five-step demo on Stable Testnet:
https://agentic.stable.xyz/

## 2/6

You approve the signer in MetaMask. Your tokens stay in your wallet until payment.

The agent signs an ERC-20 transferFrom transaction and pays gas from its own native USDT0 balance.

## 3/6

Connect wallet → configure signer → approve allowance → fund gas → send payment.

The demo generates setup and payment prompts for your agent chat. The agent runs the CLI locally and submits the payment.

## 4/6

Approve 0.01 USDT0. Send 0.006. Remaining allowance: 0.004.

The allowance permits any recipient and has no expiry. Revoke unused allowance in the demo; revocation applies after confirmation. Gas funding is separate.

## 5/6

Check the confirmed receipt, recipient and amount.

If the result is uncertain, recover with the same payment ID and signer directory. Creating a new ID can pay twice.

## 6/6

CLI: @stablechain/agent-wallet-cli@0.2.1
Requires Node.js 22+ and persistent signer storage.

Source and setup:
https://github.com/stablelabs/agentic.stable.xyz

Testnet only; unaudited.
