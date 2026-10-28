# Agent payments demo

Give your agent a USDT0 allowance and send a test payment on Stable Testnet.

Connect MetaMask → configure a local signer → approve allowance → fund gas → send payment.

The demo generates prompts for your agent chat. The agent uses `@stablechain/agent-wallet-cli@0.2.1` to submit ERC-20 `transferFrom` payments from your wallet.

You need MetaMask, test USDT0, and an agent with terminal access, Node.js 22+ and persistent signer storage.

Allowances permit any recipient and have no expiry. Revoke unused allowance after testing. Testnet only; unaudited.

**Demo:** https://agentic.stable.xyz/
**Source and setup:** https://github.com/stablelabs/agentic.stable.xyz
**Faucet:** https://faucet.stable.xyz/
