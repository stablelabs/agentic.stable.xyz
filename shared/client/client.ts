import { createPublicClient, http, parseEventLogs, encodeFunctionData, type Address, type Hash, type TransactionReceipt, type PublicClient as ViemPublicClient, type HttpTransport } from 'viem';
import { tokenAbi } from './abi.js';
import { chain, CHAIN_ID, TOKEN, type WalletConfig } from './config.js';

export type PublicClient = ViemPublicClient<HttpTransport, typeof chain>;
export function publicClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain, transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }) });
}
export async function verifyNetwork(client: PublicClient) {
  if (await client.getChainId() !== CHAIN_ID) throw new Error('RPC is not Stable Testnet (2201).');
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'decimals' }),
    client.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'symbol' }),
  ]);
  if (decimals !== 6 || !['USDT0', 'USD₮0'].includes(symbol)) throw new Error('USDT0 metadata mismatch.');
}
export async function readAllowance(client: PublicClient, config: WalletConfig, agent: Address) {
  return client.readContract({ address: config.token, abi: tokenAbi, functionName: 'allowance', args: [config.alice, agent] });
}
export async function readBalances(client: PublicClient, config: WalletConfig, agent?: Address) {
  const [aliceToken, agentNative] = await Promise.all([
    client.readContract({ address: config.token, abi: tokenAbi, functionName: 'balanceOf', args: [config.alice] }),
    agent ? client.getBalance({ address: agent }) : undefined,
  ]);
  return { alice: config.alice, aliceToken, tokenDecimals: 6, agent, agentNative, nativeDecimals: 18 };
}
export async function prepareOwnerTransaction(client: PublicClient, config: WalletConfig, data: `0x${string}`) {
  const block = await client.getBlock();
  const fees = { type: 'eip1559' as const, maxFeePerGas: (block.baseFeePerGas ?? await client.getGasPrice()) * 2n, maxPriorityFeePerGas: 0n };
  const request = { account: config.alice, to: config.token, data, value: 0n, ...fees };
  // A successful EVM receipt alone does not imply a token returned true.
  const result = await client.call(request);
  if (result.data && result.data !== '0x' && BigInt(result.data) !== 1n) throw new Error('Token rejected the operation.');
  const gas = await client.estimateGas(request);
  return { to: config.token, data, value: 0n, gas: gas + gas / 5n, ...fees };
}
export type ReceiptCheck = (receipt: TransactionReceipt) => void;
export function approvalCheck(token: Address, alice: Address, agent: Address, amount: bigint): ReceiptCheck {
  return receipt => {
    const events = parseEventLogs({ abi: tokenAbi, eventName: 'Approval', logs: receipt.logs });
    if (!events.some(e => e.address.toLowerCase() === token.toLowerCase() && e.args.owner.toLowerCase() === alice.toLowerCase() && e.args.spender.toLowerCase() === agent.toLowerCase() && e.args.value === amount)) throw new Error('Receipt has no matching token Approval event. Approval is not verified.');
  };
}
export function paymentCheck(token: Address, alice: Address, recipient: Address, amount: bigint): ReceiptCheck {
  return receipt => {
    const events = parseEventLogs({ abi: tokenAbi, eventName: 'Transfer', logs: receipt.logs });
    if (!events.some(e => e.address.toLowerCase() === token.toLowerCase() && e.args.from.toLowerCase() === alice.toLowerCase() && e.args.to.toLowerCase() === recipient.toLowerCase() && e.args.value === amount)) throw new Error('Receipt has no matching token Transfer event. Payment is not verified.');
  };
}
export function transferData(alice: Address, recipient: Address, amount: bigint) {
  return encodeFunctionData({ abi: tokenAbi, functionName: 'transferFrom', args: [alice, recipient, amount] });
}
export type WaitOptions = { timeout?: number; confirmations?: number; pollingInterval?: number };
export async function trackTransaction(client: PublicClient, hash: Hash, check?: ReceiptCheck, options: WaitOptions = {}) {
  let changedAction = false;
  let repriced = false;
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: options.confirmations ?? 1, timeout: options.timeout ?? 120_000, pollingInterval: options.pollingInterval,
    onReplaced: replacement => { if (replacement.reason === 'repriced') repriced = true; else changedAction = true; },
  });
  if (changedAction || (receipt.transactionHash !== hash && !repriced)) throw new Error('Transaction was cancelled or replaced with a different action. Check the explorer and current onchain state.');
  if (receipt.status === 'success') check?.(receipt);
  return { hash: receipt.transactionHash, success: receipt.status === 'success', block: receipt.blockNumber.toString(), feeAtomic: (receipt.gasUsed * receipt.effectiveGasPrice).toString() };
}
