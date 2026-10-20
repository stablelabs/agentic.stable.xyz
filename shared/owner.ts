import { BaseError, encodeFunctionData, type Address, type Hash, type WalletClient, type PublicClient as ViemPublicClient } from 'viem';
import { tokenAbi } from './client/abi.js';
import { address, chain, CHAIN_ID, identifier, validateConfig, type WalletConfig } from './client/config.js';
import { parseAmount, formatAmount } from './client/amount.js';
import { approvalCheck, prepareOwnerTransaction, trackTransaction, verifyNetwork, readAllowance, readBalances, type PublicClient, type WaitOptions } from './client/client.js';
import { fundingSuggestion, NATIVE_PER_TOKEN_UNIT, paymentGasReserve, prepareGasFunding, trackGasFunding } from './client/gas.js';
import { input, WalletError } from './client/errors.js';

export { WalletError, parseAmount, formatAmount };
export type { WalletConfig, WaitOptions };
export type OwnerOperation = {
  schemaVersion: 2; chainId: 2201; token: Address; alice: Address; operationId: Hash;
  action: 'approve' | 'fund'; intent: { agent: Address; amount: string };
  status: 'prepared' | 'submitted' | 'confirmed' | 'reverted' | 'rejected' | 'unknown'; hash?: Hash;
};
export type OwnerClientOptions = {
  config: WalletConfig; publicClient: ViemPublicClient; walletClient?: WalletClient;
  onOperation?: (operation: OwnerOperation) => void | Promise<void>;
};
export class OwnerOperationError extends WalletError {
  constructor(code: string, message: string, public operation: OwnerOperation) { super(code, message, 3, operation); }
}
export function newOperationId(): Hash {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('')}`;
}
export function createOwnerClient(options: OwnerClientOptions) {
  const config = validateConfig(options.config);
  const client = options.publicClient as PublicClient;
  let submitting = false;
  const attempted = new Set<Hash>();
  const verify = () => verifyNetwork(client);
  const agentAddress = (value: string) => input(() => {
    const agent = address(value, 'agent address');
    if (agent === config.alice) throw new Error('Choose a separate agent signer.');
    return agent;
  });
  const descriptor = (action: OwnerOperation['action'], agent: Address, amount: bigint): OwnerOperation => ({
    schemaVersion: 2, chainId: CHAIN_ID, token: config.token, alice: config.alice, operationId: newOperationId(),
    action, intent: { agent, amount: String(amount) }, status: 'prepared',
  });
  function validateOperation(op: OwnerOperation) {
    if (op.schemaVersion !== 2 || op.chainId !== CHAIN_ID || op.alice?.toLowerCase() !== config.alice.toLowerCase() || op.token?.toLowerCase() !== config.token.toLowerCase() || !['approve', 'fund'].includes(op.action)) throw new WalletError('OPERATION_MISMATCH', 'Operation belongs to another account, token, or schema.');
    input(() => identifier(op.operationId)); agentAddress(op.intent.agent);
    if (!/^(0|[1-9]\d*)$/.test(op.intent.amount) || BigInt(op.intent.amount) >= 2n ** 256n || op.action === 'fund' && BigInt(op.intent.amount) === 0n) throw new WalletError('INVALID_INPUT', 'Invalid operation amount.', 2);
  }
  async function persist(op: OwnerOperation) {
    try { await options.onOperation?.(structuredClone(op)); }
    catch { throw new OwnerOperationError('PERSISTENCE_FAILED', op.hash ? 'Could not persist the submitted transaction. Retain its hash and check confirmation.' : 'Could not persist the intent. No wallet transaction was requested.', op); }
  }
  async function ownerWallet() {
    const wallet = options.walletClient;
    if (!wallet) throw new WalletError('OWNER_WALLET_REQUIRED', 'Connect the wallet owner before submitting.');
    if ((await wallet.getAddresses())[0]?.toLowerCase() !== config.alice.toLowerCase() || await wallet.getChainId() !== CHAIN_ID) throw new WalletError('OWNER_MISMATCH', 'Select the wallet owner on Stable Testnet and reconnect.');
    await verify(); return wallet;
  }
  async function prepareApproval(params: { agent: string; amount: string }) {
    await verify();
    const agent = agentAddress(params.agent);
    const amount = params.amount === '0' ? 0n : input(() => parseAmount(params.amount));
    const current = await readAllowance(client, config, agent);
    if (current > 0n && amount > 0n) throw new WalletError('RESET_ALLOWANCE_REQUIRED', 'Revoke the current allowance to zero, wait for confirmation, then approve a new amount.');
    const operation = descriptor('approve', agent, amount);
    const data = encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [agent, amount] });
    return { ...operation, request: await prepareOwnerTransaction(client, config, data) };
  }
  async function prepareFundAgentGas(params: { agent: string; amount: string }) {
    await verify();
    const agent = agentAddress(params.agent);
    const amount = input(() => parseAmount(params.amount)) * NATIVE_PER_TOKEN_UNIT;
    return { ...descriptor('fund', agent, amount), request: await prepareGasFunding(client, config.alice, agent, amount) };
  }
  async function reprepare(op: OwnerOperation) {
    validateOperation(op);
    return op.action === 'approve'
      ? prepareApproval({ agent: op.intent.agent, amount: formatAmount(BigInt(op.intent.amount)) })
      : prepareFundAgentGas({ agent: op.intent.agent, amount: formatAmount(BigInt(op.intent.amount) / NATIVE_PER_TOKEN_UNIT) });
  }
  async function send(operation: OwnerOperation): Promise<OwnerOperation> {
    if (submitting) throw new WalletError('OWNER_BUSY', 'Another owner submission is in progress.');
    validateOperation(operation);
    if (operation.status !== 'prepared' || operation.hash || attempted.has(operation.operationId)) throw new WalletError('ALREADY_SUBMITTED', 'Observe or reconcile the saved operation before another submission.');
    submitting = true;
    let op = descriptor(operation.action, agentAddress(operation.intent.agent), BigInt(operation.intent.amount));
    op.operationId = operation.operationId;
    try {
      const prepared = await reprepare(op);
      if (JSON.stringify(prepared.intent) !== JSON.stringify(op.intent)) throw new WalletError('OPERATION_MISMATCH', 'Operation differs from reviewed terms.');
      await ownerWallet(); await persist(op);
      let wallet: WalletClient;
      try { wallet = await ownerWallet(); }
      catch (error) { await persist({ ...op, status: 'rejected' }); throw error; }
      attempted.add(op.operationId);
      let hash: Hash;
      try { hash = await wallet.sendTransaction({ ...prepared.request, account: wallet.account?.type === 'local' ? wallet.account : config.alice, chain }); }
      catch (error) {
        const rejected = error instanceof BaseError ? error.walk(e => e instanceof Error && 'code' in e && e.code === 4001) : error;
        const isRejected = rejected instanceof Error && ('code' in rejected && rejected.code === 4001 || rejected.name === 'UserRejectedRequestError');
        op = { ...op, status: isRejected ? 'rejected' : 'unknown' }; await persist(op);
        if (isRejected) attempted.delete(op.operationId);
        throw new OwnerOperationError(isRejected ? 'OWNER_REJECTED' : 'SUBMISSION_OUTCOME_UNKNOWN', isRejected ? 'Owner rejected the wallet request.' : 'Wallet submission outcome is unknown. Reconcile with wallet history before repeating this action.', op);
      }
      op = { ...op, hash, status: 'submitted' }; await persist(op); return op;
    } finally { submitting = false; }
  }
  async function wait(operation: OwnerOperation, waitOptions: WaitOptions = {}) {
    validateOperation(operation);
    if (!operation.hash) throw new OwnerOperationError('NOT_SUBMITTED', 'No transaction hash is available. Find the operation in MetaMask history before repeating it.', operation);
    const hash = input(() => identifier(operation.hash!)); await verify();
    try {
      const { agent, amount } = operation.intent;
      const result = operation.action === 'fund'
        ? await trackGasFunding(client, hash, config.alice, agent, BigInt(amount), waitOptions)
        : await trackTransaction(client, hash, approvalCheck(config.token, config.alice, agent, BigInt(amount)), waitOptions);
      if (result.success && operation.action === 'approve') {
        const tx = await client.getTransaction({ hash: result.hash });
        const data = encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [agent, BigInt(amount)] });
        if (tx.from.toLowerCase() !== config.alice.toLowerCase() || tx.to?.toLowerCase() !== config.token.toLowerCase() || tx.value !== 0n || tx.input !== data) throw new Error('Transaction does not match the reviewed token approval.');
      }
      const op: OwnerOperation = { ...operation, hash: result.hash, status: result.success ? 'confirmed' : 'reverted' };
      await persist(op); return { ...result, operation: op };
    } catch (error) {
      if (error instanceof OwnerOperationError) throw error;
      throw new OwnerOperationError('OPERATION_UNVERIFIED', error instanceof Error && !(error instanceof BaseError) ? error.message : 'Operation is unverified. Retain its hash and check confirmation.', operation);
    }
  }
  return {
    verifyNetwork: verify,
    getAllowance: (agent: string) => readAllowance(client, config, agentAddress(agent)),
    getBalances: (agent = config.defaultAgent) => readBalances(client, config, agent ? agentAddress(agent) : undefined),
    prepareApproval, approve: async (params: { agent: string; amount: string }) => send(await prepareApproval(params)),
    revoke: async (agent: string) => send(await prepareApproval({ agent, amount: '0' })),
    prepareFundAgentGas, fundAgentGas: async (params: { agent: string; amount: string }) => send(await prepareFundAgentGas(params)),
    estimateAgentGas: async (params: { agent: string; recipient: string; amount: string }) => {
      await verify(); const agent = agentAddress(params.agent);
      const [balance, reserve] = await Promise.all([client.getBalance({ address: agent }), paymentGasReserve(client, config, agent, input(() => address(params.recipient)), input(() => parseAmount(params.amount)))]);
      return { agent, balance, reserve, suggestedTopUp: fundingSuggestion(balance, reserve), nativeDecimals: 18 };
    },
    send, wait,
  };
}
export { chain, CHAIN_ID, TOKEN, RPC, EXPLORER, DECIMALS, identifier, address, validateConfig } from './client/config.js';
export { publicClient } from './client/client.js';
export { fundingSuggestion, NATIVE_PER_TOKEN_UNIT } from './client/gas.js';
