import { expect, it } from 'vitest';
import { keccak256, toHex } from 'viem';
import { listGrants, readGrant } from '../src/client/grants';
import { TOKEN, type WalletConfig } from '../src/client/config';
import type { PublicClient } from '../src/client/client';

const alice = '0x1111111111111111111111111111111111111111';
const agent = '0x2222222222222222222222222222222222222222';
const other = '0x3333333333333333333333333333333333333333';
const blockHash = keccak256('0x1234');
const config: WalletConfig = { alice, defaultAgent: agent, chainId: 2201, token: TOKEN, implementation: other, implementationCodeHash: blockHash, rpcUrl: 'http://localhost:18545', approvalUrl: 'http://localhost:5174' };
const ids = [0, 1, 2].map(n => keccak256(toHex(n)));
function fixture() {
  const observedBlocks: bigint[] = [];
  const grants = ids.map((_, i) => ({ agent: i === 2 ? other : agent, recipient: other, budget: 10000n, spent: 0n, expiresAt: i === 0 ? 1000n : 2000n, status: 2 }));
  const rpc = {
    getBlock: async () => ({ number: 100n, hash: blockHash, timestamp: 1000n }),
    readContract: async ({ functionName, args, blockNumber }: { functionName: string; args: unknown[]; blockNumber: bigint }) => {
      observedBlocks.push(blockNumber);
      if (functionName === 'grantCount') return 3n;
      if (functionName === 'grantIdAt') return ids[Number(args[0])];
      return grants[ids.indexOf(args[0] as typeof ids[0])];
    },
  };
  return { client: rpc as unknown as PublicClient, observedBlocks };
}
it('returns a continuation cursor after a bounded scan with no matching agent', async () => {
  const { client, observedBlocks } = fixture();
  const first = await listGrants(client, config, { agent, limit: 1, maxScan: 1 });
  expect(first.items).toEqual([]); expect(first.cursor).toBeTruthy();
  const second = await listGrants(client, config, { agent, limit: 1, maxScan: 1, cursor: first.cursor! });
  expect(second.items[0].id).toBe(ids[1]);
  expect(observedBlocks.every(block => block === 100n)).toBe(true);
});
it('uses block time for expiry and filters derived statuses', async () => {
  const { client } = fixture();
  expect((await readGrant(client, config, ids[0])).status).toBe('Expired');
  expect((await listGrants(client, config, { agent, status: 'active' })).items.map(row => row.id)).toEqual([ids[1]]);
});
it('rejects malformed or reorganized snapshots and unbounded page sizes', async () => {
  const { client } = fixture();
  await expect(listGrants(client, config, { cursor: 'bad' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(listGrants(client, config, { cursor: `100:${keccak256('0x99')}:3` })).rejects.toMatchObject({ code: 'SNAPSHOT_CHANGED' });
  await expect(listGrants(client, config, { limit: 10000 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
