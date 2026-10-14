import { encodeFunctionData, type Address, type Hash } from 'viem';
import { walletAbi } from './abi';
import { type WalletConfig } from './config';
import { newGrantId } from './grant-input';
import { trackTransaction, type Grant, type PublicClient } from './client';

export const NATIVE_PER_TOKEN_UNIT = 10n ** 12n;
export const ceilTokenUnit = (value: bigint) => (value + NATIVE_PER_TOKEN_UNIT - 1n) / NATIVE_PER_TOKEN_UNIT * NATIVE_PER_TOKEN_UNIT;

export async function paymentGasReserve(client: PublicClient, config: WalletConfig, id: Hash, grant: Grant) {
  const block = await client.getBlock();
  if (grant.status !== 2 || grant.expiresAt <= block.timestamp || grant.spent >= grant.budget) throw new Error('Grant is no longer payable. Refresh its status.');
  // Estimate a new payment using the remaining budget. This never signs or submits it.
  const data = encodeFunctionData({ abi: walletAbi, functionName: 'pay', args: [id, newGrantId(), grant.recipient, grant.budget - grant.spent] });
  const gas = await client.estimateGas({ account: grant.agent, to: config.alice, data });
  const maxFeePerGas = (block.baseFeePerGas ?? await client.getGasPrice()) * 2n;
  if (maxFeePerGas <= 0n) throw new Error('Payment fee estimate is unavailable.');
  // Buffer changes in token storage costs and fees; quote a reserve, not a guarantee.
  return ceilTokenUnit((gas + (gas + 1n) / 2n) * maxFeePerGas);
}

export function fundingSuggestion(balance: bigint, reserve: bigint) {
  const target = reserve * 3n;
  return balance < target ? ceilTokenUnit(target - balance) : 0n;
}

export async function prepareGasFunding(client: PublicClient, alice: Address, agent: Address, amount: bigint) {
  if (alice.toLowerCase() === agent.toLowerCase() || amount <= 0n) throw new Error('Choose a separate agent and a positive funding amount.');
  const block = await client.getBlock();
  const fees = { type: 'eip1559' as const, maxFeePerGas: (block.baseFeePerGas ?? await client.getGasPrice()) * 2n, maxPriorityFeePerGas: 0n };
  const gas = await client.estimateGas({ account: alice, to: agent, value: amount, ...fees });
  const request = { to: agent, value: amount, gas: gas + gas / 5n, ...fees };
  if (await client.getBalance({ address: alice }) < amount + request.gas * request.maxFeePerGas) throw new Error('Alice needs enough native USDT0 for the funding amount and its transfer fee.');
  return request;
}

export async function trackGasFunding(client: PublicClient, hash: Hash, alice: Address, agent: Address, amount: bigint) {
  const result = await trackTransaction(client, hash);
  if (result.success) {
    const transaction = await client.getTransaction({ hash: result.hash });
    if (transaction.from.toLowerCase() !== alice.toLowerCase() || transaction.to?.toLowerCase() !== agent.toLowerCase() || transaction.value !== amount || transaction.input !== '0x') throw new Error('Confirmed transaction does not match the requested gas funding.');
  }
  return result;
}
