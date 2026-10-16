import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { publishInOrder, validateRelease, type PublishedPackage, type ReleasePackage } from '../scripts/release';

const sdk = { name: '@stablechain/agent-wallet-sdk', version: '0.1.1', filename: 'sdk.tgz', integrity: 'sha512-sdk', shasum: 'sdk' };
const cli = { name: '@stablechain/agent-wallet-cli', version: '0.1.1', filename: 'cli.tgz', integrity: 'sha512-cli', shasum: 'cli' };
const published = (pkg: ReleasePackage): PublishedPackage => ({ ...pkg, dist: { integrity: pkg.integrity, shasum: pkg.shasum } });
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'agent-wallet-release-test-'));
  directories.push(root);
  const lock: { packages: Record<string, unknown> } = { packages: {} };
  for (const kind of ['sdk', 'cli', 'web']) {
    const manifest = {
      name: kind === 'sdk' ? sdk.name : kind === 'cli' ? cli.name : 'agent-wallet-web',
      version: '0.1.1',
      dependencies: kind === 'sdk' ? undefined : { [sdk.name]: '0.1.1' },
      repository: { url: 'git+https://github.com/stablelabs/agentic.stable.xyz.git' },
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
    };
    await mkdir(resolve(root, 'packages', kind), { recursive: true });
    await writeFile(resolve(root, 'packages', kind, 'package.json'), JSON.stringify(manifest));
    lock.packages[`packages/${kind}`] = manifest;
  }
  await writeFile(resolve(root, 'package-lock.json'), JSON.stringify(lock));
  return root;
}

it('requires a stable tag matching both versions and their dependency lockfile', async () => {
  const root = await fixture();
  expect(await validateRelease(root, 'v0.1.1')).toEqual({ tag: 'v0.1.1', version: '0.1.1' });
  await expect(validateRelease(root, 'v0.1.2')).rejects.toThrow('name/version');
  await expect(validateRelease(root, 'v0.1.1-beta.1')).rejects.toThrow('stable release tag');
});

it('rejects consumer dependency drift and stale lockfiles before publication', async () => {
  const root = await fixture();
  const path = resolve(root, 'packages/web/package.json');
  const web = JSON.parse(await readFile(path, 'utf8'));
  web.dependencies[sdk.name] = '0.1.0';
  await writeFile(path, JSON.stringify(web));
  await expect(validateRelease(root)).rejects.toThrow('depend on SDK 0.1.1 exactly');
  web.dependencies[sdk.name] = '0.1.1';
  web.version = '0.1.2';
  await writeFile(path, JSON.stringify(web));
  await expect(validateRelease(root)).rejects.toThrow('Regenerate package-lock.json');
});

it('rejects private packages and mismatched repository or registry settings', async () => {
  const root = await fixture();
  const path = resolve(root, 'packages/sdk/package.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...manifest, private: true }));
  await expect(validateRelease(root)).rejects.toThrow('publishable');
  await writeFile(path, JSON.stringify({ ...manifest, repository: { url: 'https://github.com/other/repo' } }));
  await expect(validateRelease(root)).rejects.toThrow('this GitHub repository');
});

it('waits for SDK availability before publishing the CLI', async () => {
  const calls: string[] = [];
  const result = await publishInOrder([sdk, cli], {
    lookup: async () => null,
    publish: async pkg => { calls.push(`publish:${pkg.name}`); },
    wait: async pkg => { calls.push(`available:${pkg.name}`); },
  });
  expect(calls).toEqual([`publish:${sdk.name}`, `available:${sdk.name}`, `publish:${cli.name}`, `available:${cli.name}`]);
  expect(result.every(item => item.status === 'published')).toBe(true);
});

it('resumes a partial release without republishing the identical SDK', async () => {
  const calls: string[] = [];
  const result = await publishInOrder([sdk, cli], {
    lookup: async pkg => pkg.name === sdk.name ? published(pkg) : null,
    publish: async pkg => { calls.push(pkg.name); },
    wait: async () => {},
  });
  expect(calls).toEqual([cli.name]);
  expect(result.map(item => item.status)).toEqual(['already-published', 'published']);
});

it('checks both published artifacts before making any mutation', async () => {
  let mutations = 0;
  await expect(publishInOrder([sdk, cli], {
    lookup: async pkg => pkg.name === cli.name ? { ...published(pkg), dist: { integrity: 'different', shasum: 'different' } } : null,
    publish: async () => { mutations++; },
    wait: async () => {},
  })).rejects.toThrow('different bytes');
  expect(mutations).toBe(0);
});

it('skips both exact artifacts after a complete release instead of publishing an existing version', async () => {
  let mutations = 0;
  const results = await publishInOrder([sdk, cli], {
    lookup: async pkg => published(pkg),
    publish: async () => { mutations++; },
    wait: async () => {},
  });
  expect(mutations).toBe(0);
  expect(results.map(item => item.status)).toEqual(['already-published', 'already-published']);
});

it('does not publish the CLI if the SDK is still unavailable', async () => {
  const calls: string[] = [];
  await expect(publishInOrder([sdk, cli], {
    lookup: async () => null,
    publish: async pkg => { calls.push(pkg.name); },
    wait: async () => { throw new Error('still processing'); },
  })).rejects.toThrow('still processing');
  expect(calls).toEqual([sdk.name]);
});
