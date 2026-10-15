import type { Address, Hex } from 'viem';
import { walletAbi, tokenAbi } from './abi.js';
import { TOKEN, identifier, type WalletConfig } from './config.js';
import { grantStatus, type Grant, type PublicClient } from './client.js';
import { WalletError } from './errors.js';

export async function readGrant(client: PublicClient, config: WalletConfig, id: Hex, blockNumber?: bigint) {
  identifier(id);
  const block = await client.getBlock(blockNumber === undefined ? {} : { blockNumber });
  const g = await client.readContract({ address: config.alice, abi: walletAbi, functionName: 'getGrant', args: [id], blockNumber: block.number }) as Grant;
  return { id, grant: g, status: grantStatus(g, block.timestamp), remainingBudget: g.budget - g.spent, block: block.number, timestamp: block.timestamp };
}

export type GrantListOptions = { limit?: number; cursor?: string; agent?: Address; status?: string; maxScan?: number };
export async function listGrants(client: PublicClient, config: WalletConfig, options: GrantListOptions = {}) {
  const limit = options.limit ?? 20;
  const maxScan = options.maxScan ?? 200;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(maxScan) || maxScan < limit || maxScan > 1000) throw new WalletError('INVALID_INPUT', 'Grant limit must be 1–100 and scan limit must be between the limit and 1000.', 2);
  const parts = options.cursor?.split(':');
  if (parts && (parts.length !== 3 || !/^\d+$/.test(parts[0]) || !/^0x[0-9a-fA-F]{64}$/.test(parts[1]) || !/^\d+$/.test(parts[2]))) throw new WalletError('INVALID_INPUT', 'Invalid grant cursor.', 2);
  const block = await client.getBlock(parts ? { blockNumber: BigInt(parts[0]) } : {});
  if (parts && block.hash !== parts[1]) throw new WalletError('SNAPSHOT_CHANGED', 'Grant snapshot changed. Start a new listing.');
  const total = await client.readContract({ address: config.alice, abi: walletAbi, functionName: 'grantCount', blockNumber: block.number });
  let next = parts ? BigInt(parts[2]) : total;
  if (next > total) throw new WalletError('INVALID_INPUT', 'Grant cursor is outside this account.', 2);
  const items: Awaited<ReturnType<typeof readGrant>>[] = [];
  let scanned = 0;
  while (next > 0n && items.length < limit && scanned < maxScan) {
    // Bound both RPC fan-out and the total work per page. Cursor counts scanned records.
    const size = Math.min(5, limit - items.length, maxScan - scanned, Number(next > 1000n ? 1000n : next));
    const indices = Array.from({ length: size }, (_, i) => next - BigInt(i) - 1n);
    const rows = await Promise.all(indices.map(async index => {
      const id = await client.readContract({ address: config.alice, abi: walletAbi, functionName: 'grantIdAt', args: [index], blockNumber: block.number });
      return readGrant(client, config, id, block.number);
    }));
    next -= BigInt(size); scanned += size;
    items.push(...rows.filter(row => row.grant.status !== 0 && (!options.agent || row.grant.agent.toLowerCase() === options.agent.toLowerCase()) && (!options.status || row.status.toLowerCase() === options.status.toLowerCase())));
  }
  return { items, total, block: block.number, timestamp: block.timestamp, cursor: next > 0n ? `${block.number}:${block.hash}:${next}` : null };
}

export async function readBalances(client: PublicClient, config: WalletConfig, agent?: Address) {
  const block = await client.getBlock();
  const [aliceToken, agentNative] = await Promise.all([
    client.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'balanceOf', args: [config.alice], blockNumber: block.number }),
    agent ? client.getBalance({ address: agent, blockNumber: block.number }) : undefined,
  ]);
  return { alice: config.alice, aliceToken, tokenDecimals: 6, agent, agentNative, nativeDecimals: 18, block: block.number, timestamp: block.timestamp };
}
