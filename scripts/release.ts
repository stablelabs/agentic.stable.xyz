import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const execute = promisify(execFile);
const registry = 'https://registry.npmjs.org/';
const repository = 'stablelabs/agentic.stable.xyz';
const npmRepository = `git+https://github.com/${repository}.git`;
const sdkName = '@stablechain/agent-wallet-sdk';
const cliName = '@stablechain/agent-wallet-cli';
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
type Manifest = { name: string; version: string; private?: boolean; dependencies?: Record<string, string>; repository?: { url: string }; publishConfig?: { access: string; registry: string } };
export type ReleasePackage = { name: string; version: string; filename: string; integrity: string; shasum: string };
export type PublishedPackage = { name: string; version: string; dist: { integrity: string; shasum: string } };

export async function validateRelease(root: string, tag?: string) {
  const sdk: Manifest = await json(resolve(root, 'packages/sdk/package.json'));
  const cli: Manifest = await json(resolve(root, 'packages/cli/package.json'));
  const web: Manifest = await json(resolve(root, 'packages/web/package.json'));
  const releaseTag = tag || `v${sdk.version}`;
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(releaseTag)) throw new Error('Use a stable release tag such as v0.1.1.');
  for (const [kind, manifest, name] of [['sdk', sdk, sdkName], ['cli', cli, cliName]] as const) {
    if (manifest.name !== name || manifest.private || manifest.version !== releaseTag.slice(1)) throw new Error(`${kind} name/version must match ${releaseTag} and be publishable.`);
    if (manifest.repository?.url !== npmRepository || manifest.publishConfig?.registry !== registry || manifest.publishConfig?.access !== 'public') throw new Error(`${name} must target the public npm registry and this GitHub repository.`);
  }
  for (const manifest of [cli, web]) {
    if (manifest.dependencies?.[sdkName] !== sdk.version) throw new Error(`${manifest.name} must depend on SDK ${sdk.version} exactly.`);
  }
  const lock = await json(resolve(root, 'package-lock.json'));
  for (const kind of ['sdk', 'cli', 'web']) {
    const expected: Manifest = await json(resolve(root, `packages/${kind}/package.json`));
    const locked = lock.packages[`packages/${kind}`];
    if (locked?.version !== expected.version || JSON.stringify(locked?.dependencies ?? {}) !== JSON.stringify(expected.dependencies ?? {})) throw new Error(`Regenerate package-lock.json for packages/${kind}.`);
  }
  return { tag: releaseTag, version: sdk.version };
}

export async function packRelease(root: string, directory: string): Promise<ReleasePackage[]> {
  await mkdir(directory, { recursive: true });
  const packages: ReleasePackage[] = [];
  for (const kind of ['sdk', 'cli']) {
    const output = await execute('npm', ['pack', resolve(root, 'packages', kind), '--json', '--pack-destination', directory], { cwd: root });
    const pack = JSON.parse(output.stdout)[0];
    if (pack.name !== (kind === 'sdk' ? sdkName : cliName)) throw new Error('Unexpected packed package.');
    if (!pack.files.every((file: { path: string }) => /^(package\.json|README\.md|LICENSE(?:\.md)?|dist\/.+\.(?:js|d\.ts))$/.test(file.path))) throw new Error(`Unexpected files in ${pack.name}.`);
    const bytes = await readFile(resolve(directory, pack.filename));
    const shasum = createHash('sha1').update(bytes).digest('hex');
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    if (shasum !== pack.shasum || integrity !== pack.integrity) throw new Error('Packed artifact integrity mismatch.');
    packages.push({ name: pack.name, version: pack.version, filename: pack.filename, integrity, shasum });
  }
  await writeFile(resolve(directory, 'release.json'), JSON.stringify(packages, null, 2) + '\n');
  return packages;
}

function assertSameArtifact(published: PublishedPackage, pkg: ReleasePackage) {
  if (published.name !== pkg.name || published.version !== pkg.version || published.dist?.integrity !== pkg.integrity || published.dist?.shasum !== pkg.shasum) throw new Error(`${pkg.name}@${pkg.version} already exists with different bytes. Never overwrite it; inspect the release or use a new version.`);
}

export async function publishInOrder(packages: ReleasePackage[], operations: {
  lookup: (pkg: ReleasePackage) => Promise<PublishedPackage | null>;
  publish: (pkg: ReleasePackage) => Promise<void>;
  wait: (pkg: ReleasePackage) => Promise<void>;
}) {
  // Check both immutable versions before publishing either package.
  const existing = await Promise.all(packages.map(pkg => operations.lookup(pkg)));
  existing.forEach((published, index) => { if (published) assertSameArtifact(published, packages[index]); });
  const results: { name: string; status: 'published' | 'already-published' }[] = [];
  for (const [index, pkg] of packages.entries()) {
    if (!existing[index]) await operations.publish(pkg);
    await operations.wait(pkg);
    results.push({ name: pkg.name, status: existing[index] ? 'already-published' : 'published' });
  }
  return results;
}

