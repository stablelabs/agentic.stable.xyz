import { expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, type Hex } from 'viem';
import { createOwnerClient, parseAmount, validateConfig, type WalletConfig, type OwnerOperation } from '../shared/owner';
import { tokenAbi, approvalCheck, paymentCheck, trackTransaction, verifyNetwork } from '../shared/protocol';

const alice = '0x1111111111111111111111111111111111111111';
const agent = '0x2222222222222222222222222222222222222222';
const recipient = '0x3333333333333333333333333333333333333333';
const hash = keccak256('0x01');
const config: WalletConfig = { schemaVersion: 2, chainId: 2201, alice, token: '0x78Cf24370174180738C5B8E352B6D14c83a6c9A9', rpcUrl: 'https://rpc.testnet.stable.xyz', approvalUrl: 'https://agentic.stable.xyz' };
function approvalLog(amount: bigint, token = config.token) {
  return { address: token, topics: encodeEventTopics({ abi: tokenAbi, eventName: 'Approval', args: { owner: alice, spender: agent } }), data: encodeAbiParameters([{ type: 'uint256' }], [amount]) };
}
function fixture() {
  const state = { allowance: 0n, chain: 2201, symbol: 'USDT0', decimals: 6, logs: [approvalLog(10_000n)], status: 'success', from: alice, to: config.token, value: 0n, input: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [agent, 10_000n] }) };
  const client: any = {
    getChainId: vi.fn(async () => state.chain),
    readContract: vi.fn(async ({ functionName }: any) => ({ decimals: state.decimals, symbol: state.symbol, allowance: state.allowance, balanceOf: 1_000_000n })[functionName as 'decimals']),
    getBlock: vi.fn(async () => ({ baseFeePerGas: 10n })), call: vi.fn(async () => ({ data: `0x${'0'.repeat(63)}1` })), estimateGas: vi.fn(async () => 50_000n),
    getBalance: vi.fn(async () => 10n ** 18n),
    getTransaction: vi.fn(async () => ({ from: state.from, to: state.to, value: state.value, input: state.input })),
    waitForTransactionReceipt: vi.fn(async () => ({ status: state.status, transactionHash: hash, blockNumber: 10n, gasUsed: 50_000n, effectiveGasPrice: 10n, logs: state.logs })),
  };
  const wallet: any = { getAddresses: vi.fn(async () => [alice]), getChainId: vi.fn(async () => 2201), sendTransaction: vi.fn(async () => hash) };
  const operations: OwnerOperation[] = [];
  const owner = createOwnerClient({ config, publicClient: client, walletClient: wallet, onOperation: op => { operations.push(op); } });
  return { owner, client, wallet, state, operations };
}
it('prepares approval to the agent on the token, with no account activation', async () => {
  const { owner, client } = fixture(); const op = await owner.prepareApproval({ agent, amount: '0.01' });
  expect(op.intent).toEqual({ agent, amount: '10000' }); expect(op.request.to).toBe(config.token);
  expect(op.request.data).toBe(encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [agent, 10_000n] }));
  expect(client.readContract.mock.calls.every(([r]: any) => r.address === config.token)).toBe(true);
});
it('reconstructs calldata instead of trusting a supplied request and persists before signing', async () => {
  const { owner, wallet, operations } = fixture(); const op = await owner.prepareApproval({ agent, amount: '0.01' });
  const result = await owner.send({ ...op, request: { to: recipient } } as any);
  expect(wallet.sendTransaction.mock.calls[0][0].to).toBe(config.token);
  expect(operations.map(o => o.status)).toEqual(['prepared', 'submitted']); expect(result.hash).toBe(hash);
  await expect(owner.send(result)).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
  await expect(owner.send(op)).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
});
it('requires zero reset before replacing a positive allowance', async () => {
  const { owner, state, wallet } = fixture(); state.allowance = 4_000n;
  await expect(owner.approve({ agent, amount: '0.02' })).rejects.toMatchObject({ code: 'RESET_ALLOWANCE_REQUIRED' });
  expect(wallet.sendTransaction).not.toHaveBeenCalled();
  const op = await owner.revoke(agent); expect(op.intent.amount).toBe('0');
});
it('rechecks allowance before submission', async () => {
  const { owner, state, wallet } = fixture(); const op = await owner.prepareApproval({ agent, amount: '0.01' }); state.allowance = 1n;
  await expect(owner.send(op)).rejects.toMatchObject({ code: 'RESET_ALLOWANCE_REQUIRED' }); expect(wallet.sendTransaction).not.toHaveBeenCalled();
});
it('validates amount precision, agent address and separate signer', async () => {
  const { owner, wallet } = fixture();
  for (const params of [{ agent, amount: '0.0000001' }, { agent, amount: '-1' }, { agent: alice, amount: '1' }, { agent: '0x0', amount: '1' }]) await expect(owner.approve(params)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(wallet.sendTransaction).not.toHaveBeenCalled();
});
it('requires the correct owner and chain immediately before signing', async () => {
  const { owner, wallet } = fixture(); wallet.getAddresses.mockResolvedValue([agent]);
  await expect(owner.approve({ agent, amount: '0.01' })).rejects.toMatchObject({ code: 'OWNER_MISMATCH' }); expect(wallet.sendTransaction).not.toHaveBeenCalled();
});
it('records rejection separately from an unknown submission', async () => {
  const { owner, wallet, operations } = fixture(); wallet.sendTransaction.mockRejectedValue(Object.assign(new Error('Rejected'), { code: 4001 }));
  await expect(owner.approve({ agent, amount: '0.01' })).rejects.toMatchObject({ code: 'OWNER_REJECTED' }); expect(operations.at(-1)?.status).toBe('rejected');
  wallet.sendTransaction.mockRejectedValue(new Error('Transport lost'));
  await expect(owner.approve({ agent, amount: '0.01' })).rejects.toMatchObject({ code: 'SUBMISSION_OUTCOME_UNKNOWN' }); expect(operations.at(-1)?.status).toBe('unknown');
});
it('fails before signing if operation persistence fails', async () => {
  const { client, wallet } = fixture(); const owner = createOwnerClient({ config, publicClient: client, walletClient: wallet, onOperation: () => { throw new Error('disk full'); } });
  await expect(owner.approve({ agent, amount: '0.01' })).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' }); expect(wallet.sendTransaction).not.toHaveBeenCalled();
});
it('verifies exact token Approval event and transaction before reporting confirmation', async () => {
  const { owner, state } = fixture(); const op = await owner.approve({ agent, amount: '0.01' }); expect((await owner.wait(op)).success).toBe(true);
  state.logs = [approvalLog(9_000n)]; await expect(owner.wait(op)).rejects.toMatchObject({ code: 'OPERATION_UNVERIFIED' });
  state.logs = [approvalLog(10_000n)]; state.from = recipient; await expect(owner.wait(op)).rejects.toMatchObject({ code: 'OPERATION_UNVERIFIED' });
});
it('rejects matching events emitted by a different token', async () => {
  const { owner, state } = fixture(); const op = await owner.approve({ agent, amount: '0.01' }); state.logs = [approvalLog(10_000n, recipient)];
  await expect(owner.wait(op)).rejects.toThrow('matching token Approval');
});
it('observes a revert without claiming approval succeeded', async () => {
  const { owner, state } = fixture(); const op = await owner.approve({ agent, amount: '0.01' }); state.status = 'reverted'; state.logs = [];
  expect((await owner.wait(op)).operation.status).toBe('reverted');
});
it('does not broadcast when recovering a saved operation', async () => {
  const { owner, client } = fixture(); const op = await owner.approve({ agent, amount: '0.01' });
  const reader = createOwnerClient({ config, publicClient: client }); expect((await reader.wait(JSON.parse(JSON.stringify(op)))).success).toBe(true);
  await expect(reader.wait({ ...op, hash: undefined })).rejects.toMatchObject({ code: 'NOT_SUBMITTED' });
  await expect(reader.wait({ ...op, schemaVersion: 1 } as any)).rejects.toMatchObject({ code: 'OPERATION_MISMATCH' });
});
it('funds the agent using native value, outside token allowance', async () => {
  const { owner, wallet, state } = fixture(); const op = await owner.fundAgentGas({ agent, amount: '0.01' });
  const tx = wallet.sendTransaction.mock.calls[0][0]; expect(tx.to).toBe(agent); expect(tx.value).toBe(10n ** 16n); expect(tx.data).toBeUndefined();
  state.to = agent; state.value = 10n ** 16n; state.input = '0x'; expect((await owner.wait(op)).success).toBe(true);
  state.to = recipient; await expect(owner.wait(op)).rejects.toMatchObject({ code: 'OPERATION_UNVERIFIED' });
});
it('keeps gas estimates unavailable on RPC failure and estimates transferFrom to the token', async () => {
  const { owner, client } = fixture(); expect((await owner.estimateAgentGas({ agent, recipient, amount: '0.006' })).reserve).toBeGreaterThan(0n);
  expect(client.estimateGas.mock.calls.at(-1)[0].to).toBe(config.token);
  client.estimateGas.mockRejectedValue(new Error('RPC down')); await expect(owner.estimateAgentGas({ agent, recipient, amount: '0.006' })).rejects.toThrow();
});
it('rejects unsupported networks and token metadata', async () => {
  const { client, state } = fixture(); state.chain = 1; await expect(verifyNetwork(client)).rejects.toThrow('2201');
  state.chain = 2201; state.decimals = 18; await expect(verifyNetwork(client)).rejects.toThrow('metadata');
});
it('validates public schema 2 and strips unknown fields', () => {
  expect(validateConfig({ ...config, privateKey: 'secret' })).toEqual(config);
  expect(() => validateConfig({ ...config, schemaVersion: 1 })).toThrow();
  expect(() => validateConfig({ ...config, approvalUrl: 'javascript:alert(1)' })).toThrow();
  expect(() => validateConfig({ ...config, token: recipient })).toThrow();
  expect(parseAmount('0.006')).toBe(6000n); expect(() => parseAmount('0.0000001')).toThrow();
});
it('requires a matching Transfer event for payment confirmation', () => {
  const logs = [{ address: config.token, topics: encodeEventTopics({ abi: tokenAbi, eventName: 'Transfer', args: { from: alice, to: recipient } }), data: encodeAbiParameters([{ type: 'uint256' }], [6000n]) }];
  expect(() => paymentCheck(config.token, alice, recipient, 6000n)({ logs } as any)).not.toThrow();
  expect(() => paymentCheck(config.token, alice, recipient, 4000n)({ logs } as any)).toThrow();
  expect(() => approvalCheck(config.token, alice, agent, 6000n)({ logs } as any)).toThrow();
});
it('rejects action-changing replacements but accepts a repriced identical transaction', async () => {
  const { client } = fixture(); client.waitForTransactionReceipt.mockImplementation(async ({ onReplaced }: any) => { onReplaced({ reason: 'cancelled' }); return { transactionHash: hash, status: 'success' }; });
  await expect(trackTransaction(client, hash)).rejects.toThrow('cancelled');
  client.waitForTransactionReceipt.mockImplementation(async ({ onReplaced }: any) => { onReplaced({ reason: 'repriced' }); return { transactionHash: keccak256('0x02'), status: 'success', blockNumber: 1n, gasUsed: 1n, effectiveGasPrice: 1n }; });
  expect((await trackTransaction(client, hash)).success).toBe(true);
});
it('rejects a token returning false before requesting an approval transaction', async () => {
  const { owner, client, wallet } = fixture(); client.call.mockResolvedValue({ data: `0x${'0'.repeat(64)}` as Hex });
  await expect(owner.approve({ agent, amount: '0.01' })).rejects.toThrow('Token rejected'); expect(wallet.sendTransaction).not.toHaveBeenCalled();
});
