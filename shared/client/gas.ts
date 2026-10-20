import { type Address, type Hash } from 'viem';
import { transferData, trackTransaction, type PublicClient, type WaitOptions } from './client.js';
import { type WalletConfig } from './config.js';

export const NATIVE_PER_TOKEN_UNIT = 10n ** 12n;
export const ceilTokenUnit = (value: bigint) => (value + NATIVE_PER_TOKEN_UNIT - 1n) / NATIVE_PER_TOKEN_UNIT * NATIVE_PER_TOKEN_UNIT;
export async function paymentGasReserve(client: PublicClient, config: WalletConfig, agent: Address, recipient: Address, amount: bigint) {
  const block = await client.getBlock();
  const gas = await client.estimateGas({ account: agent, to: config.token, data: transferData(config.alice, recipient, amount) });
  const maxFeePerGas = (block.baseFeePerGas ?? await client.getGasPrice()) * 2n;
  if (maxFeePerGas <= 0n) throw new Error('Payment fee estimate is unavailable.');
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
  if (await client.getBalance({ address: alice }) < amount + request.gas * request.maxFeePerGas) throw new Error('The wallet owner needs enough native USDT0 for the funding amount and its transfer fee.');
  return request;
}
export async function trackGasFunding(client: PublicClient, hash: Hash, alice: Address, agent: Address, amount: bigint, options: WaitOptions = {}) {
  const result = await trackTransaction(client, hash, undefined, options);
  if (result.success) {
    const transaction = await client.getTransaction({ hash: result.hash });
    if (transaction.from.toLowerCase() !== alice.toLowerCase() || transaction.to?.toLowerCase() !== agent.toLowerCase() || transaction.value !== amount || transaction.input !== '0x') throw new Error('Confirmed transaction does not match the requested gas funding.');
  }
  return result;
}