async function fetchMetadata<T>(path: string, accept = 'application/json'): Promise<T | null> {
  const response = await fetch(new URL(path, registry), { headers: { Accept: accept, 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry lookup failed (${response.status}).`);
  return await response.json() as T;
}

async function lookup(pkg: ReleasePackage): Promise<PublishedPackage | null> {
  return await fetchMetadata<PublishedPackage>(`${pkg.name.replace('/', '%2f')}/${pkg.version}`);
}

async function waitForRegistry(pkg: ReleasePackage) {
  console.log(`Waiting for public npm install metadata: ${pkg.name}@${pkg.version}`);
  const started = Date.now();
  while (Date.now() - started < 12 * 60_000) {
    // npm clients use both full and abbreviated metadata; a version record alone is insufficient.
    const records = await Promise.all(['application/json', 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*'].map(accept => fetchMetadata<{ versions?: Record<string, PublishedPackage> }>(pkg.name.replace('/', '%2f'), accept)));
    const versions = records.map(record => record?.versions?.[pkg.version]);
    versions.forEach(published => { if (published) assertSameArtifact(published, pkg); });
    if (versions.every(Boolean)) return;
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  throw new Error(`npm is still processing ${pkg.name}@${pkg.version}. Rerun the same workflow; it will retain matching published artifacts.`);
}

async function smokeTest(version: string) {
  const directory = await mkdtemp(resolve(tmpdir(), 'agent-wallet-release-smoke-'));
  try {
    const config = resolve(directory, 'empty.npmrc');
    await writeFile(config, '');
    await writeFile(resolve(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm_config_(userconfig|cache)|node_auth_token|npm_token)$/i.test(key)));
    Object.assign(env, { NPM_CONFIG_USERCONFIG: config, NPM_CONFIG_CACHE: resolve(directory, 'cache'), NPM_CONFIG_REGISTRY: registry, NPM_CONFIG_UPDATE_NOTIFIER: 'false' });
    await execute('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', `${cliName}@${version}`], { cwd: directory, env, timeout: 120_000 });
    const binary = resolve(directory, 'node_modules/.bin/agent-wallet');
    const result = JSON.parse((await execute(binary, ['--version', '--json'], { cwd: directory, env })).stdout);
    if (result.data !== version) throw new Error('Public CLI version smoke test failed.');
    const help = JSON.parse((await execute(binary, ['--help', '--json'], { cwd: directory, env })).stdout);
    if (!help.data.includes('payments resume')) throw new Error('Public CLI command smoke test failed.');
    await execute(process.execPath, ['--input-type=module', '-e', `import { createOwnerClient } from '${sdkName}'; if (typeof createOwnerClient !== 'function') process.exit(1);`], { cwd: directory, env });
    console.log(`Anonymous public install and CLI/SDK smoke tests passed for ${version}.`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { tag: { type: 'string' }, 'dry-run': { type: 'boolean' } } });
  const command = positionals[0];
  if (!['check', 'publish'].includes(command) || positionals.length !== 1) throw new Error('Usage: release.ts check|publish [--tag v0.1.1] [--dry-run]');
  const root = resolve('.');
  const release = await validateRelease(root, values.tag);
  if (command === 'check') { console.log(`Release manifests and lockfile match ${release.tag}.`); return; }
  if (!values['dry-run']) {
    if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== `refs/tags/${release.tag}` || !process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error('Publishing requires this repository’s tagged GitHub Actions run with OIDC permission.');
  }
  const directory = resolve(root, '.release');
  const packages = await packRelease(root, directory);
  if (packages.some(pkg => pkg.version !== release.version)) throw new Error('Package version changed while preparing the release.');
  if (values['dry-run']) {
    for (const pkg of packages) {
      await execute('npm', ['publish', resolve(directory, pkg.filename), '--access', 'public', '--registry', registry, '--dry-run'], { cwd: root });
    }
    console.log(`Dry run passed for ${release.tag}; packed SDK and CLI without publishing.`);
    return;
  }
  const results = await publishInOrder(packages, {
    lookup,
    publish: async pkg => {
      const result = await execute('npm', ['publish', resolve(directory, pkg.filename), '--access', 'public', '--registry', registry], { cwd: root, timeout: 120_000 });
      console.log(result.stdout); console.log(result.stderr);
    },
    wait: waitForRegistry,
  });
  await smokeTest(release.version);
  console.log(JSON.stringify(results, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Released ${release.tag}\n\n${results.map(item => `- ${item.name}: ${item.status}`).join('\n')}\n\nPublic installation smoke test passed.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stderr || error.message); process.exitCode = 1; });
}
