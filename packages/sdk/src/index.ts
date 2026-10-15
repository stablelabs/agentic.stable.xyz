import { BaseError, encodeFunctionData, type Address, type Hash, type WalletClient, type PublicClient as ViemPublicClient } from 'viem';
import { walletAbi } from './client/abi.js';
import { address, chain, CHAIN_ID, identifier, validateConfig, type WalletConfig } from './client/config.js';
import { parseAmount } from './client/amount.js';
import { newGrantId, parseGrantDraft, type GrantDraft } from './client/grant-input.js';
import { creationCheck, statusCheck, prepareOwnerTransaction, trackTransaction, verifyAccount, verifyNetwork, type PublicClient, type WaitOptions } from './client/client.js';
import { listGrants, readBalances, readGrant, type GrantListOptions } from './client/grants.js';
import { fundingSuggestion, NATIVE_PER_TOKEN_UNIT, paymentGasReserve, prepareGasFunding, trackGasFunding } from './client/gas.js';
import { input, WalletError } from './client/errors.js';

export { WalletError, parseAmount };
export { newGrantId } from './client/grant-input.js';
export type { WalletConfig, GrantDraft, GrantListOptions, WaitOptions };
export type OwnerAction = 'create' | 'revoke' | 'approve' | 'reject' | 'fund';
export type OwnerOperation = {
  schemaVersion: 1; chainId: 2201; alice: Address; implementation: Address;
  operationId?: Hash;
  action: OwnerAction; grantId: Hash; intent: Record<string, string>;
  status: 'prepared' | 'submitted' | 'confirmed' | 'reverted' | 'rejected' | 'unknown';
  hash?: Hash;
};
export type OwnerClientOptions = {
  config: WalletConfig; publicClient: ViemPublicClient; walletClient?: WalletClient;
  onOperation?: (operation: OwnerOperation) => void | Promise<void>;
};

/** Returned errors retain the operation, including its hash after wallet submission. */
export class OwnerOperationError extends WalletError {
  constructor(code: string, message: string, public operation: OwnerOperation) { super(code, message, 3, operation); }
}

