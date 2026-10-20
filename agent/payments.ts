import { BaseError, ContractFunctionRevertedError, createWalletClient, encodeFunctionData, formatUnits, http, keccak256, parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from 'viem';
import { tokenAbi, address, chain, CHAIN_ID, identifier, TOKEN, type WalletConfig, formatAmount, parseAmount, paymentCheck, trackTransaction, verifyNetwork, type PublicClient, type WaitOptions, input, WalletError } from '../shared/protocol.js';
import { newId } from './state.js';
import type { AgentContext } from './context.js';

export type PaymentJournal = {
  schemaVersion: 2; kind: 'payment'; id: Hex; intent: Record<string, string>;
  context: { chainId: 2201; token: string };
  raw?: Hex; hash?: Hex; confirmedHash?: Hex; nonce?: string;
  status: 'created' | 'signed' | 'submitted' | 'confirmed' | 'reverted' | 'rejected';
  block?: string; feeAtomic?: string;
};
export type PaymentInput = { paymentId?: string; recipient?: string; amount?: string };
export const paymentFilename = (id: string) => `payment-${input(() => identifier(id))}.json`;
const paymentData = (j: PaymentJournal) => encodeFunctionData({ abi: tokenAbi, functionName: 'transferFrom', args: [address(j.intent.alice), address(j.intent.recipient), BigInt(j.intent.amount)] });
const check = (j: PaymentJournal) => paymentCheck(TOKEN, address(j.intent.alice), address(j.intent.recipient), BigInt(j.intent.amount));
export function paymentView(j: PaymentJournal) {
  return { paymentId: j.id, intent: j.intent, amount: formatAmount(BigInt(j.intent.amount)), amountAtomic: j.intent.amount, tokenDecimals: 6, status: j.status, transactionHash: j.confirmedHash ?? j.hash, nonce: j.nonce, block: j.block, feeAtomic: j.feeAtomic, nativeDecimals: 18, explorer: j.hash ? `${chain.blockExplorers.default.url}/tx/${j.confirmedHash ?? j.hash}` : undefined };
}
export async function loadPayment(ctx: AgentContext, id: string): Promise<PaymentJournal> {
  const filename = paymentFilename(id);
  if (!await ctx.state.has(filename)) throw new WalletError('PAYMENT_NOT_FOUND', 'No saved payment with this ID. Retain existing journals for recovery.');
  const j = await ctx.state.read<PaymentJournal>(filename);
  if (j.schemaVersion !== 2) throw new WalletError('LEGACY_PAYMENT_JOURNAL', 'This journal uses the retired payment flow. Recover it with the matching old CLI in its original directory; do not replay it as a new token payment.');
  try {
    if (!j.context || j.context.chainId !== CHAIN_ID || j.context.token.toLowerCase() !== TOKEN.toLowerCase()) throw new Error();
    if (j.kind !== 'payment' || j.id !== identifier(id) || j.schemaVersion !== 2 || !['created', 'signed', 'submitted', 'confirmed', 'reverted', 'rejected'].includes(j.status)) throw new Error();
    address(j.intent.alice); address(j.intent.agent); address(j.intent.recipient);
    if (!/^\d+$/.test(j.intent.amount) || BigInt(j.intent.amount) <= 0n || BigInt(j.intent.amount) >= 2n ** 256n) throw new Error();
    if (j.confirmedHash) identifier(j.confirmedHash);
    if (j.raw) {
      const tx = parseTransaction(j.raw);
      if (keccak256(j.raw) !== j.hash || tx.chainId !== CHAIN_ID || tx.to?.toLowerCase() !== TOKEN.toLowerCase() || tx.data !== paymentData(j) || (tx.value ?? 0n) !== 0n || (await recoverTransactionAddress({ serializedTransaction: j.raw as TransactionSerialized })).toLowerCase() !== j.intent.agent.toLowerCase()) throw new Error();
      if (j.nonce !== undefined && j.nonce !== String(tx.nonce)) throw new Error();
      j.nonce = String(tx.nonce);
    } else if (j.hash || j.confirmedHash || ['signed', 'submitted', 'confirmed', 'reverted'].includes(j.status)) throw new Error();
  } catch { throw new WalletError('INVALID_PAYMENT_JOURNAL', 'Payment journal or signed transaction differs from its saved intent. Retain it for inspection.'); }
  return j;
}

async function intent(ctx: AgentContext, options: PaymentInput, persist: boolean) {
  const config = await ctx.config(), agent = await ctx.identity();
  const id = input(() => identifier(options.paymentId || newId()));
  const old = await ctx.state.has(paymentFilename(id)) ? await loadPayment(ctx, id) : undefined;
  const recipient = options.recipient ? input(() => address(options.recipient!)) : old?.intent.recipient;
  const amount = options.amount ? String(input(() => parseAmount(options.amount!))) : old?.intent.amount;
  if (!recipient || !amount) throw new WalletError('INVALID_INPUT', 'An unsaved payment requires --recipient and --amount.', 2);
  const normalized = { alice: config.alice, agent, recipient, amount };
  if (old && (Object.entries(normalized).some(([key, value]) => old.intent[key] !== value) || old.context && (old.context.chainId !== CHAIN_ID || old.context.token !== TOKEN))) throw new WalletError('PAYMENT_TERMS_MISMATCH', 'Payment ID is already bound to different terms or account configuration.', 2);
  const j: PaymentJournal = old ?? { schemaVersion: 2, kind: 'payment', id, intent: normalized, context: { chainId: CHAIN_ID, token: TOKEN }, status: 'created' };
  if (!old && persist) await ctx.state.write(paymentFilename(id), j);
  return { journal: j, config };
}
export async function preparePayment(ctx: AgentContext, options: PaymentInput) {
  return ctx.state.lock(async () => paymentView((await intent(ctx, options, true)).journal));
}

async function preflight(ctx: AgentContext, client: PublicClient, config: WalletConfig, j: PaymentJournal) {
  await ctx.verify(client, config);
  const agent = address(j.intent.agent), recipient = address(j.intent.recipient), amount = BigInt(j.intent.amount);
  const [tokenBalance, nativeBalance, allowance] = await Promise.all([
    client.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'balanceOf', args: [config.alice] }),
    client.getBalance({ address: agent }),
    client.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'allowance', args: [config.alice, agent] }),
  ]);
  if (tokenBalance < amount) throw new WalletError('INSUFFICIENT_PAYMENT_FUNDS', 'The wallet owner has insufficient USDT0 for this payment.', 4, paymentView(j));
  if (allowance < amount) throw new WalletError('INSUFFICIENT_ALLOWANCE', 'The wallet owner must approve this agent for at least the payment amount.', 4, paymentView(j));
  try {
    const simulation = await client.simulateContract({ account: agent, address: TOKEN, abi: tokenAbi, functionName: 'transferFrom', args: [config.alice, recipient, amount] });
    if (simulation.result === false) throw new WalletError('TOKEN_TRANSFER_REJECTED', 'Token returned false; no payment was submitted.', 4, paymentView(j));
  } catch (error) {
    const revert = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : undefined;
    if (revert instanceof ContractFunctionRevertedError) throw new WalletError(revert.data?.errorName ?? 'PAYMENT_REJECTED', 'Token rejected the payment before submission.', 4, paymentView(j));
    throw error;
  }
  const block = await client.getBlock();
  const gasEstimate = await client.estimateGas({ account: agent, to: TOKEN, data: paymentData(j) });
  const gas = gasEstimate + gasEstimate / 5n;
  const maxFeePerGas = (block.baseFeePerGas ?? await client.getGasPrice()) * 2n;
  if (nativeBalance < gas * maxFeePerGas) throw new WalletError('INSUFFICIENT_GAS', `Gas payer ${agent} has ${formatUnits(nativeBalance, 18)} native USDT0. Fund this signer separately, then retry the same saved ID.`, 4, paymentView(j));
  return { to: TOKEN, data: paymentData(j), gas, maxFeePerGas, maxPriorityFeePerGas: 0n, block: block.number };
}

