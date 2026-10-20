import { afterEach, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { encodeFunctionData, keccak256 } from 'viem';
import { AgentContext } from '../agent/context';
import { loadPayment, type PaymentJournal } from '../agent/payments';
import { tokenAbi, TOKEN } from '../shared/protocol.js';
import { exists } from '../agent/state';

const directories: string[] = [];
async function context() {
  const directory = await mkdtemp(resolve(tmpdir(), 'agent-wallet-state-'));
  directories.push(directory);
  return new AgentContext(resolve(directory, 'state'));
}
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

it('rejects unsafe permissions without replacing keys', async () => {
  const ctx = await context(); await ctx.init();
  const path = ctx.state.path('agent-key.json');
  const original = await readFile(path, 'utf8');
  await chmod(path, 0o644);
  await expect(ctx.init()).rejects.toMatchObject({ code: 'UNSAFE_STATE' });
  expect(await readFile(path, 'utf8')).toBe(original);
  await chmod(path, 0o600); await chmod(ctx.state.directory, 0o755);
  await expect(ctx.init()).rejects.toMatchObject({ code: 'UNSAFE_STATE' });
});

it('rejects a key/address mismatch without generating a replacement key', async () => {
  const ctx = await context(); await ctx.init();
  const original = await ctx.state.read<Record<string, string>>('agent-key.json');
  await ctx.state.write('agent-key.json', { ...original, address: '0x1111111111111111111111111111111111111111' });
  await expect(ctx.init()).rejects.toMatchObject({ code: 'INVALID_KEY_RECORD' });
  expect((await ctx.state.read<typeof original>('agent-key.json')).privateKey === original.privateKey).toBe(true);
});

it('rejects symlink records and leaves stale locks for explicit inspection', async () => {
  const ctx = await context(); await ctx.init();
  const target = resolve(ctx.state.directory, '../target.json');
  await writeFile(target, '{}', { mode: 0o600 });
  await symlink(target, ctx.state.path('config.json'));
  await expect(ctx.config()).rejects.toMatchObject({ code: 'UNSAFE_STATE' });
  await expect(ctx.state.write('config.json', {})).rejects.toMatchObject({ code: 'UNSAFE_STATE' });
  await writeFile(ctx.state.path('command.lock'), '999999', { mode: 0o600 });
  await expect(ctx.init()).rejects.toMatchObject({ code: 'STATE_LOCKED' });
  expect(await exists(ctx.state.path('command.lock'))).toBe(true);
  expect(await readFile(target, 'utf8')).toBe('{}');
});

it('validates transferFrom signed bytes against their immutable intent', async () => {
  const ctx = await context(); await ctx.init();
  const account = await ctx.account(), id = keccak256('0x01'), otherHash = keccak256('0x02');
  const alice = '0x1111111111111111111111111111111111111111', recipient = '0x3333333333333333333333333333333333333333';
  const raw = await account.signTransaction({ chainId: 2201, type: 'eip1559', nonce: 0, gas: 100_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n, to: TOKEN, data: encodeFunctionData({ abi: tokenAbi, functionName: 'transferFrom', args: [alice, recipient, 1000n] }) });
  const journal: PaymentJournal = { schemaVersion: 2, kind: 'payment', id, context: {chainId: 2201, token: TOKEN}, intent: { alice, agent: account.address, recipient, amount: '1000' }, raw, hash: keccak256(raw), status: 'signed' };
  await ctx.state.write(`payment-${id}.json`, journal);
  expect((await loadPayment(ctx, id)).nonce).toBe('0');
  for (const altered of [{ ...journal, intent: { ...journal.intent, amount: '2000' } }, { ...journal, nonce: '1' }, { ...journal, hash: otherHash }]) {
    await ctx.state.write(`payment-${id}.json`, altered);
    await expect(loadPayment(ctx, id)).rejects.toMatchObject({ code: 'INVALID_PAYMENT_JOURNAL' });
  }
});

it('refuses old payment records instead of treating them as new token payments', async () => {
  const ctx = await context(); await ctx.init(); const id = keccak256('0x04');
  await ctx.state.write(`payment-${id}.json`, {schemaVersion: 1, kind: 'payment', id});
  await expect(loadPayment(ctx, id)).rejects.toMatchObject({code: 'LEGACY_PAYMENT_JOURNAL'});
});
