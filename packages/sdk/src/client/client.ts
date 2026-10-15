import { createPublicClient, http, keccak256, parseEventLogs, type Address, type Hash, type Hex, type TransactionReceipt, type PublicClient as ViemPublicClient, type HttpTransport } from 'viem';
import { walletAbi, tokenAbi } from './abi.js';
import { chain, CHAIN_ID, TOKEN, type WalletConfig } from './config.js';

export type PublicClient = ViemPublicClient<HttpTransport, typeof chain>;
export function publicClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain, transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }) });
}
export type Grant = { agent: Address; recipient: Address; budget: bigint; spent: bigint; expiresAt: bigint; status: number };
export const grant = (client: PublicClient, alice: Address, id: Hex) =>
  client.readContract({ address: alice, abi: walletAbi, functionName: 'getGrant', args: [id] }) as Promise<Grant>;
export async function verifyNetwork(client: PublicClient) {
  if (await client.getChainId() !== CHAIN_ID) throw new Error('RPC is not Stable Testnet (2201).');
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'decimals' }),
    client.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'symbol' }),
  ]);
  if (decimals !== 6 || !['USDT0', 'USD₮0'].includes(symbol)) throw new Error('USDT0 metadata mismatch.');
}
export async function verifyImplementation(client: PublicClient, c: WalletConfig) {
  const code = await client.getCode({ address: c.implementation });
  if (!code || code === '0x' || keccak256(code) !== c.implementationCodeHash) throw new Error('Implementation bytecode differs from the saved deployment.');
  const token = await client.readContract({ address: c.implementation, abi: walletAbi, functionName: 'TOKEN' });
  if (token.toLowerCase() !== TOKEN.toLowerCase()) throw new Error('Implementation token mismatch.');
}
export async function verifyAccount(client: PublicClient, c: WalletConfig) {
  await verifyNetwork(client);
  await verifyImplementation(client, c);
  const code = await client.getCode({ address: c.alice });
  if (code?.toLowerCase() !== `0xef0100${c.implementation.slice(2)}`.toLowerCase()) throw new Error('Alice’s address is not enabled for this implementation. Run wallet:enable locally.');
  const implementation = await client.readContract({ address: c.alice, abi: walletAbi, functionName: 'IMPLEMENTATION' });
  if (implementation.toLowerCase() !== c.implementation.toLowerCase()) throw new Error('Delegated account verification failed.');
  try {
    if (await client.readContract({ address: c.alice, abi: walletAbi, functionName: 'VERSION' }) !== 3n) throw new Error('wrong version');
  } catch { throw new Error('Alice’s account uses the previous grant flow. Run npm run wallet:enable -- --upgrade for MetaMask-compatible grant creation.'); }
}
export async function prepareOwnerTransaction(client: PublicClient, c: WalletConfig, data: Hex) {
  const block = await client.getBlock();
  const maxFeePerGas = (block.baseFeePerGas ?? await client.getGasPrice()) * 2n;
  const fees = { type: 'eip1559' as const, maxFeePerGas, maxPriorityFeePerGas: 0n };
  const gas = await client.estimateGas({ account: c.alice, to: c.implementation, data, value: 0n, ...fees });
  return { to: c.implementation, data, value: 0n, gas: gas + gas / 5n, ...fees };
}
export type ReceiptCheck = (receipt: TransactionReceipt) => void;
export function paymentCheck(alice: Address, grantId: Hex, paymentId: Hex, recipient: Address, amount: bigint): ReceiptCheck {
  return receipt => {
    const events = parseEventLogs({ abi: walletAbi, eventName: 'Payment', logs: receipt.logs });
    if (!events.some(e => e.address.toLowerCase() === alice.toLowerCase() && e.args.paymentId === paymentId && e.args.grantId === grantId && e.args.recipient.toLowerCase() === recipient.toLowerCase() && e.args.amount === amount)) throw new Error('Receipt has no matching Payment event. Payment is not verified.');
  };
}
export function creationCheck(alice: Address, id: Hex, agent: Address, recipient: Address, budget: bigint, expiresAt: bigint): ReceiptCheck {
  return receipt => {
    const events = parseEventLogs({ abi: walletAbi, eventName: 'GrantCreated', logs: receipt.logs });
    if (!events.some(e => e.address.toLowerCase() === alice.toLowerCase() && e.args.grantId === id && e.args.agent.toLowerCase() === agent.toLowerCase() && e.args.recipient.toLowerCase() === recipient.toLowerCase() && e.args.budget === budget && e.args.expiresAt === expiresAt)) throw new Error('Receipt has no matching GrantCreated event. Grant creation is not verified.');
  };
}
export function statusCheck(alice: Address, id: Hex, status: number): ReceiptCheck {
  return receipt => {
    const events = parseEventLogs({ abi: walletAbi, eventName: 'GrantStatusChanged', logs: receipt.logs });
    if (!events.some(e => e.address.toLowerCase() === alice.toLowerCase() && e.args.grantId === id && e.args.status === status)) throw new Error('Receipt has no matching grant status event. Action is not verified.');
  };
}
export type WaitOptions = { timeout?: number; confirmations?: number; pollingInterval?: number };
export async function trackTransaction(client: PublicClient, hash: Hash, check?: ReceiptCheck, options: WaitOptions = {}) {
  let changedAction = false;
  let repriced = false;
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: options.confirmations ?? 1, timeout: options.timeout ?? 120_000, pollingInterval: options.pollingInterval,
    onReplaced: replacement => {
      if (replacement.reason === 'repriced') repriced = true;
      else changedAction = true;
    },
  });
  if (changedAction || (receipt.transactionHash !== hash && !repriced)) throw new Error('Transaction was cancelled or replaced with a different action. Check the explorer and current onchain state.');
  if (receipt.status === 'success') check?.(receipt);
  return { hash: receipt.transactionHash, success: receipt.status === 'success', block: receipt.blockNumber.toString(), feeAtomic: (receipt.gasUsed * receipt.effectiveGasPrice).toString() };
}
export function grantStatus(g: Grant, now: bigint): string {
  if (g.status === 0) return 'Unknown';
  if (g.status === 3) return 'Rejected';
  if (g.status === 4) return 'Revoked';
  if (now >= g.expiresAt) return 'Expired';
  if (g.status === 2 && g.spent >= g.budget) return 'Exhausted';
  return g.status === 1 ? 'Pending' : 'Active';
}
