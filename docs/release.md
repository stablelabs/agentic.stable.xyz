# Release and code-freeze checklist

The release is one matching website, CLI package, agent skill and README. Marketing production starts after this checklist is complete. Use Node.js 22.12+ for local verification; CI uses Node.js 24.

## Prepare and verify

1. Start from current `main` on a release branch. Keep private signer state and browser recovery records intact.
2. Update the root/package versions, lockfile, `web/src/release.ts`, docs and skill together. The web prompts must use the matching immutable `cli-vVERSION` skill tag.
3. Run `npm ci`, `npm run check`, `npm test`, `npm run test:browser` and `npm run build`. Install Chromium once with `npx playwright install chromium` if needed. Inspect desktop, phone and keyboard behavior.
4. Run `npm run pack:cli`. Install the resulting tarball into a temporary npm prefix. Verify the version and run signer initialization, config import and allowance-link generation with RPC unavailable. The packaging regression test exercises local-only import on the actual archive.
5. Review the package file list. It must contain only the executable/runtime notices, package metadata, README, docs and skill; no keys, journals or local configuration.
6. When bundled dependencies change, review and update `packages/cli/runtime-notices.txt`. The build checks every detected dependency's complete notice against this versioned source. Keeping optional-module notices in that source makes the same executable reproducible across install platforms.

## Publish the exact artifact

For release 0.2.1:

```sh
npm publish ./stablechain-agent-wallet-cli-0.2.1.tgz --access public
```

This requires authenticated publish access to `@stablechain`. If npm requests login or an OTP, the maintainer completes it; never place a token or OTP in source. npm versions are immutable. Do not overwrite 0.2.0 or point to an unpublished version in production.

Commit the reviewed release and create the matching `cli-v0.2.1` tag on that commit. Push the branch and tag, then run:

```sh
npm run verify:published-cli
```

That command verifies both the public npm tarball integrity and the tagged skill against this checkout. If either differs, stop and prepare a new version. Do not move an existing release tag.

## Deploy and prove the public flow

Merge only after PR verification passes and the matching package/tag are available. Main runs the publication check before deploying. Smoke-test the deployed website in MetaMask and complete a fresh-signer acceptance walkthrough:

- Connect a visitor wallet and create a fresh signer with persistent state.
- Approve 0.01 USDT0 and fund the agent’s gas separately.
- Send 0.006 to a different recipient; verify the exact receipt and 0.004 remaining allowance.
- Dry-run another 0.006 and confirm rejection before signing.
- Recheck/recover a confirmed payment using the original ID; no second transfer may be broadcast.
- Revoke the remaining allowance and confirm a positive transfer fails.
- Check account/network changes, wallet rejection, phone reflow, invalid fields, clipboard fallback and retained pending-operation recovery.

Record the release commit, immutable tag, package version and integrity, deployed URL, check results, payment IDs and transaction hashes. Historical self-transfers and fixture tests do not substitute for this run. Never publish private signer state.

## Freeze handoff

Freeze functional changes once acceptance is recorded. Keep permitted follow-up work limited to regressions, release corrections and documentation fixes. Add the final walkthrough link to the README when the video exists. Prepare the article, video, tweet thread and Discord announcement from the same frozen journey and evidence; no assets are produced or scheduled by this checklist.
