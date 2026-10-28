import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFile(resolve(root, path), 'utf8');
const manifest = JSON.parse(await read('package.json'));
const cli = JSON.parse(await read('packages/cli/package.json'));
const lock = JSON.parse(await read('package-lock.json'));
const version = manifest.version;
assert.equal(cli.version, version, 'Root and CLI release versions must match.');
assert.equal(lock.version, version, 'Refresh the package lock after changing the release version.');
assert.equal(lock.packages[''].version, version);
const release = await read('web/src/release.ts');
assert.ok(release.includes(`CLI_VERSION = '${version}'`), 'Website must install the released CLI.');
assert.ok(
  release.includes(`SKILL_REVISION = 'cli-v${version}'`),
  'Pin the skill to the matching release tag.',
);
for (const file of [
  'README.md',
  'packages/cli/README.md',
  'docs/cli.md',
  'skills/agent-wallet-cli/SKILL.md',
]) {
  const source = await read(file);
  const pins = [...source.matchAll(/@stablechain\/agent-wallet-cli@([\d.]+)/g)];
  assert.ok(pins.length, `${file} must include the pinned CLI installation command.`);
  for (const pin of pins)
    assert.equal(pin[1], version, `${file} installs a different CLI version.`);
  // Catch missing relative documentation links without requiring a network.
  for (const match of source.matchAll(/\]\(([^\s)]+)\)/g)) {
    const destination = match[1].split('#')[0];
    if (!destination || /^[a-z]+:/i.test(destination)) continue;
    // Package docs/skills are copied at pack time; validate their source paths
    // so this check also works before the first build in a clean checkout.
    const packageSource = file === 'packages/cli/README.md' && /^(docs|skills)\//.test(destination);
    await access(resolve(root, packageSource ? '.' : dirname(file), destination));
  }
}
console.error(`Release ${version}: CLI, website, skill, docs and local links agree.`);
