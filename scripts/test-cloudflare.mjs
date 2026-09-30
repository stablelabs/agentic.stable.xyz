import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const bundled = await build({
  entryPoints: ['cloudflare/tests/fixture.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire("/");',
  },
  conditions: ['workerd', 'worker', 'import'],
  external: ['node:*', 'cloudflare:*'],
  target: 'es2022',
});
const storage = await mkdtemp(join(tmpdir(), 'agentic-cloudflare-test-'));
const options = convertV4MiniflareOptions({
  name: 'agentic-fixture',
  modules: true,
  script: bundled.outputFiles[0].text,
  compatibilityDate: '2026-09-29',
  compatibilityFlags: ['nodejs_compat'],
  durableObjects: { TEST: { className: 'TestLedger', useSQLite: true } },
  resourcePersistencePath: storage,
});
let runtime = new Miniflare(options);
try {
  let namespace = await runtime.getDurableObjectNamespace('TEST');
  const first = await namespace
    .get(namespace.idFromName('ledger-test'))
    .fetch('http://test/exercise');
  const checks = await first.json();
  assert.equal(first.status, 200, JSON.stringify(checks));
  await runtime.dispose();
  runtime = new Miniflare(options);
  namespace = await runtime.getDurableObjectNamespace('TEST');
  const second = await namespace
    .get(namespace.idFromName('ledger-test'))
    .fetch('http://test/verify');
  const persistence = await second.json();
  assert.equal(second.status, 200, JSON.stringify(persistence));
  const evidence = { checkedAt: new Date().toISOString(), ...checks, ...persistence };
  await mkdir('evidence', { recursive: true });
  await writeFile('evidence/cloudflare-local.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await runtime.dispose();
  await rm(storage, { recursive: true, force: true });
}