async function observe(ctx: AgentContext, client: PublicClient, j: PaymentJournal, options: WaitOptions = {}, locked = true) {
  try {
    const result = await trackTransaction(client, j.confirmedHash ?? j.hash!, check(j), options);
    if (result.success) {
      const tx = await client.getTransaction({ hash: result.hash });
      if (tx.from.toLowerCase() !== j.intent.agent.toLowerCase() || tx.to?.toLowerCase() !== TOKEN.toLowerCase() || tx.input !== paymentData(j) || tx.value !== 0n) throw new WalletError('PAYMENT_OUTCOME_UNKNOWN', 'Receipt transaction differs from the saved payment.', 6, paymentView(j));
    }
    j.confirmedHash = result.hash; j.status = result.success ? 'confirmed' : 'reverted'; j.block = result.block; j.feeAtomic = result.feeAtomic;
    if (locked) await ctx.state.write(paymentFilename(j.id), j);
    else await ctx.state.lock(async () => {
      const current = await loadPayment(ctx, j.id);
      if (current.raw !== j.raw) throw new WalletError('INVALID_PAYMENT_JOURNAL', 'Signed payment changed during observation.');
      await ctx.state.write(paymentFilename(j.id), j);
    });
    if (!result.success) throw new WalletError('PAYMENT_REVERTED', 'Transaction reverted onchain. No payment was committed; network fees may apply.', 7, paymentView(j));
    return { ...paymentView(j), success: true };
  } catch (error) {
    if (error instanceof WalletError) throw error;
    if (error instanceof Error && error.constructor === Error) throw new WalletError('PAYMENT_UNVERIFIED', error.message, 7, paymentView(j));
    throw new WalletError('PAYMENT_OUTCOME_UNKNOWN', 'Payment confirmation is unknown. Check or resume the same saved ID.', 6, { ...paymentView(j), status: 'unknown' });
  }
}
async function hasReceipt(client: PublicClient, j: PaymentJournal) {
  try { return await client.getTransactionReceipt({ hash: j.confirmedHash ?? j.hash! }); }
  catch (error) { if ((error as Error).name === 'TransactionReceiptNotFoundError') return undefined; throw error; }
}
export async function waitPayment(ctx: AgentContext, id: string, options: WaitOptions = {}) {
  // Do not hold a mutation lock while polling. Only commit the verified observation.
  const j = await loadPayment(ctx, id);
  if (!j.raw) return { ...paymentView(j), status: 'not_submitted' };
  const { client } = await ctx.public();
  try {
    await verifyNetwork(client);
    return await observe(ctx, client, j, options, false);
  } catch (error) {
    if (error instanceof WalletError) throw error;
    throw new WalletError('PAYMENT_OUTCOME_UNKNOWN', 'Cannot observe the saved transaction. Check the same ID later.', 6, { ...paymentView(j), status: 'unknown' });
  }
}
async function reconcileSigner(ctx: AgentContext, client: PublicClient, j: PaymentJournal) {
  for (const filename of await ctx.state.files('payment-')) {
    const id = filename.slice(8, -5);
    if (id === j.id) continue;
    const other = await loadPayment(ctx, id);
    if (!other.raw || ['confirmed', 'reverted'].includes(other.status) || other.intent.agent !== j.intent.agent) continue;
    if (await hasReceipt(client, other)) {
      try { await observe(ctx, client, other); }
      catch (e) { if (!(e instanceof WalletError) || e.code !== 'PAYMENT_REVERTED') throw e; }
    } else throw new WalletError('UNRESOLVED_PAYMENT', 'Resolve the previous signed payment before signing another transaction.', 6, paymentView(other));
  }
}
export async function pay(ctx: AgentContext, options: PaymentInput & { dryRun?: boolean; noWait?: boolean; timeout?: number }) {
  if (!options.paymentId) throw new WalletError('PAYMENT_ID_REQUIRED', 'Use --payment-id, or save a new ID with payments prepare first.', 2);
  const execute = async () => {
    const { journal: j, config } = await intent(ctx, options, !options.dryRun);
    const { client } = await ctx.public();
    if (options.dryRun) {
      const result = await preflight(ctx, client, config, j);
      return { ...paymentView(j), status: 'simulated', ...result, signed: false, submitted: false };
    }
    if (j.raw) {
      await verifyNetwork(client);
      if (await hasReceipt(client, j)) return observe(ctx, client, j, { timeout: options.timeout });
      if (j.status === 'reverted' || j.status === 'confirmed') throw new WalletError('PAYMENT_OUTCOME_UNKNOWN', 'Saved receipt is no longer available. Check the same payment; do not submit a new intent.', 6, paymentView(j));
    } else {
      await reconcileSigner(ctx, client, j);
      let request;
      try { request = await preflight(ctx, client, config, j); }
      catch (error) { if (error instanceof WalletError && error.exitCode === 4) { j.status = 'rejected'; await ctx.state.write(paymentFilename(j.id), j); } throw error; }
      const account = await ctx.account();
      const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
      const prepared = await wallet.prepareTransactionRequest({ account, chain, to: request.to, data: request.data, gas: request.gas, maxFeePerGas: request.maxFeePerGas, maxPriorityFeePerGas: 0n, nonce: await client.getTransactionCount({ address: account.address, blockTag: 'pending' }) });
      j.raw = await wallet.signTransaction(prepared);
      j.hash = keccak256(j.raw); j.nonce = String(prepared.nonce); j.status = 'signed';
      await ctx.state.write(paymentFilename(j.id), j);
    }
    await ctx.verify(client, config);
    try { await client.sendRawTransaction({ serializedTransaction: j.raw! }); }
    catch {
      try { await client.getTransaction({ hash: j.hash! }); }
      catch { throw new WalletError('PAYMENT_OUTCOME_UNKNOWN', 'Submission outcome is unknown. Check or resume the same saved ID.', 6, { ...paymentView(j), status: 'unknown' }); }
    }
    j.status = 'submitted'; await ctx.state.write(paymentFilename(j.id), j);
    if (options.noWait) return paymentView(j);
    return observe(ctx, client, j, { timeout: options.timeout });
  };
  try { return await (options.dryRun ? execute() : ctx.state.lock(execute)); }
  catch (error) {
    if (error instanceof WalletError || options.dryRun) throw error;
    const saved = await ctx.state.has(paymentFilename(options.paymentId)) ? await loadPayment(ctx, options.paymentId) : undefined;
    if (saved?.raw) throw new WalletError('PAYMENT_OUTCOME_UNKNOWN', 'The signed payment is recoverable. Check or resume the same saved ID.', 6, { ...paymentView(saved), status: 'unknown' });
    throw error;
  }
}

export async function listPayments(ctx: AgentContext) {
  return Promise.all((await ctx.state.files('payment-')).map(async filename => paymentView(await loadPayment(ctx, filename.slice(8, -5)))));
}
