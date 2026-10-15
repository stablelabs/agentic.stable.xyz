import { describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, keccak256, type WalletClient } from 'viem';
import { createOwnerClient, type OwnerOperation } from '../src/index.js';
import { walletAbi } from '../src/client/abi';
import { CHAIN_ID, TOKEN, type WalletConfig } from '../src/client/config';
import type { PublicClient } from '../src/client/client';

const alice = '0x1111111111111111111111111111111111111111';
const agent = '0x2222222222222222222222222222222222222222';
const recipient = '0x3333333333333333333333333333333333333333';
const implementation = '0x4444444444444444444444444444444444444444';
const code = '0x60006000';
const id = keccak256('0x01'), hash = keccak256('0x02');
const config: WalletConfig = { chainId: CHAIN_ID, token: TOKEN, alice, implementation, implementationCodeHash: keccak256(code), rpcUrl: 'http://localhost:18545', approvalUrl: 'http://localhost:5174', defaultAgent: agent };
function fixture(onOperation?: (op: OwnerOperation) => void | Promise<void>) {
  const sendTransaction = vi.fn(async (_request: unknown) => hash);
  const wallet = { getAddresses: vi.fn(async () => [alice]), getChainId: vi.fn(async () => CHAIN_ID), sendTransaction };
  const rpc = {
    getChainId: async () => CHAIN_ID,
    getCode: async ({ address }: { address: string }) => address === alice ? `0xef0100${implementation.slice(2)}` : code,
    getBlock: async () => ({ number: 100n, timestamp: 1000n, baseFeePerGas: 10n }),
    getBalance: async () => 10n ** 18n,
    estimateGas: async () => 100_000n,
    readContract: async ({ functionName }: { functionName: string }) => ({ decimals: 6, symbol: 'USDT0', TOKEN, IMPLEMENTATION: implementation, VERSION: 3n,
      getGrant: { agent, recipient, budget: 10000n, spent: 0n, expiresAt: 2000n, status: 2 },
    })[functionName as 'decimals'],
    waitForTransactionReceipt: vi.fn(async () => ({ transactionHash: hash, status: 'success', blockNumber: 100n, gasUsed: 100n, effectiveGasPrice: 1n, logs: [] })),
  };
  const sdk = createOwnerClient({ config, publicClient: rpc as unknown as PublicClient, walletClient: wallet as unknown as WalletClient, onOperation });
  return { sdk, wallet, rpc };
}

describe('owner SDK submission boundary', () => {
  it('prepares forwarded owner operations without a wallet or signature', async () => {
    const { rpc, wallet } = fixture();
    const sdk = createOwnerClient({ config, publicClient: rpc as unknown as PublicClient });
    const operation = await sdk.prepareRevokeGrant(id);
    expect(operation.request.to).toBe(implementation);
    expect(decodeFunctionData({ abi: walletAbi, data: operation.request.data }).functionName).toBe('revokeGrantFor');
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
    await expect(sdk.send(operation)).rejects.toMatchObject({ code: 'OWNER_WALLET_REQUIRED' });
  });
  it.each(['account', 'chain'])('rechecks the current wallet %s before submission', async changed => {
    const { sdk, wallet } = fixture();
    const op = await sdk.prepareRevokeGrant(id);
    if (changed === 'account') wallet.getAddresses.mockResolvedValue([agent]);
    else wallet.getChainId.mockResolvedValue(988);
    await expect(sdk.send(op)).rejects.toMatchObject({ code: 'OWNER_MISMATCH' });
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });
  it('reconstructs allowed calldata instead of accepting a caller-controlled request', async () => {
    const { sdk, wallet } = fixture();
    const op = await sdk.prepareRevokeGrant(id);
    op.request.to = recipient;
    await sdk.send(op);
    expect(wallet.sendTransaction.mock.calls[0][0]).toMatchObject({ to: implementation });
  });
  it('does not submit if persisting intent fails', async () => {
    const { sdk, wallet } = fixture(async () => { throw new Error('Storage unavailable'); });
    await expect(sdk.revokeGrant(id)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED', operation: { status: 'prepared' } });
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });
  it('retains the returned hash if persisting a submitted operation fails', async () => {
    const { sdk, wallet } = fixture(async op => { if (op.hash) throw new Error('Storage unavailable'); });
    await expect(sdk.revokeGrant(id)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED', operation: { status: 'submitted', hash } });
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it('persists an ambiguous no-hash outcome and refuses automatic resubmission', async () => {
    const operations: OwnerOperation[] = [];
    const { sdk, wallet } = fixture(op => { operations.push(op); });
    wallet.sendTransaction.mockRejectedValue(new Error('Connection lost'));
    await expect(sdk.revokeGrant(id)).rejects.toMatchObject({ code: 'SUBMISSION_OUTCOME_UNKNOWN', operation: { status: 'unknown' } });
    expect(operations.map(op => op.status)).toEqual(['prepared', 'unknown']);
    await expect(sdk.send(operations[1])).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
    await expect(sdk.wait(operations[1])).rejects.toMatchObject({ code: 'NOT_SUBMITTED' });
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it('distinguishes owner rejection from ambiguous submission', async () => {
    const { sdk, wallet } = fixture();
    wallet.sendTransaction.mockRejectedValue(Object.assign(new Error('Rejected'), { code: 4001 }));
    await expect(sdk.revokeGrant(id)).rejects.toMatchObject({ code: 'OWNER_REJECTED', operation: { status: 'rejected' } });
  });
  it('rejects a concurrent wallet submission in the same instance', async () => {
    const { sdk, wallet } = fixture();
    let release!: (value: typeof hash) => void;
    wallet.sendTransaction.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const first = sdk.revokeGrant(id);
    await vi.waitFor(() => expect(wallet.sendTransaction).toHaveBeenCalledTimes(1));
    await expect(sdk.revokeGrant(id)).rejects.toMatchObject({ code: 'OWNER_BUSY' });
    release(hash); await first;
  });
  it('does not accept a successful receipt without its exact action event', async () => {
    const { sdk } = fixture();
    const operation = await sdk.revokeGrant(id);
    await expect(sdk.wait(operation)).rejects.toMatchObject({ code: 'OPERATION_UNVERIFIED' });
  });
  it('uses native units for funding and rejects excess decimal precision', async () => {
    const { sdk, wallet } = fixture();
    const op = await sdk.prepareFundAgentGas({ grantId: id, amount: '0.001' });
    expect(op.request).toMatchObject({ to: agent, value: 10n ** 15n });
    await expect(sdk.fundAgentGas({ grantId: id, amount: '0.0000001' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });
  it('refuses reuse of the original prepared funding object after a submission', async () => {
    const { sdk, wallet } = fixture();
    const prepared = await sdk.prepareFundAgentGas({ grantId: id, amount: '0.001' });
    const submitted = await sdk.send(prepared);
    expect(submitted.operationId).toBe(prepared.operationId);
    prepared.operationId = `0x${prepared.operationId!.slice(2).toUpperCase()}`;
    await expect(sdk.send(prepared)).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it('clears a persisted funding intent when the final owner check prevents submission', async () => {
    const operations: OwnerOperation[] = [];
    const { sdk, wallet } = fixture(op => { operations.push(op); });
    wallet.getAddresses.mockResolvedValueOnce([alice]).mockResolvedValueOnce([agent]);
    await expect(sdk.fundAgentGas({ grantId: id, amount: '0.001' })).rejects.toMatchObject({ code: 'OWNER_MISMATCH' });
    expect(operations.map(op => op.status)).toEqual(['prepared', 'rejected']);
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });
});
