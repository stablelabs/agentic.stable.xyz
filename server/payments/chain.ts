import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { stableTestnet } from 'viem/chains';
import { CHAIN_CONFIGS, Chain } from '@stablechain/sdk';
import { asset, network, type Quote } from '../../shared/contracts';
import { AppError, requireThat } from '../errors';

export type Prepared = { raw: Hex; hash: Hex; nonce: number };
export type Settlement = { success: boolean; fee: string; timestamp: string };
export interface PaymentChain {
  verifyNetwork(): Promise<unknown>;
  balance(address: string): Promise<bigint>;
  prepare(key: Hex, to: string, amount: bigint, data: Hex, maxFee: bigint): Promise<Prepared>;
  broadcast(raw: Hex): Promise<void>;
  settlement(hash: Hex, quote: Quote): Promise<Settlement | null>;
}
export const binding = (quote: Quote): Hex => `0x${quote.requestDigest}`;

export class StableChain implements PaymentChain {
  client;
  constructor(public rpc: string) {
    this.client = createPublicClient({
      chain: stableTestnet,
      transport: http(rpc, { timeout: 10_000, retryCount: 0 }),
    });
  }
  async verifyNetwork() {
    const sdk = CHAIN_CONFIGS[Chain.StableTestnet]!;
    requireThat(
      stableTestnet.id === network.chainId && sdk.id === network.chainId,
      'UNSUPPORTED_NETWORK',
      'SDK network configuration changed.',
      503,
    );
    requireThat(
      stableTestnet.nativeCurrency.decimals === asset.decimals &&
        stableTestnet.nativeCurrency.symbol === asset.symbol,
      'UNSUPPORTED_NETWORK',
      'Native asset metadata differs from this deployment.',
      503,
    );
    requireThat(
      stableTestnet.blockExplorers.default.url === network.explorerBaseUrl,
      'UNSUPPORTED_NETWORK',
      'Explorer metadata differs from this deployment.',
      503,
    );
    const chainId = await this.client.getChainId();
    requireThat(chainId === sdk.id, 'UNSUPPORTED_NETWORK', 'RPC is not Stable Testnet.', 503);
    const [decimals, symbol, block] = await Promise.all([
      this.client.readContract({
        address: sdk.usdt,
        abi: parseAbi(['function decimals() view returns (uint8)']),
        functionName: 'decimals',
      }),
      this.client.readContract({
        address: sdk.usdt,
        abi: parseAbi(['function symbol() view returns (string)']),
        functionName: 'symbol',
      }),
      this.client.getBlock(),
    ]);
    requireThat(
      decimals === sdk.decimals && (symbol === 'USDT0' || symbol === 'USD\u20ae0'),
      'UNSUPPORTED_NETWORK',
      'USDT0 contract metadata could not be verified.',
      503,
    );
    requireThat(
      Date.now() / 1000 - Number(block.timestamp) < 180,
      'RPC_UNAVAILABLE',
      'RPC has stopped advancing.',
      503,
    );
    return {
      chainId,
      nativeAsset: asset,
      erc20Decimals: decimals,
      erc20Address: sdk.usdt,
      explorer: network.explorerBaseUrl,
      blockNumber: String(block.number),
      checkedAt: new Date().toISOString(),
    };
  }
  balance(address: string) {
    return this.client.getBalance({ address: address as Address });
  }
  async prepare(
    key: Hex,
    to: string,
    amount: bigint,
    data: Hex,
    maxFee: bigint,
  ): Promise<Prepared> {
    await this.verifyNetwork();
    const account = privateKeyToAccount(key);
    const [estimated, block, nonce, balance] = await Promise.all([
      this.client.estimateGas({ account, to: to as Address, value: amount, data }),
      this.client.getBlock(),
      this.client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
      this.balance(account.address),
    ]);
    const gas = estimated + estimated / 5n;
    const maxFeePerGas = (block.baseFeePerGas ?? (await this.client.getGasPrice())) * 2n;
    requireThat(
      gas * maxFeePerGas <= maxFee,
      'QUOTE_CHANGED',
      'Network fees exceed the accepted maximum. Request a new quote.',
    );
    requireThat(
      balance >= amount + gas * maxFeePerGas,
      'INSUFFICIENT_FUNDS',
      'Not enough testnet balance for this purchase.',
    );
    const wallet = createWalletClient({ account, chain: stableTestnet, transport: http(this.rpc) });
    const raw = await wallet.signTransaction({
      to: to as Address,
      value: amount,
      data,
      gas,
      nonce,
      maxFeePerGas,
      maxPriorityFeePerGas: 0n,
      type: 'eip1559',
    });
    return { raw, hash: keccak256(raw), nonce };
  }
  async broadcast(raw: Hex) {
    await this.verifyNetwork();
    const hash = keccak256(raw);
    try {
      await this.client.sendRawTransaction({ serializedTransaction: raw });
    } catch (error) {
      // "Already known" and a lost RPC response are recovered by identity, never a new signature.
      try {
        await this.client.getTransaction({ hash });
      } catch {
        throw error;
      }
    }
  }
  async settlement(hash: Hex, quote: Quote): Promise<Settlement | null> {
    await this.verifyNetwork();
    let receipt;
    try {
      receipt = await this.client.getTransactionReceipt({ hash });
    } catch (error) {
      if ((error as Error).name === 'TransactionReceiptNotFoundError') return null;
      throw error;
    }
    const tx = await this.client.getTransaction({ hash });
    requireThat(
      tx.chainId === network.chainId &&
        tx.from.toLowerCase() === quote.payer.toLowerCase() &&
        tx.to?.toLowerCase() === quote.payee.toLowerCase() &&
        tx.value === BigInt(quote.price.amountAtomic) &&
        tx.input === binding(quote),
      'INVALID_PAYMENT',
      'Payment does not match this purchase.',
    );
    requireThat(
      receipt.transactionHash === hash &&
        receipt.from.toLowerCase() === quote.payer.toLowerCase() &&
        receipt.to?.toLowerCase() === quote.payee.toLowerCase(),
      'INVALID_PAYMENT',
      'Settlement identity does not match.',
    );
    const [head, block] = await Promise.all([
      this.client.getBlockNumber(),
      this.client.getBlock({ blockNumber: receipt.blockNumber }),
    ]);
    if (head < receipt.blockNumber + 1n) return null;
    requireThat(
      block.hash === receipt.blockHash,
      'PAYMENT_UNKNOWN',
      'Settlement is being reconciled.',
    );
    const fee = receipt.gasUsed * receipt.effectiveGasPrice;
    requireThat(
      fee <= BigInt(quote.maxNetworkFee.amountAtomic),
      'PAYMENT_UNKNOWN',
      'Settlement fee needs operator reconciliation.',
    );
    return {
      success: receipt.status === 'success',
      fee: String(fee),
      timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
    };
  }
}
