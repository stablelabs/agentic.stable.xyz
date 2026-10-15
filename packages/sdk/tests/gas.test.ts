import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import { walletAbi } from '../src/client/abi';
import { type Grant, type PublicClient } from '../src/client/client';
import { TOKEN, type WalletConfig } from '../src/client/config';
import { ceilTokenUnit, fundingSuggestion, NATIVE_PER_TOKEN_UNIT, paymentGasReserve, prepareGasFunding, trackGasFunding } from '../src/client/gas';

const alice = '0x1111111111111111111111111111111111111111';
const agent = '0x2222222222222222222222222222222222222222';
const recipient = '0x3333333333333333333333333333333333333333';
const id = `0x${'aa'.repeat(32)}` as const;
const config: WalletConfig = { alice, chainId: 2201, token: TOKEN, implementation: recipient, implementationCodeHash: id, rpcUrl: 'http://127.0.0.1:18545', approvalUrl: 'http://127.0.0.1:5174' };
const grant: Grant = { agent, recipient, budget: 10000n, spent: 6000n, expiresAt: 2000n, status: 2 };
const receipt = { transactionHash: id, status: 'success', blockNumber: 1n, gasUsed: 21000n, effectiveGasPrice: 1n };

describe('agent gas funding', () => {
  it('rounds native gas costs upward to exact six-decimal transfer amounts', () => {
    expect(ceilTokenUnit(0n)).toBe(0n);
    expect(ceilTokenUnit(1n)).toBe(NATIVE_PER_TOKEN_UNIT);
    expect(ceilTokenUnit(NATIVE_PER_TOKEN_UNIT)).toBe(NATIVE_PER_TOKEN_UNIT);
    expect(ceilTokenUnit(NATIVE_PER_TOKEN_UNIT + 1n)).toBe(2n * NATIVE_PER_TOKEN_UNIT);
    expect(fundingSuggestion(0n, 100n * NATIVE_PER_TOKEN_UNIT)).toBe(300n * NATIVE_PER_TOKEN_UNIT);
    expect(fundingSuggestion(299n * NATIVE_PER_TOKEN_UNIT + 1n, 100n * NATIVE_PER_TOKEN_UNIT)).toBe(NATIVE_PER_TOKEN_UNIT);
    expect(fundingSuggestion(301n, 100n)).toBe(0n);
  });
  it('estimates remaining-budget payment calldata from the agent without signing, with buffered fees', async () => {
    const client = {
      getBlock: async () => ({ timestamp: 1000n, baseFeePerGas: 10n ** 10n }),
      estimateGas: async (request: any) => {
        expect(request.account).toBe(agent); expect(request.to).toBe(alice);
        const decoded = decodeFunctionData({ abi: walletAbi, data: request.data });
        expect(decoded.functionName).toBe('pay');
        expect(decoded.args![0]).toBe(id); expect(decoded.args![2]).toBe(recipient); expect(decoded.args![3]).toBe(4000n);
        return 127533n;
      },
    } as unknown as PublicClient;
    expect(await paymentGasReserve(client, config, id, grant)).toBe(3826n * NATIVE_PER_TOKEN_UNIT);
  });
  it.each([{ status: 1 }, { status: 3 }, { status: 4 }, { expiresAt: 1000n }, { spent: 10000n }])('does not promise gas readiness for an unpayable grant, case %#', async override => {
    const client = { getBlock: async () => ({ timestamp: 1000n }) } as unknown as PublicClient;
    await expect(paymentGasReserve(client, config, id, { ...grant, ...override })).rejects.toThrow('no longer payable');
  });
  it('requires Alice to cover both the exact native transfer and its buffered gas', async () => {
    const amount = 10n ** 16n;
    let balance = amount;
    const client = {
      getBlock: async () => ({ baseFeePerGas: 10n ** 10n }),
      estimateGas: async (request: any) => { expect(request.to).toBe(agent); expect(request.value).toBe(amount); expect(request).not.toHaveProperty('data'); return 21000n; },
      getBalance: async () => balance,
    } as unknown as PublicClient;
    await expect(prepareGasFunding(client, alice, agent, amount)).rejects.toThrow('transfer fee');
    balance = amount + 25200n * 2n * 10n ** 10n;
    expect(await prepareGasFunding(client, alice, agent, amount)).toMatchObject({ to: agent, value: amount, gas: 25200n, maxFeePerGas: 2n * 10n ** 10n, maxPriorityFeePerGas: 0n });
    await expect(prepareGasFunding(client, alice, alice, amount)).rejects.toThrow('separate agent');
  });
  it.each([{ from: agent }, { to: recipient }, { value: 10001n }, { input: '0x1234' }])('rejects a receipt with mismatched funding transaction, case %#', async override => {
    const client = { waitForTransactionReceipt: async () => receipt, getTransaction: async () => ({ from: alice, to: agent, value: 10000n, input: '0x', ...override }) } as unknown as PublicClient;
    await expect(trackGasFunding(client, id, alice, agent, 10000n)).rejects.toThrow('does not match');
  });
  it('confirms exact funding and reports an included revert separately', async () => {
    const client = { waitForTransactionReceipt: async () => receipt, getTransaction: async () => ({ from: alice, to: agent, value: 10000n, input: '0x' }) } as unknown as PublicClient;
    expect((await trackGasFunding(client, id, alice, agent, 10000n)).success).toBe(true);
    const reverted = { waitForTransactionReceipt: async () => ({ ...receipt, status: 'reverted' }) } as unknown as PublicClient;
    expect((await trackGasFunding(reverted, id, alice, agent, 10000n)).success).toBe(false);
  });
});
