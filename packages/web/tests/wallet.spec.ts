import { expect, test, type Page } from '@playwright/test';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, keccak256, toHex, type Hex } from 'viem';
import { walletAbi, tokenAbi } from '@stablechain/agent-wallet-sdk/protocol';
import { TOKEN } from '@stablechain/agent-wallet-sdk/protocol';

const alice = '0x1111111111111111111111111111111111111111';
const agent = '0x2222222222222222222222222222222222222222';
const recipient = '0x3333333333333333333333333333333333333333';
const implementation = '0x4444444444444444444444444444444444444444';
const grantId = keccak256('0x01');
const blockHash = keccak256('0x03');
const rpcUrl = 'https://rpc.agent-wallet.invalid';
const code = '0x60006000';
const config = { chainId: 2201, rpcUrl, token: TOKEN, alice, implementation, implementationCodeHash: keccak256(code), approvalUrl: 'http://127.0.0.1:5174', defaultAgent: agent };
const block = { number: '0x64', hash: blockHash, parentHash: blockHash, timestamp: toHex(1791936000), baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380', gasUsed: '0x5208', miner: alice, difficulty: '0x0', totalDifficulty: '0x0', nonce: '0x0000000000000000', extraData: '0x', logsBloom: `0x${'00'.repeat(256)}`, transactions: [], size: '0x100' };
type MockGrant = { agent: Hex; recipient: Hex; budget: bigint; spent: bigint; expiresAt: bigint; status: number };
async function fixture(page: Page, options: { wrongAccount?: boolean; badCode?: boolean; legacy?: boolean; active?: boolean; oldVersion?: boolean; reject?: boolean; rejectFunding?: boolean; revertFunding?: boolean; agentBalance?: bigint; gasUnavailable?: boolean; mismatchFunding?: boolean; loseSecondFundingHash?: boolean } = {}) {
  const grants = new Map<Hex, MockGrant>();
  if (options.legacy || options.active) grants.set(grantId, { agent, recipient, budget: 10000n, spent: 0n, expiresAt: 1893456000n, status: options.active ? 2 : 1 });
  let agentBalance = options.agentBalance ?? 0n;
  const submissions: { to: string; data: Hex; value?: Hex }[] = [];
  const transactions = new Map<Hex, { to: string; data: Hex; value?: Hex }>();
  const logs = new Map<Hex, unknown[]>();
  await page.route('**/wallet-config.json', route => route.fulfill({ json: config }));
  await page.route(`${rpcUrl}/`, async route => {
    const body = route.request().postDataJSON();
    function result(request: { id: number; method: string; params: any[] }): unknown {
      const { method, params } = request;
      if (method === 'eth_chainId') return '0x899';
      if (method === 'eth_getBalance') return toHex(params[0].toLowerCase() === agent ? agentBalance : 10n ** 20n);
      if (method === 'eth_estimateGas') {
        const from = params[0].from.toLowerCase(), to = params[0].to.toLowerCase();
        if (from === agent && to === alice) {
          if (options.gasUnavailable) return undefined;
          return '0x1f400';
        }
        if (from === alice && to === agent && (!params[0].data || params[0].data === '0x')) return '0x5208';
        if (to !== implementation || from !== alice) throw new Error('Wrong forwarding route');
        return '0x30d40';
      }
      if (method === 'eth_blockNumber') return '0x64';
      if (method === 'eth_getCode') return params[0].toLowerCase() === alice ? (options.badCode ? '0x' : `0xef0100${implementation.slice(2)}`) : code;
      if (method === 'eth_getBlockByNumber') return block;
      if (method === 'eth_getTransactionByHash') { const tx = transactions.get(params[0]); return { hash: params[0], blockHash, blockNumber: '0x64', from: alice, to: options.mismatchFunding ? recipient : tx?.to || implementation, nonce: '0x0', gas: '0x10000', gasPrice: '0x1', value: tx?.value || '0x0', input: tx?.data || '0x', type: '0x2', chainId: '0x899', transactionIndex: '0x0', v: '0x0', r: '0x1', s: '0x1' }; }
      if (method === 'eth_getTransactionReceipt') return { transactionHash: params[0], blockHash, blockNumber: '0x64', from: alice, to: transactions.get(params[0])?.to || implementation, contractAddress: null, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', status: options.revertFunding && transactions.get(params[0])?.to === agent ? '0x0' : '0x1', transactionIndex: '0x0', type: '0x2', logs: logs.get(params[0]) || [], logsBloom: `0x${'00'.repeat(256)}` };
      if (method === 'eth_call') {
        const abi = params[0].to.toLowerCase() === TOKEN.toLowerCase() ? tokenAbi : walletAbi;
        const decoded = decodeFunctionData({ abi, data: params[0].data });
        const args = decoded.args as readonly unknown[] | undefined;
        const values: Record<string, unknown> = { decimals: 6, symbol: 'USDT0', TOKEN, IMPLEMENTATION: implementation, VERSION: options.oldVersion ? 2n : 3n, grantCount: BigInt(grants.size), grantIdAt: [...grants.keys()][Number(args?.[0] || 0)], balanceOf: 1000000n, getGrant: grants.get(args?.[0] as Hex) || { agent: `0x${'00'.repeat(20)}`, recipient: `0x${'00'.repeat(20)}`, budget: 0n, spent: 0n, expiresAt: 0n, status: 0 } };
        if (!(decoded.functionName in values)) return '0x';
        return encodeFunctionResult({ abi, functionName: decoded.functionName, result: values[decoded.functionName] } as never);
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    }
    const response = (request: any) => options.gasUnavailable && request.method === 'eth_estimateGas' && request.params[0].from.toLowerCase() === agent ? { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Gas estimation unavailable' } } : ({ jsonrpc: '2.0', id: request.id, result: result(request) });
    await route.fulfill({ json: Array.isArray(body) ? body.map(response) : response(body) });
  });
  await page.exposeFunction('walletTestDrain', () => { agentBalance = 0n; });
  await page.exposeFunction('walletTestSubmit', (tx: { to: string; data: Hex; value?: Hex }) => {
    if (options.reject) throw new Error('User rejected the MetaMask confirmation.');
    submissions.push(tx);
    const hash = keccak256(toHex(submissions.length));
    transactions.set(hash, tx);
    if (tx.to.toLowerCase() === agent && (!tx.data || tx.data === '0x')) {
      if (!options.revertFunding) agentBalance += BigInt(tx.value!);
      return hash;
    }
    const decoded = decodeFunctionData({ abi: walletAbi, data: tx.data });
    const args = decoded.args as readonly any[];
    if (args[0].toLowerCase() !== alice) throw new Error('Unexpected forwarded owner');
    const id = args[1] as Hex;
    const eventLogs: any[] = [];
    const addLog = (topics: readonly unknown[], data: Hex) => eventLogs.push({ address: alice, topics, data, blockHash, blockNumber: '0x64', transactionHash: hash, transactionIndex: '0x0', logIndex: toHex(eventLogs.length), removed: false });
    if (decoded.functionName === 'createGrantFor') {
      grants.set(id, { agent: args[2], recipient: args[3], budget: args[4], spent: 0n, expiresAt: args[5], status: 2 });
      addLog(encodeEventTopics({ abi: walletAbi, eventName: 'GrantCreated', args: { grantId: id, agent: args[2] } }), encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'uint64' }], [args[3], args[4], args[5]]));
    } else grants.get(id)!.status = decoded.functionName === 'approveGrantFor' ? 2 : decoded.functionName === 'rejectGrantFor' ? 3 : 4;
    addLog(encodeEventTopics({ abi: walletAbi, eventName: 'GrantStatusChanged', args: { grantId: id } }), encodeAbiParameters([{ type: 'uint8' }], [grants.get(id)!.status]));
    logs.set(hash, eventLogs); return hash;
  });
  await page.addInitScript(({ account, reject, rejectFunding, agent, loseSecondFundingHash }) => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    let fundingCount = 0;
    (window as any).ethereum = { isMetaMask: true, request: async ({ method, params }: any) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
      if (method === 'eth_chainId') return '0x899';
      if (method === 'wallet_switchEthereumChain') return null;
      if (method === 'eth_sendTransaction') {
        const tx = params[0];
        if (tx.to.toLowerCase() === account.toLowerCase() && tx.data && tx.data !== '0x') throw Object.assign(new Error('External transactions to internal accounts cannot include data'), { code: -32602 });
        if (tx.maxPriorityFeePerGas !== undefined && tx.maxFeePerGas === undefined) throw Object.assign(new Error('Incomplete fee parameters'), { code: -32602 });
        if (reject) throw Object.assign(new Error('User rejected the MetaMask confirmation.'), { code: 4001 });
        if (rejectFunding && tx.to.toLowerCase() === agent) throw Object.assign(new Error('User rejected the gas funding confirmation.'), { code: 4001 });
        const hash = await (window as any).walletTestSubmit(params[0]);
        if (tx.to.toLowerCase() === agent && ++fundingCount === 2 && loseSecondFundingHash) throw new Error('Wallet connection lost after submission.');
        return hash;
      }
      throw new Error(`Unexpected wallet method ${method}`);
    }, on: (name: string, fn: (...args: unknown[]) => void) => { (listeners[name] ||= []).push(fn); }, removeListener: () => {} };
    (window as any).walletTestSwitch = () => listeners.accountsChanged?.forEach(fn => fn([]));
  }, { account: options.wrongAccount ? agent : alice, reject: !!options.reject, rejectFunding: !!options.rejectFunding, agent, loseSecondFundingHash: !!options.loseSecondFundingHash });
  return submissions;
}
async function fillGrant(page: Page) {
  await page.getByLabel('Allowed recipient', { exact: true }).fill(recipient);
  await page.getByLabel('Cumulative budget (USDT0)', { exact: true }).fill('0.01');
  await page.getByLabel('Expires (UTC)', { exact: true }).fill('2030-01-01T00:00:00Z');
}
test('Alice creates and authorizes an exact grant in one transaction and can revoke it', async ({ page }) => {
  const submissions = await fixture(page);
  await page.goto(`/?newGrant=${grantId}`);
  await expect(page.getByText('✓ Account code verified', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create and authorize grant' })).toBeDisabled();
  await page.getByRole('button', { name: 'Connect MetaMask' }).click(); await fillGrant(page);
  await page.getByRole('button', { name: 'Create and authorize grant' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  expect(submissions).toHaveLength(1); expect(submissions[0].to.toLowerCase()).toBe(implementation);
  expect(submissions[0].data).toBe(encodeFunctionData({ abi: walletAbi, functionName: 'createGrantFor', args: [alice, grantId, agent, recipient, 10000n, 1893456000n] }));
  await page.getByRole('button', { name: 'Revoke grant' }).click(); await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
});
test('rejects an agent connected in place of Alice and disables creation after an account change', async ({ page }) => {
  await fixture(page, { wrongAccount: true }); await page.goto('/'); await page.getByRole('button', { name: 'Connect MetaMask' }).click();
  await expect(page.getByRole('alert')).toContainText('Select Alice');
  await expect(page.getByRole('button', { name: 'Create and authorize grant' })).toBeDisabled();
});
test('invalidates owner authority on wallet account changes', async ({ page }) => {
  await fixture(page); await page.goto('/'); await page.getByRole('button', { name: 'Connect MetaMask' }).click();
  await page.evaluate(() => (window as any).walletTestSwitch());
  await expect(page.getByRole('button', { name: 'Create and authorize grant' })).toBeDisabled();
});
test('rejects excess precision and expired terms before requesting a wallet transaction', async ({ page }) => {
  const submissions = await fixture(page); await page.goto('/'); await page.getByRole('button', { name: 'Connect MetaMask' }).click(); await fillGrant(page);
  await page.getByLabel('Cumulative budget (USDT0)', { exact: true }).fill('0.0060001');
  await page.getByRole('button', { name: 'Create and authorize grant' }).click(); await expect(page.getByRole('alert')).toContainText('at most 6');
  await page.getByLabel('Cumulative budget (USDT0)', { exact: true }).fill('0.01'); await page.getByLabel('Expires (UTC)', { exact: true }).fill('2020-01-01T00:00:00Z');
  await page.getByRole('button', { name: 'Create and authorize grant' }).click(); await expect(page.getByRole('alert')).toContainText('future'); expect(submissions).toHaveLength(0);
});
test('retains the draft ID after MetaMask rejection and a reload', async ({ page }) => {
  await fixture(page, { reject: true }); await page.goto('/'); await page.getByRole('button', { name: 'Connect MetaMask' }).click(); await fillGrant(page);
  const id = await page.locator('.draft-id code').textContent();
  await page.getByRole('button', { name: 'Create and authorize grant' }).click(); await expect(page.getByRole('alert')).toContainText('rejected');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('rejected');
  await page.reload(); await expect(page.locator('.draft-id code')).toHaveText(id!); await expect(page.getByLabel('Allowed recipient', { exact: true })).toHaveValue(recipient);
});
test('keeps owner controls for migrated legacy Pending grants', async ({ page }) => {
  await fixture(page, { legacy: true }); await page.goto('/'); await page.getByRole('button', { name: 'Connect MetaMask' }).click();
  await page.getByRole('button', { name: 'Reject legacy grant' }).click(); await expect(page.getByText('Rejected', { exact: true })).toBeVisible();
});
test('requires the MetaMask-compatible v3 account', async ({ page }) => {
  await fixture(page, { oldVersion: true }); await page.goto('/'); await expect(page.getByRole('alert')).toContainText('previous grant flow');
  await expect(page.getByRole('button', { name: 'Create and authorize grant' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^activate|^enable/i })).toHaveCount(0);
});
test('fits a phone viewport and exposes only grant terms, with no private-key field', async ({ page }, testInfo) => {
  await fixture(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByLabel('Agent signer', { exact: true })).toHaveValue(agent);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('input[type=password]')).toHaveCount(0); await expect(page.locator('input')).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('prompts for gas after grant creation and confirms an exact native top-up without changing the budget', async ({ page }) => {
  const submissions = await fixture(page);
  await page.goto(`/?newGrant=${grantId}`);
  await page.getByRole('button', { name: 'Connect MetaMask' }).click(); await fillGrant(page);
  await page.getByRole('button', { name: 'Create and authorize grant' }).click();
  const gas = page.getByRole('region', { name: 'Agent gas funding' });
  await expect(gas.getByText('Gas funding needed', { exact: true })).toBeVisible();
  await expect(gas).toContainText('0 native USDT0');
  await expect(gas.getByLabel('Gas funding amount (USDT0)')).toHaveValue('0.001152');
  await gas.getByLabel('Gas funding amount (USDT0)').fill('0.01');
  await gas.getByRole('button', { name: 'Fund agent gas' }).click();
  await expect(page.getByRole('status')).toContainText('Agent gas funding confirmed onchain');
  await expect(gas.getByText('Enough for estimated payment gas', { exact: true })).toBeVisible();
  await expect(gas).toContainText('0.01 native USDT0');
  expect(submissions).toHaveLength(2);
  expect(submissions[1].to).toBe(agent);
  expect(BigInt(submissions[1].value!)).toBe(10n ** 16n);
  expect(submissions[1].data || '0x').toBe('0x');
  await expect(page.getByText('0.01 USDT0', { exact: true })).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Agent gas funding: confirmed');
  await expect(page.getByRole('region', { name: 'Agent gas funding' })).toContainText('0.01 native USDT0');
});
test('shows existing agent funding and refreshes after its gas is depleted', async ({ page }) => {
  await fixture(page, { active: true, agentBalance: 10n ** 16n }); await page.goto('/');
  const gas = page.getByRole('region', { name: 'Agent gas funding' });
  await expect(gas).toContainText('Enough for estimated payment gas');
  await expect(gas.getByRole('button', { name: 'Fund agent gas' })).toBeDisabled();
  await page.evaluate(() => (window as any).walletTestDrain());
  await gas.getByRole('button', { name: 'Check gas balance' }).click();
  await expect(gas).toContainText('Gas funding needed');
  await expect(gas).toContainText('0 native USDT0');
});
test('keeps the grant active when Alice rejects funding and rejects unsafe precision before signing', async ({ page }) => {
  const submissions = await fixture(page, { active: true, rejectFunding: true }); await page.goto('/');
  await page.getByRole('button', { name: 'Connect MetaMask' }).click();
  const gas = page.getByRole('region', { name: 'Agent gas funding' });
  await expect(gas.getByRole('button', { name: 'Fund agent gas' })).toBeEnabled();
  await gas.getByLabel('Gas funding amount (USDT0)').fill('0.0000001');
  await gas.getByRole('button', { name: 'Fund agent gas' }).click();
  await expect(gas.getByRole('alert')).toContainText('at most 6');
  await gas.getByLabel('Gas funding amount (USDT0)').fill('0.01');
  await gas.getByRole('button', { name: 'Fund agent gas' }).click();
  await expect(page.getByRole('alert')).toContainText('rejected');
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await expect(gas).toContainText('0 native USDT0');
  expect(submissions).toHaveLength(0);
});
test('reports reverted funding and allows a new explicit top-up', async ({ page }) => {
  await fixture(page, { active: true, revertFunding: true }); await page.goto('/');
  await page.getByRole('button', { name: 'Connect MetaMask' }).click();
  const gas = page.getByRole('region', { name: 'Agent gas funding' });
  await expect(gas.getByRole('button', { name: 'Fund agent gas' })).toBeEnabled();
  await gas.getByRole('button', { name: 'Fund agent gas' }).click();
  await expect(page.getByRole('alert')).toContainText('reverted');
  await expect(gas).toContainText('0 native USDT0');
  await expect(gas.getByRole('button', { name: 'Fund agent gas' })).toBeEnabled();
});
test('does not report sufficient gas when RPC estimation is unavailable', async ({ page }) => {
  await fixture(page, { active: true, agentBalance: 10n ** 16n, gasUnavailable: true }); await page.goto('/');
  const gas = page.getByRole('region', { name: 'Agent gas funding' });
  await expect(gas).toContainText('Gas status unavailable');
  await expect(gas).toContainText('0.01 native USDT0');
  await expect(gas.getByText('Enough for estimated payment gas', { exact: true })).toHaveCount(0);
});
test('blocks another top-up when the returned transaction does not match funding intent', async ({ page }) => {
  await fixture(page, { active: true, mismatchFunding: true }); await page.goto('/');
  await page.getByRole('button', { name: 'Connect MetaMask' }).click();
  const gas = page.getByRole('region', { name: 'Agent gas funding' });
  await expect(gas.getByRole('button', { name: 'Fund agent gas' })).toBeEnabled();
  await gas.getByRole('button', { name: 'Fund agent gas' }).click();
  await expect(page.getByRole('alert')).toContainText('does not match');
  await expect(gas.getByRole('button', { name: 'Fund agent gas' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Check funding confirmation' })).toBeVisible();
});
test('keeps the funding form within a phone viewport', async ({ page }, testInfo) => {
  await fixture(page, { active: true }); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('region', { name: 'Agent gas funding' })).toContainText('Gas funding needed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('gas-mobile.png'), fullPage: true });
});

test('retains a newer ambiguous funding operation across reload and verifies a recovered wallet hash', async ({ page }) => {
  const submissions = await fixture(page, { active: true, loseSecondFundingHash: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect MetaMask' }).click();
  const gas = page.getByRole('region', { name: 'Agent gas funding' });
  await gas.getByRole('textbox').fill('0.01');
  await gas.getByRole('button', { name: 'Fund agent gas' }).click();
  await expect(page.getByRole('status')).toContainText('confirmed');
  await gas.getByRole('textbox').fill('0.01');
  await gas.getByRole('button', { name: 'Fund agent gas' }).click();
  await expect(page.getByRole('alert')).toContainText('unknown');
  expect(submissions).toHaveLength(2);
  await page.reload();
  await page.getByRole('button', { name: 'Connect MetaMask' }).click();
  await expect(gas.getByRole('button', { name: 'Fund agent gas' })).toBeDisabled();
  await page.getByLabel('Funding transaction hash').fill(keccak256(toHex(2)));
  await page.getByRole('button', { name: 'Verify funding transaction' }).click();
  await expect(page.getByRole('status')).toContainText('confirmed');
  await expect(gas.getByRole('button', { name: 'Fund agent gas' })).toBeEnabled();
  expect(submissions).toHaveLength(2);
});
