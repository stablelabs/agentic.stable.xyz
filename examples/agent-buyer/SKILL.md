---
name: stable-invoice-buyer
description: Buy the owned sample invoice extraction from this project's Stable testnet seller within an operator budget.
---

Read docs/agent-setup.md. Work from this repository. Never inspect or print signer secrets.

1. Check `npm run check:network` succeeds and that the operator has configured the seller URL, recipient, testnet signer, and budget in the local environment.
2. First run `npm run buyer` to recover an existing purchase or inspect its delivered result. This does not authorize a new purchase.
3. Only after an explicit request to buy, run `npm run buyer -- --new`. This authorizes one purchase within the configured cumulative budget. If a payment is pending it recovers the same payment instead.
4. On unknown payment or delivery failure, rerun `npm run buyer`. Never remove the buyer database or choose a new signer to bypass pending-payment recovery.
5. Return the delivered JSON and verified receipt. Do not describe a hash alone as a successful purchase. Report funding or RPC blockers accurately.

This is a deterministic tool integration for a coding agent, not a claim that the website uses an LLM. Only Stable Testnet and the sample-invoice-01 service are supported.
