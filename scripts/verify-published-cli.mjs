import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

// Deployment must never point users at an unavailable or different CLI/skill.
const { version } = JSON.parse(
  await readFile(new URL('../packages/cli/package.json', import.meta.url), 'utf8'),
);
const registry = `https://registry.npmjs.org/@stablechain%2fagent-wallet-cli/${version}`;
const skillUrl = `https://raw.githubusercontent.com/stablelabs/agentic.stable.xyz/cli-v${version}/skills/agent-wallet-cli/SKILL.md`;
const [packageResponse, skillResponse] = await Promise.all(
  [registry, skillUrl].map((url) => fetch(url, { signal: AbortSignal.timeout(20_000) })),
);
assert.ok(
  packageResponse.ok,
  `Publish CLI ${version} before deploying its website (registry returned ${packageResponse.status}).`,
);
assert.ok(
  skillResponse.ok,
  `Push the cli-v${version} release tag before deploying (skill returned ${skillResponse.status}).`,
);
const published = await packageResponse.json();
assert.equal(
  await skillResponse.text(),
  await readFile(new URL('../skills/agent-wallet-cli/SKILL.md', import.meta.url), 'utf8'),
  'Tagged skill differs from this checkout.',
);
const directory = await mkdtemp(join(tmpdir(), 'verify-agent-cli-'));
try {
  const { stdout } = await promisify(execFile)(
    'npm',
    ['--silent', 'pack', './packages/cli', '--json', '--pack-destination', directory],
    { cwd: new URL('../', import.meta.url), maxBuffer: 1024 * 1024 },
  );
  const [packed] = JSON.parse(stdout);
  assert.equal(
    published.dist.integrity,
    packed.integrity,
    'Published CLI differs from this checkout. Prepare a new release instead of changing an immutable version.',
  );
  console.log(`Published CLI ${version} and immutable skill match this checkout.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
