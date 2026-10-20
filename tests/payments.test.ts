import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, keccak256, parseTransaction, recoverTransactionAddress, TransactionReceiptNotFoundError, type Hex, type TransactionSerialized } from 'viem';
import { AgentContext } from '../agent/context';
import { pay, preparePayment, waitPayment, loadPayment } from '../agent/payments';
import { tokenAbi, TOKEN, type WalletConfig } from '../shared/protocol.js';

// Keep real local signing and decoding; avoid external RPC during unit tests.
vi.mock('viem', async original => {
  const actual = await original<typeof import('viem')>();
  return { ...actual, createWalletClient: ({ account }: any) => ({
    prepareTransactionRequest: async (r: any) => ({ chainId: 2201, type: 'eip1559', nonce: r.nonce, to: r.to, data: r.data, value: 0n, gas: r.gas, maxFeePerGas: r.maxFeePerGas, maxPriorityFeePerGas: 0n }),
    signTransaction: (r: any) => account.signTransaction(r),
  }) };
});
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const alice = '0x1111111111111111111111111111111111111111';
const recipient = '0x3333333333333333333333333333333333333333';
async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'token-payments-')); directories.push(directory);
  const ctx = new AgentContext(resolve(directory, 'state')); await ctx.init(); const agent = await ctx.identity();
  const config: WalletConfig = { schemaVersion: 2, chainId: 2201, rpcUrl: 'https://rpc.testnet.stable.xyz', token: TOKEN, alice, approvalUrl: 'https://agentic.stable.xyz' };
  await ctx.state.write('config.json', config);
  const state = { allowance: 10_000n, aliceBalance: 100_000n, received: 0n, native: 10n ** 18n, nonce: 0, offline: false, hiddenReceipt: false, falseReturn: false };
  const receipts = new Map<Hex, any>(); const transactions = new Map<Hex, any>();
  const client: any = {
    getChainId: async () => 2201,
    readContract: async ({ functionName }: any) => ({ allowance: state.allowance, balanceOf: state.aliceBalance, decimals: 6, symbol: 'USDT0' })[functionName as 'allowance'],
    getBalance: async () => state.native, getBlock: async () => ({ number: 1n, baseFeePerGas: 10n }), getTransactionCount: async () => state.nonce,
    simulateContract: vi.fn(async () => ({ result: !state.falseReturn })), estimateGas: vi.fn(async () => 50_000n),
    getTransactionReceipt: async ({ hash }: any) => { if (state.hiddenReceipt || !receipts.has(hash)) throw new TransactionReceiptNotFoundError({hash}); return receipts.get(hash); },
    waitForTransactionReceipt: async ({ hash }: any) => { if (state.hiddenReceipt || !receipts.has(hash)) throw new Error('timeout'); return receipts.get(hash); },
    getTransaction: async ({ hash }: any) => { if (state.offline || !transactions.has(hash)) throw new Error('offline'); return transactions.get(hash); },
    sendRawTransaction: vi.fn(async ({ serializedTransaction: raw }: { serializedTransaction: Hex }) => {
      const hash = keccak256(raw); if (receipts.has(hash)) return hash;
      const tx = parseTransaction(raw); const signer = await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized });
      const decoded = decodeFunctionData({ abi: tokenAbi, data: tx.data! });
      expect(tx.to?.toLowerCase()).toBe(TOKEN.toLowerCase()); expect(signer).toBe(agent); expect(decoded.functionName).toBe('transferFrom');
      const [from, to, amount] = decoded.args as [Hex, Hex, bigint]; expect(from).toBe(alice);
      if (state.allowance < amount || state.aliceBalance < amount) throw new Error('token rejected');
      state.allowance -= amount; state.aliceBalance -= amount; state.received += amount; state.nonce++;
      transactions.set(hash, { from: signer, to: tx.to, input: tx.data, value: tx.value ?? 0n });
      receipts.set(hash, { status: 'success', transactionHash: hash, blockNumber: 1n, gasUsed: 50_000n, effectiveGasPrice: 10n, logs: [{ address: TOKEN, topics: encodeEventTopics({ abi: tokenAbi, eventName: 'Transfer', args: { from, to } }), data: encodeAbiParameters([{ type: 'uint256' }], [amount]) }] });
      if (state.offline) throw new Error('connection lost after broadcast'); return hash;
    }),
  };
  vi.spyOn(ctx, 'public').mockResolvedValue({ config, client }); vi.spyOn(ctx, 'verify').mockResolvedValue();
  const prepare = async (amount: string) => preparePayment(ctx, { recipient, amount });
  return { ctx, client, state, prepare, receipts, transactions };
}
it('signs transferFrom directly to the token and enforces the cumulative remaining allowance', async () => {
  const { ctx, state, client, prepare } = await fixture();
  const first = await prepare('0.006'); expect((await pay(ctx, { paymentId: first.paymentId })).status).toBe('confirmed');
  expect(state.allowance).toBe(4000n);
  const over = await prepare('0.006'); await expect(pay(ctx, { paymentId: over.paymentId })).rejects.toMatchObject({ code: 'INSUFFICIENT_ALLOWANCE' });
  expect(state.received).toBe(6000n); expect(client.sendRawTransaction).toHaveBeenCalledTimes(1);
  const last = await prepare('0.004'); await pay(ctx, { paymentId: last.paymentId }); expect(state.allowance).toBe(0n); expect(state.received).toBe(10_000n);
});
it('simulates without signing, persisting a transaction, or broadcasting', async () => {
  const { ctx, client, prepare } = await fixture(); const p = await prepare('0.006');
  expect((await pay(ctx, { paymentId: p.paymentId, dryRun: true })).status).toBe('simulated');
  expect((await loadPayment(ctx, p.paymentId)).raw).toBeUndefined(); expect(client.sendRawTransaction).not.toHaveBeenCalled();
});
it('recovers a lost broadcast response using the exact saved signed transaction', async () => {
  const { ctx, client, state, prepare } = await fixture(); const p = await prepare('0.006'); state.offline = true;
  await expect(pay(ctx, { paymentId: p.paymentId })).rejects.toMatchObject({ code: 'PAYMENT_OUTCOME_UNKNOWN' });
  const saved = await loadPayment(ctx, p.paymentId); expect(saved.raw).toBeDefined(); expect(saved.nonce).toBe('0');
  state.offline = false; expect((await waitPayment(ctx, p.paymentId)).status).toBe('confirmed');
  expect((await pay(ctx, { paymentId: p.paymentId })).status).toBe('confirmed');
  expect(client.sendRawTransaction).toHaveBeenCalledTimes(1); expect(state.received).toBe(6000n);
});
it('rebroadcasts identical bytes if a signed transaction has not reached the network', async () => {
  const { ctx, client, prepare } = await fixture(); const p = await prepare('0.006');
  client.sendRawTransaction.mockRejectedValueOnce(new Error('not sent'));
  await expect(pay(ctx, { paymentId: p.paymentId })).rejects.toMatchObject({ code: 'PAYMENT_OUTCOME_UNKNOWN' });
  const saved = await loadPayment(ctx, p.paymentId); await pay(ctx, { paymentId: p.paymentId });
  expect(client.sendRawTransaction.mock.calls[1][0].serializedTransaction).toBe(saved.raw);
});
it('refuses changed payment terms and new submissions while a signed payment is unresolved', async () => {
  const { ctx, state, prepare } = await fixture(); const p = await prepare('0.006');
  await expect(pay(ctx, { paymentId: p.paymentId, amount: '0.004' })).rejects.toMatchObject({ code: 'PAYMENT_TERMS_MISMATCH' });
  state.hiddenReceipt = true; await pay(ctx, { paymentId: p.paymentId, noWait: true }); const next = await prepare('0.001');
  await expect(pay(ctx, { paymentId: next.paymentId })).rejects.toMatchObject({ code: 'UNRESOLVED_PAYMENT' });
});
it('blocks depleted allowance, insufficient funds, insufficient gas and false-return transfers before broadcast', async () => {
  const { ctx, client, state, prepare } = await fixture(); const p = await prepare('0.006');
  state.allowance = 0n; await expect(pay(ctx, { paymentId: p.paymentId })).rejects.toMatchObject({ code: 'INSUFFICIENT_ALLOWANCE' });
  state.allowance = 10_000n; state.aliceBalance = 0n; await expect(pay(ctx, { paymentId: p.paymentId })).rejects.toMatchObject({ code: 'INSUFFICIENT_PAYMENT_FUNDS' });
  state.aliceBalance = 100_000n; state.native = 0n; await expect(pay(ctx, { paymentId: p.paymentId })).rejects.toMatchObject({ code: 'INSUFFICIENT_GAS' });
  state.native = 10n ** 18n; state.falseReturn = true; await expect(pay(ctx, { paymentId: p.paymentId })).rejects.toMatchObject({ code: 'TOKEN_TRANSFER_REJECTED' });
  expect(client.sendRawTransaction).not.toHaveBeenCalled();
});
it('requires exact token Transfer evidence even when the receipt status is success', async () => {
  const { ctx, prepare, receipts } = await fixture(); const p = await prepare('0.006'); const sent = await pay(ctx, { paymentId: p.paymentId, noWait: true });
  receipts.get(sent.transactionHash!).logs = [];
  await expect(waitPayment(ctx, p.paymentId)).rejects.toMatchObject({ code: 'PAYMENT_UNVERIFIED' });
  expect((await loadPayment(ctx, p.paymentId)).status).toBe('submitted');
});

it('allows the agent to choose a different recipient for another payment', async () => {
  const {ctx, state, prepare} = await fixture(); state.allowance = 20_000n;
  const first = await prepare('0.006'); await pay(ctx, {paymentId: first.paymentId});
  const next = await preparePayment(ctx, {recipient: '0x4444444444444444444444444444444444444444', amount: '0.004'});
  expect((await pay(ctx, {paymentId: next.paymentId})).status).toBe('confirmed');
  expect(state.allowance).toBe(10_000n); expect(state.received).toBe(10_000n);
});
