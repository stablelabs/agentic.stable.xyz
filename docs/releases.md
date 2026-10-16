# Releasing the CLI and SDK

`@stablechain/agent-wallet-sdk` and `@stablechain/agent-wallet-cli` are public npm packages with a shared release version. Both have GitHub Actions trusted publishers configured for this repository. The [v0.1.1 release](https://github.com/stablelabs/agentic.stable.xyz/actions/runs/38831802912) published both through OIDC and verified an anonymous installation.

## What triggers a release

| Action | Result |
| --- | --- |
| Push a commit to `main` | [deploy.yml](../.github/workflows/deploy.yml) builds and deploys the web app. It does not publish npm packages. |
| Push a stable `vMAJOR.MINOR.PATCH` tag | [publish.yml](../.github/workflows/publish.yml) validates and tests the tagged commit, then publishes the SDK and CLI. The commit must be contained in `main`. |
| Manually run **Publish npm packages** on `main` | Run all release checks and a packed publish dry run. No packages are published. |

The release job uses Ubuntu 24.04, Node 24, npm 11.21.0, Foundry 1.5.1, and Chromium. It authenticates to npm through OIDC with `id-token: write`, without an npm publishing token or wallet keys. It publishes provenance automatically through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Prepare an unpublished version

Choose a new stable version for both public packages. `0.1.1` is already published; the following uses `0.1.2` as the next example. Run from the repository root, using the same shell for subsequent commands:

```sh
release_version=0.1.2
npm version "$release_version" --workspace packages/sdk --workspace packages/cli --no-git-tag-version
npm pkg set "dependencies.@stablechain/agent-wallet-sdk=$release_version" --workspace packages/cli --workspace packages/web
npm install --package-lock-only
npm run release:check -- --tag "v$release_version"
```

The SDK and CLI manifests must match the tag. The CLI and web app must depend on that exact SDK version, and the lockfile must match the manifests. The private root, web, and contracts package versions do not need to match the public release version.

Update pinned installation examples in the root/package READMEs and CLI/SDK guides. `release:check` validates metadata and dependencies; it does not build or test code.

## Validate before tagging

With [Foundry 1.5.1](https://getfoundry.sh/introduction/installation) available, run:

```sh
npm ci
npx playwright install chromium
npm run check
CI=1 npm test
npm run test:contracts
npm run test:browser
npm run build:cloudflare
npm run release:publish -- --dry-run
```

Use `npx playwright install --with-deps chromium` when Linux also needs browser system libraries. `CI=1` permits registry access in the packed-consumer test, which otherwise uses npm's offline cache locally. Match CI's build tool versions when comparing packed artifacts.

The dry run packs both packages, checks artifact contents and checksums, and dry-runs unpublished versions. If the same version already exists, it is skipped only when its bytes match. An error about **different bytes** means the selected version is already immutable on npm. README edits also change package bytes: bump the version before validating a new package release rather than treating that error as an authentication problem.

Commit and push the reviewed release changes to `main`. You can run **Publish npm packages** manually on `main` to perform the same checks on GitHub before tagging. Confirm the version and commit, then push the matching tag:

```sh
git tag "v$release_version"
git push origin "v$release_version"
```

An actual local `release:publish` without `--dry-run` is refused: publishing requires this repository's tagged GitHub Actions run and OIDC permission.

## What the tagged workflow verifies

The workflow validates the tag, package metadata, lockfile, types, contract formatting/tests, integration tests, packed consumers, browser tests, and production web build before publishing. It then:

1. Packs SDK and CLI artifacts and checks both selected npm versions before publishing either.
2. Publishes the SDK and waits for matching checksums in both full and abbreviated npm install metadata.
3. Publishes the CLI and waits for its install metadata.
4. Installs the CLI from public npm with an empty user configuration and fresh cache, then verifies CLI version/help and the SDK export.

Release jobs are serialized and are not automatically cancelled by a newer tag. Check the run's publishing step and summary for the published versions and anonymous installation result. Registry propagation can take several minutes; the helper waits up to twelve minutes per package. An accepted publish is not a reason to submit the same version again while metadata is catching up.

## Recover a partial release

Rerun the failed tagged workflow at the same commit. The helper checks both immutable versions before any publish. An already-published SDK or CLI is retained only when its checksums match the newly packed artifact, allowing a failed CLI publish or delayed propagation check to resume safely.

A different artifact at an existing version is an error. Inspect the mismatch and prepare a new version. Do not move a published tag or attempt to overwrite an npm version. To stop unfinished work, cancel its GitHub Actions run; published packages remain available. Corrections use a new patch release.

## Trusted-publisher configuration

The existing packages are configured with these settings. Use them when restoring a publisher or connecting a replacement package:

| Setting | Value |
| --- | --- |
| GitHub owner | `stablelabs` |
| Repository | `agentic.stable.xyz` |
| Workflow filename | `publish.yml` |
| Allowed action | Direct `npm publish` |
| GitHub environment | Leave empty |

Configure each package separately through its npm settings or `npm trust`. Changing this connection requires a maintainer's interactive npm authentication and 2FA. Normal tagged publishes use OIDC without that browser challenge. If the repository, workflow filename, or environment changes, update both npm connections before releasing.
