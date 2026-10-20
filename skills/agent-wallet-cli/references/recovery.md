# CLI recovery reference

Apply this with the same absolute `STATE_DIR` and original `PAYMENT_ID` established in SKILL.md. Preserve structured error output, including data on nonzero exit. Do not print private files to diagnose a problem.

## Payment states

| Result | Meaning and next action |
| --- | --- |
| `created` | Immutable local intent; no signed transaction yet. Check terms before submitting. |
| `simulated` | Dry-run only; `signed: false`, `submitted: false`. No funds moved. |
| `rejected` | Preflight stopped before signing. Fix the cause and retry the same intent/ID if still authorized. |
| `signed` / `submitted` | Outcome unresolved. Show/wait on this ID before considering resume. |
| `not_submitted` | `payments wait` found no signed bytes. It did not submit anything. |
| `unknown` | Error result cannot determine outcome. Preserve ID/hash and observe later. |
| `confirmed` | Exact payment receipt verified. Report success; do not submit another payment as a retry. |
| `reverted` | Included transaction failed; gas may be spent. Inspect the cause. A new payment requires a deliberate new intent within the user's authorization, not an automatic retry with a fresh ID. |

`payments show` reads a local snapshot; use `payments wait` to observe onchain evidence. A terminal record whose receipt is no longer available needs reconciliation, not a new payment. Receipt verification can reject a successful EVM transaction if its action or token event differs. A repriced replacement with the same action can be accepted; a changed-action replacement is not payment confirmation.

## Error handling

| Code | Action |
| --- | --- |
| `CONFIG_REQUIRED` | For setup-only, use `whoami` and construct the approval URL locally from the supplied page and amount; imported settings are not required. For onchain tasks, import verified public settings into the intended directory. Do not initialize another signer. |
| `AGENT_REQUIRED` / `STATE_REQUIRED` | Locate the original state when recovering an existing signer. Initialize only if a new signer is actually intended. |
| `INVALID_KEY_RECORD` / `UNSAFE_STATE` / `INVALID_PAYMENT_JOURNAL` | Preserve the directory and stop mutation. Diagnose identity/permissions using public diagnostics; never repair by fabricating journal fields or replacing the key. |
| `CONFIG_IN_USE` | Existing journals bind owner/token/RPC. Recover them under their original settings. Do not overwrite config or delete records to switch owners. |
| `LEGACY_PAYMENT_JOURNAL` | Recover the retired flow with its matching historical tool and original state. Do not replay old intent as an ERC-20 payment. Read the bundled operating guide's migration notes. |
| `INSUFFICIENT_ALLOWANCE` | Generate the correct signer's approval link and hand it to the owner. Preserve payment terms; do not silently lower the amount. |
| `INSUFFICIENT_PAYMENT_FUNDS` | The owner needs payment tokens. Approval is not a deposit or reservation. |
| `INSUFFICIENT_GAS` | Fund the actual agent's native gas separately. Read `gas check` availability, reserve, and `suggestedTopUp`; amounts there use 18 decimals. An estimate is not a fixed final fee. |
| `TOKEN_TRANSFER_REJECTED` / other preflight revert | No submission from this attempt. Fix the reported cause, then simulate the same saved intent before retrying. |
| `PAYMENT_TERMS_MISMATCH` | The ID already binds different terms. Inspect the existing record; never overwrite it. Create another intent only for a deliberate distinct payment after resolving any earlier submission. |
| `PAYMENT_NOT_FOUND` | Verify the state directory and full ID. Do not reconstruct a payment under a new ID when a previous outcome is uncertain. |
| `UNRESOLVED_PAYMENT` | Error data identifies an earlier signed payment. Wait/reconcile that ID before signing another. |
| `PAYMENT_OUTCOME_UNKNOWN` | Keep ID/hash. Use `payments wait`, then authorized `payments resume` if needed. A timeout or process exit does not prove no transfer happened. |
| `PAYMENT_UNVERIFIED` | Exact payment evidence is missing or differs. Inspect the same transaction and preserve its journal. Do not claim success or create a duplicate. |
| `PAYMENT_REVERTED` | Report the included failure and any returned fee/hash. Follow the reverted-state guidance above. |
| `RPC_UNAVAILABLE` / `ALLOWANCE_TIMEOUT` | Retry a read-only check a bounded number of times. For an explicit network-policy denial (such as a proxy 403), report the blocked RPC hostname and stop; the user needs permitted RPC access in this environment or another environment. Preserve existing signer state. Do not infer a transaction failed or change network to bypass verification. |
| `STATE_LOCKED` | Another command may be active. Verify the actual process ended before treating a lock as stale. Never remove locks automatically on a timer. |

If permission modes alone are wrong, adjust only the known private directory/file after inspecting the issue; do not recursively change unrelated directories or expose contents. If identity or journal integrity is unclear, stop signing and report the blocker.

## Process exit codes

| Exit | Meaning |
| --- | --- |
| 0 | Command completed; still inspect readiness/payment status. |
| 2 | Invalid input. |
| 3 | State, configuration, or verification error. |
| 4 | Preflight rejection. |
| 5 | RPC failure or allowance timeout. |
| 6 | Unknown outcome / unresolved payment; inspect `recovery` and original ID. |
| 7 | Reverted or unverified receipt. |
| 8 | State lock held. |

Prefer symbolic codes and returned data to exit code alone. In particular, `doctor` and `gas check` can exit zero while readiness is false.