export function createOwnerClient(options: OwnerClientOptions) {
  const config = validateConfig(options.config);
  // Protocol helpers use the local chain type; identity is always verified on the wire.
  const client = options.publicClient as PublicClient;
  let submitting = false;
  const attempted = new Set<Hash>();
  const verify = async () => {
    try { await verifyAccount(client, config); }
    catch (error) {
      if (error instanceof WalletError) throw error;
      throw new WalletError(error instanceof BaseError ? 'RPC_UNAVAILABLE' : 'ACCOUNT_NOT_VERIFIED', error instanceof BaseError ? 'RPC verification is unavailable.' : error instanceof Error ? error.message : 'Account verification failed.');
    }
  };
  const descriptor = (action: OwnerAction, grantId: Hash, intent: Record<string, string>): OwnerOperation => ({
    schemaVersion: 1, chainId: CHAIN_ID, alice: config.alice, implementation: config.implementation, operationId: newGrantId(),
    action, grantId: identifier(grantId), intent, status: 'prepared',
  });
  function validateOperation(op: OwnerOperation) {
    if (op.schemaVersion !== 1 || op.chainId !== CHAIN_ID || op.alice?.toLowerCase() !== config.alice.toLowerCase() || op.implementation?.toLowerCase() !== config.implementation.toLowerCase() || !['create', 'revoke', 'approve', 'reject', 'fund'].includes(op.action)) throw new WalletError('OPERATION_MISMATCH', 'Operation belongs to another account, implementation, or schema.');
    input(() => identifier(op.grantId));
    if (op.operationId) input(() => identifier(op.operationId!));
  }
  async function persist(op: OwnerOperation) {
    try { await options.onOperation?.(structuredClone(op)); }
    catch { throw new OwnerOperationError('PERSISTENCE_FAILED', op.hash ? 'Could not persist the submitted transaction. Retain its hash and check confirmation.' : 'Could not persist the intent. No wallet transaction was requested.', op); }
  }
  async function ownerWallet() {
    const wallet = options.walletClient;
    if (!wallet) throw new WalletError('OWNER_WALLET_REQUIRED', 'Connect Alice in a wallet before submitting.');
    const addresses = await wallet.getAddresses();
    if (addresses[0]?.toLowerCase() !== config.alice.toLowerCase() || await wallet.getChainId() !== CHAIN_ID) throw new WalletError('OWNER_MISMATCH', 'Select Alice on Stable Testnet and reconnect.');
    await verify();
    return wallet;
  }
  async function prepareCreateGrant(terms: GrantDraft) {
    await verify();
    const parsed = input(() => parseGrantDraft(terms, config.alice, 0n));
    if (parsed.expiresAt <= (await client.getBlock()).timestamp) throw new WalletError('INVALID_INPUT', 'Expiry must be in the future.', 2);
    if ((await readGrant(client, config, parsed.id)).grant.status !== 0) throw new WalletError('GRANT_EXISTS', 'This grant ID already exists. Its terms cannot be overwritten.');
    const operation = descriptor('create', parsed.id, { agent: parsed.agent, recipient: parsed.recipient, budget: parsed.budget.toString(), expiresAt: parsed.expiresAt.toString() });
    const data = encodeFunctionData({ abi: walletAbi, functionName: 'createGrantFor', args: [config.alice, parsed.id, parsed.agent, parsed.recipient, parsed.budget, parsed.expiresAt] });
    return { ...operation, request: await prepareOwnerTransaction(client, config, data) };
  }
  async function prepareStatus(action: 'revoke' | 'approve' | 'reject', id: Hash) {
    await verify();
    const current = await readGrant(client, config, input(() => identifier(id)));
    if ((action === 'revoke' ? current.grant.status !== 2 : current.grant.status !== 1) || (action === 'approve' && current.status === 'Expired')) throw new WalletError('INVALID_GRANT_STATUS', 'Grant is not eligible for this action.');
    const g = current.grant;
    const op = descriptor(action, id, { agent: g.agent, recipient: g.recipient, budget: g.budget.toString(), expiresAt: g.expiresAt.toString() });
    const name = { revoke: 'revokeGrantFor', approve: 'approveGrantFor', reject: 'rejectGrantFor' }[action] as 'revokeGrantFor' | 'approveGrantFor' | 'rejectGrantFor';
    return { ...op, request: await prepareOwnerTransaction(client, config, encodeFunctionData({ abi: walletAbi, functionName: name, args: [config.alice, id] })) };
  }
  async function prepareFundAgentGas(params: { grantId: Hash; amount: string }) {
    await verify();
    const id = input(() => identifier(params.grantId));
    const current = await readGrant(client, config, id);
    if (current.status !== 'Active') throw new WalletError('INVALID_GRANT_STATUS', 'Grant is no longer active for this agent.');
    const amount = input(() => parseAmount(params.amount)) * NATIVE_PER_TOKEN_UNIT;
    const op = descriptor('fund', id, { agent: current.grant.agent, amount: amount.toString() });
    return { ...op, request: await prepareGasFunding(client, config.alice, current.grant.agent, amount) };
  }
  async function reprepare(op: OwnerOperation) {
    validateOperation(op);
    const i = op.intent;
    if (op.action === 'create') return prepareCreateGrant({ id: op.grantId, agent: i.agent, recipient: i.recipient, budget: atomicAmount(i.budget, 6), expires: new Date(Number(BigInt(i.expiresAt)) * 1000).toISOString().replace('.000Z', 'Z') });
    if (op.action === 'fund') {
      const prepared = await prepareFundAgentGas({ grantId: op.grantId, amount: atomicAmount(i.amount, 18) });
      if (prepared.intent.agent.toLowerCase() !== i.agent?.toLowerCase()) throw new WalletError('OPERATION_MISMATCH', 'Funding agent differs from reviewed terms.');
      return prepared;
    }
    const prepared = await prepareStatus(op.action, op.grantId);
    if (JSON.stringify(prepared.intent) !== JSON.stringify(i)) throw new WalletError('OPERATION_MISMATCH', 'Grant terms differ from the reviewed operation.');
    return prepared;
  }
  async function send(operation: OwnerOperation): Promise<OwnerOperation> {
    if (submitting) throw new WalletError('OWNER_BUSY', 'Another owner submission is in progress.');
    if (operation.status !== 'prepared' || operation.hash) throw new WalletError('ALREADY_SUBMITTED', 'Observe the saved operation instead of submitting it again.');
    if (!operation.operationId) throw new WalletError('OPERATION_ID_REQUIRED', 'Create a prepared operation before submitting.');
    const operationId = input(() => identifier(operation.operationId!));
    if (attempted.has(operationId)) throw new WalletError('ALREADY_SUBMITTED', 'This operation was already requested. Observe or reconcile its outcome before another submission.');
    submitting = true;
    let op: OwnerOperation = structuredClone(operation);
    try {
      // Reconstruct allowlisted calldata; never trust a serialized request supplied by a caller.
      const prepared = await reprepare(op);
      op = descriptor(prepared.action, prepared.grantId, prepared.intent);
      op.operationId = operationId;
      await ownerWallet();
      await persist(op);
      let wallet: WalletClient;
      try { wallet = await ownerWallet(); }
      catch (error) {
        // A failed final owner check is known to precede any wallet submission.
        await persist({ ...op, status: 'rejected' });
        throw error;
      }
      attempted.add(operationId);
      let hash: Hash;
      try { hash = await wallet.sendTransaction({ ...prepared.request, account: wallet.account?.type === 'local' ? wallet.account : config.alice, chain }); }
      catch (error) {
        const rejected = error instanceof BaseError ? error.walk(e => e instanceof Error && 'code' in e && e.code === 4001) : error;
        const isRejected = rejected instanceof Error && ('code' in rejected && rejected.code === 4001 || rejected.name === 'UserRejectedRequestError');
        if (isRejected) attempted.delete(operationId);
        op = { ...op, status: isRejected ? 'rejected' : 'unknown' };
        await persist(op);
        throw new OwnerOperationError(isRejected ? 'OWNER_REJECTED' : 'SUBMISSION_OUTCOME_UNKNOWN', isRejected ? 'Owner rejected the wallet request.' : 'Wallet submission outcome is unknown. Reconcile with wallet history before repeating this action.', op);
      }
      op = { ...op, hash, status: 'submitted' };
      await persist(op);
      return op;
    } finally { submitting = false; }
  }
  async function wait(operation: OwnerOperation, waitOptions: WaitOptions = {}) {
    validateOperation(operation);
    if (!operation.hash) throw new OwnerOperationError('NOT_SUBMITTED', 'No transaction hash is available. Check wallet history if submission was unknown.', operation);
    const hash = input(() => identifier(operation.hash!));
    await verifyNetwork(client);
    const i = operation.intent;
    try {
      const check = operation.action === 'create'
        ? creationCheck(config.alice, operation.grantId, address(i.agent), address(i.recipient), BigInt(i.budget), BigInt(i.expiresAt))
        : statusCheck(config.alice, operation.grantId, { revoke: 4, approve: 2, reject: 3 }[operation.action as 'revoke' | 'approve' | 'reject']);
      const result = operation.action === 'fund'
        ? await trackGasFunding(client, hash, config.alice, address(i.agent), BigInt(i.amount), waitOptions)
        : await trackTransaction(client, hash, check, waitOptions);
      const op: OwnerOperation = { ...operation, hash: result.hash, status: result.success ? 'confirmed' : 'reverted' };
      await persist(op);
      return { ...result, operation: op };
    } catch (error) {
      if (error instanceof OwnerOperationError) throw error;
      throw new OwnerOperationError('OPERATION_UNVERIFIED', error instanceof Error && !(error instanceof BaseError) ? error.message : 'Operation is unverified. Retain its hash and check confirmation.', operation);
    }
  }
  return {
    verifyAccount: verify,
    getGrant: (id: Hash, blockNumber?: bigint) => readGrant(client, config, id, blockNumber),
    listGrants: (opts?: GrantListOptions) => listGrants(client, config, opts),
    getBalances: (agent = config.defaultAgent) => readBalances(client, config, agent),
    prepareCreateGrant,
    createGrant: async (terms: GrantDraft) => send(await prepareCreateGrant(terms)),
    prepareRevokeGrant: (id: Hash) => prepareStatus('revoke', id),
    revokeGrant: async (id: Hash) => send(await prepareStatus('revoke', id)),
    prepareFundAgentGas,
    fundAgentGas: async (params: { grantId: Hash; amount: string }) => send(await prepareFundAgentGas(params)),
    estimateAgentGas: async (id: Hash) => {
      const row = await readGrant(client, config, id);
      const [balance, reserve] = await Promise.all([client.getBalance({ address: row.grant.agent }), paymentGasReserve(client, config, id, row.grant)]);
      return { agent: row.grant.agent, balance, reserve, suggestedTopUp: fundingSuggestion(balance, reserve), nativeDecimals: 18 };
    },
    send, wait,
    legacy: {
      approveGrant: async (id: Hash) => send(await prepareStatus('approve', id)),
      rejectGrant: async (id: Hash) => send(await prepareStatus('reject', id)),
    },
  };
}

function atomicAmount(text: string, decimals: number): string {
  if (!/^\d+$/.test(text)) throw new WalletError('INVALID_INPUT', 'Invalid atomic amount.', 2);
  const n = BigInt(text), scale = 10n ** BigInt(decimals);
  return `${n / scale}.${(n % scale).toString().padStart(decimals, '0')}`.replace(/\.?0+$/, '') || '0';
}

// Public wallet configuration and presentation helpers for SDK consumers.
export { chain, CHAIN_ID, TOKEN, RPC, EXPLORER, DECIMALS, identifier, address, validateConfig } from './client/config.js';
export { formatAmount } from './client/amount.js';
export { grantStatus, publicClient, type Grant } from './client/client.js';
export { fundingSuggestion, NATIVE_PER_TOKEN_UNIT } from './client/gas.js';
