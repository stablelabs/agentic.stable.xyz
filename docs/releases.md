# Releasing the CLI and SDK

The repository publishes `@stablechain/agent-wallet-sdk` and `@stablechain/agent-wallet-cli` together from stable `vMAJOR.MINOR.PATCH` tags on commits contained in `main`. Ordinary pushes to `main` deploy the web app through the separate Cloudflare workflow.

## One-time npm setup

For each public package, configure a GitHub Actions trusted publisher with:

| Setting | Value |
| --- | --- |
| GitHub owner | `stablelabs` |
| Repository | `agentic.stable.xyz` |
| Workflow filename | `publish.yml` |
| Allowed action | `npm publish` |
| GitHub environment | Leave empty |

The workflow uses OIDC with `id-token: write`, Node 24, npm 11.21.0, and Foundry 1.5.1. It does not require an npm publishing token or wallet keys. Creating a trusted publisher requires a maintainer's interactive npm authentication. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Check the workflow without publishing

Run **Publish npm packages** manually from the repository's GitHub Actions page, selecting `main`. Manual runs execute all checks and dry-run the packed publishes. They cannot publish packages.

Locally:

```sh
npm ci
npm run check
npm test
npm run test:contracts
npm run test:browser
npm run build:cloudflare
npm run release:check
npm run release:publish -- --dry-run
```

Foundry 1.5.1 and Chromium must be installed to run all checks. GitHub installs both. The packaging test permits registry access in CI so it also works with an empty npm cache.

## Prepare a version

Use an unpublished stable version for both packages. Update the CLI and web app's exact SDK dependency and regenerate the lockfile:

```sh
npm version 0.1.1 --workspace packages/sdk --workspace packages/cli --no-git-tag-version
npm pkg set 'dependencies.@stablechain/agent-wallet-sdk=0.1.1' --workspace packages/cli --workspace packages/web
npm install --package-lock-only
npm run release:check -- --tag v0.1.1
```

Update versioned installation examples and release notes as appropriate. Commit and push the release changes to `main`, then create and push the matching tag:

```sh
git tag v0.1.1
git push origin v0.1.1
```

The workflow checks the tag, manifests, lockfile, types, contract tests, integration tests, packed consumers, browser tests, and production web build before publishing. It packs immutable tarballs, publishes the SDK first, waits for both npm metadata formats to serve its matching checksum, then publishes the CLI. Finally it installs the CLI anonymously from npm and verifies CLI execution and the SDK export.

## Recover a partial release

Rerun the failed tagged workflow at the same commit. The release helper checks both published versions before any mutation. An already-published artifact is skipped only when its checksums match the newly packed artifact. This allows a successful SDK publish to be retained while retrying a failed CLI publish or delayed registry propagation.

A different artifact at an existing version is an error. Investigate it and prepare a new version instead of moving a tag or attempting to overwrite an npm release. To stop a release that has not finished, cancel its GitHub Actions run. Published npm versions remain immutable; corrections use a new patch release.
