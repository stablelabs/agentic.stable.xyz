import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const execute = promisify(execFile);
const binary = resolve('agent/main.ts');
const loader = pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'token-cli-')); directories.push(directory);
  const state = resolve(directory, 'state');
  const run = async (...args: string[]) => JSON.parse((await execute(process.execPath, ['--import', loader, binary, ...args, '--state-dir', state, '--json'])).stdout);
  const initialized = await run('init');
  const config = { schemaVersion: 2, chainId: 2201, token: '0x78Cf24370174180738C5B8E352B6D14c83a6c9A9', alice: '0x1111111111111111111111111111111111111111', rpcUrl: 'https://rpc.testnet.stable.xyz', approvalUrl: 'https://agentic.stable.xyz' };
  await writeFile(resolve(state, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  return { state, run, initialized, config };
}
it('generates a retained signer and an approval link addressed to that signer', async () => {
  const { run, initialized } = await fixture(); expect(initialized.schemaVersion).toBe(2);
  expect((await run('init')).data).toMatchObject({ retained: true, address: initialized.data.address });
  const link = new URL((await run('allowance', 'link', '--amount', '0.01')).data.approvalUrl);
  expect(link.searchParams.get('agent')).toBe(initialized.data.address); expect(link.searchParams.get('amount')).toBe('0.01');
  expect([...link.searchParams.keys()].sort()).toEqual(['agent', 'amount']);
});
it('imports public settings and links an approval without contacting the RPC', async () => {
  const { run, state, initialized, config } = await fixture();
  // A wrong-chain RPC records every request: import and link must make none.
  const methods: string[] = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { const { id, method } = JSON.parse(body); methods.push(method); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id, result: '0x1' })); });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  try {
    const file = resolve(state, '..', 'public-config.json');
    await writeFile(file, JSON.stringify({ ...config, rpcUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` }));
    expect((await run('config', 'import', '--file', file)).data).toMatchObject({ alice: config.alice, token: config.token });
    const link = new URL((await run('allowance', 'link', '--amount', '0.01')).data.approvalUrl);
    expect(link.searchParams.get('agent')).toBe(initialized.data.address);
    expect(methods).toEqual([]);
    // Every onchain command still refuses an RPC that is not Stable Testnet.
    const recipient = '0x3333333333333333333333333333333333333333';
    const payment = (await run('payments', 'prepare', '--recipient', recipient, '--amount', '0.001')).data;
    for (const args of [['status'], ['allowance', 'show'], ['allowance', 'wait', '--amount', '0.01', '--timeout', '1s'], ['gas', 'check', '--recipient', recipient, '--amount', '0.001'], ['pay', '--payment-id', payment.paymentId, '--dry-run']]) {
      const failure = await run(...args).then(() => undefined, (error: { stdout: string }) => JSON.parse(error.stdout));
      expect(failure?.error, args.join(' ')).toMatchObject({ code: 'ACCOUNT_NOT_VERIFIED', message: 'RPC is not Stable Testnet (2201).' });
    }
    expect(methods.length).toBeGreaterThan(0); expect(new Set(methods)).toEqual(new Set(['eth_chainId']));
    expect((await run('doctor')).data.checks.find((check: { name: string }) => check.name === 'network')).toMatchObject({ ok: false, code: 'ACCOUNT_NOT_VERIFIED' });
  } finally { await new Promise<void>(done => server.close(() => done())); }
});
it('prepares immutable local payment terms without requiring a grant or RPC', async () => {
  const { run, state, initialized, config } = await fixture();
  const p = await run('payments', 'prepare', '--recipient', '0x3333333333333333333333333333333333333333', '--amount', '0.006');
  expect(p.data).toMatchObject({ amountAtomic: '6000', status: 'created', intent: { alice: config.alice, agent: initialized.data.address } });
  expect((await run('payments', 'show', p.data.paymentId)).data).toEqual(p.data);
  const journal = JSON.parse(await readFile(resolve(state, `payment-${p.data.paymentId}.json`), 'utf8'));
  expect(journal.schemaVersion).toBe(2); expect(journal.raw).toBeUndefined();
  await expect(run('pay', '--payment-id', p.data.paymentId, '--amount', '0.004')).rejects.toMatchObject({ code: 2 });
});
it('rejects retired commands, retired grant arguments, and invalid precision before writing payment state', async () => {
  const { run } = await fixture();
  for (const args of [['grants', 'list'], ['payments', 'prepare', '--grant', `0x${'01'.repeat(32)}`], ['payments', 'prepare', '--recipient', '0x3333333333333333333333333333333333333333', '--amount', '0.0000001']]) {
    await expect(run(...args)).rejects.toMatchObject({ code: 2 });
  }
  expect((await run('payments', 'list')).data).toEqual([]);
});

it('isolates the new default state directory from legacy state', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'token-cli-default-')); directories.push(directory);
  await mkdir(resolve(directory, '.agent-wallet'), { mode: 0o700 });
  await writeFile(resolve(directory, '.agent-wallet/config.json'), '{"schemaVersion":1}', { mode: 0o600 });
  const output = JSON.parse((await execute(process.execPath, ['--import', loader, binary, 'status', '--json'], {cwd: directory, env: {...process.env, WALLET_STATE_DIR: ''}})).stdout);
  expect(output.data.configured).toBe(false); expect(output.data.stateDir).toBe(resolve(await realpath(directory), '.agent-wallet-erc20'));
});
