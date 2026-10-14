import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createWalletClient, encodeFunctionData, http, keccak256, parseAbi, toHex, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { chain, TOKEN, type WalletConfig } from '../client/config';
import { grant, publicClient, verifyAccount } from '../client/client';
import { walletAbi } from '../client/abi';

const execute = promisify(execFile);
const rpcUrl = 'http://127.0.0.1:18545';
const client = publicClient(rpcUrl);
const ownerKey = generatePrivateKey();
const owner = privateKeyToAccount(ownerKey);
const ownerWallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
const recipient = privateKeyToAccount(generatePrivateKey()).address;
const grantId = keccak256('0x01');
const paymentId = keccak256('0x02');
let dir: string, env: NodeJS.ProcessEnv, anvil: ChildProcess, config: WalletConfig;
let agent: ReturnType<typeof privateKeyToAccount>;
async function rpc(method: string, params: unknown[]) { return client.request({ method, params } as never); }
async function cli(script: string, flags: string[] = [], commandEnv = env) {
  return execute(process.execPath, ['--import', 'tsx', `agent-wallet/scripts/${script}.ts`, ...flags], { env: commandEnv, timeout: 45_000 });
}
async function ownerCreate(id: Hex, expiresAt = BigInt(Math.floor(Date.now() / 1000) + 86400), allowedAgent = agent.address, to = recipient) {
  const hash = await ownerWallet.sendTransaction({ to: config.implementation, data: encodeFunctionData({ abi: walletAbi, functionName: 'createGrantFor', args: [owner.address, id, allowedAgent, to, 10000n, expiresAt] }) });
  expect((await client.waitForTransactionReceipt({ hash })).status).toBe('success');
}
async function ownerRevoke(id: Hex) {
  const hash = await ownerWallet.sendTransaction({ to: config.implementation, data: encodeFunctionData({ abi: walletAbi, functionName: 'revokeGrantFor', args: [owner.address, id] }) });
  expect((await client.waitForTransactionReceipt({ hash })).status).toBe('success');
}
const payFlags = (amount: string, id: Hex = paymentId) => ['--grant', grantId, '--recipient', recipient, '--amount', amount, '--payment-id', id];

beforeAll(async () => {
  dir = await mkdtemp(resolve(tmpdir(), 'stable-agent-wallet-'));
  anvil = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', '18545', '--chain-id', '2201', '--hardfork', 'prague'], { stdio: 'ignore' });
  await new Promise<void>((ok, fail) => {
    let tries = 0; anvil.on('error', fail);
    const poll = async () => { try { await client.getChainId(); ok(); } catch { if (++tries > 100) fail(new Error('Anvil did not start.')); else setTimeout(poll, 100); } }; void poll();
  });
  const artifact = JSON.parse(await readFile('agent-wallet/out/AgentWallet.t.sol/MockToken.json', 'utf8'));
  await rpc('anvil_setCode', [TOKEN, artifact.deployedBytecode.object]);
  await rpc('anvil_setBalance', [owner.address, toHex(10n ** 19n)]);
  const hash = await ownerWallet.sendTransaction({ to: TOKEN, data: encodeFunctionData({ abi: parseAbi(['function mint(address,uint256)']), functionName: 'mint', args: [owner.address, 1_000_000n] }) });
  await client.waitForTransactionReceipt({ hash });
  const keyFile = resolve(dir, 'alice.env');
  await writeFile(keyFile, `ALICE_PRIVATE_KEY=${ownerKey}\nWALLET_RPC_URL=${rpcUrl}\nWALLET_APPROVAL_URL=http://localhost:5174\n`, { mode: 0o600 });
  env = { ...process.env, WALLET_STATE_DIR: resolve(dir, 'state'), WALLET_ALICE_ENV: keyFile, WALLET_PUBLIC_CONFIG_PATH: resolve(dir, 'public-config.json') };
});
afterAll(async () => { anvil?.kill('SIGTERM'); if (dir) await rm(dir, { recursive: true, force: true }); });

it('enables an existing EOA with v3 through a real type-4 transaction and is idempotent', async () => {
  expect(await client.getCode({ address: owner.address })).toBeUndefined();
  await cli('enable-account');
  config = JSON.parse(await readFile(resolve(dir, 'state/config.json'), 'utf8'));
  await verifyAccount(client, config);
  const activation = JSON.parse(await readFile(resolve(dir, 'state/activation-v3.json'), 'utf8'));
  expect((await client.getTransaction({ hash: activation.hash })).type).toBe('eip7702');
  const nonce = await client.getTransactionCount({ address: owner.address });
  await cli('enable-account');
  expect(await client.getTransactionCount({ address: owner.address })).toBe(nonce);
  expect(await readFile(resolve(dir, 'public-config.json'), 'utf8')).not.toContain(ownerKey);
});
it('creates the private agent key and reports its empty gas balance only when it tries a payment', async () => {
  await cli('init-agent');
  const file = resolve(dir, 'state/agent-key.json');
  const record = JSON.parse(await readFile(file, 'utf8')); agent = privateKeyToAccount(record.privateKey);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect((await stat(resolve(dir, 'state'))).mode & 0o777).toBe(0o700);
  const output = (await cli('init-agent')).stdout;
  expect(output).toContain(agent.address); expect(output).not.toContain(record.privateKey);
  expect(JSON.parse(await readFile(resolve(dir, 'public-config.json'), 'utf8')).defaultAgent).toBe(agent.address);
  const id = keccak256('0xaa'); await ownerCreate(id);
  try {
    await cli('pay', ['--grant', id, '--recipient', recipient, '--amount', '0.001']);
    throw new Error('Expected an unfunded agent to be rejected.');
  } catch (error) {
    expect((error as { stderr?: string }).stderr).toContain(`Gas payer ${agent.address} has 0 native USDT0`);
    expect(await client.getTransactionCount({ address: agent.address })).toBe(0);
  }
  await rpc('anvil_setBalance', [agent.address, toHex(10n ** 19n)]);
});
it('prepares a public grant form link without an agent transaction; Alice creates an Active grant', async () => {
  const expires = new Date(Date.now() + 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const before = await client.getTransactionCount({ address: agent.address });
  const result = await cli('grant-link', ['--recipient', recipient, '--budget', '0.01', '--expires', expires, '--grant-id', grantId]);
  expect(result.stdout).toContain(`newGrant=${grantId}`);
  expect(result.stdout).toContain('No transaction was signed or submitted');
  expect(await client.getTransactionCount({ address: agent.address })).toBe(before);
  await expect(cli('request-grant')).rejects.toThrow();
  await ownerCreate(grantId);
  const g = await grant(client, owner.address, grantId);
  expect(g.status).toBe(2); expect(g.budget).toBe(10000n); expect(g.agent).toBe(agent.address);
});
it('pays 0.006 from Alice after creation, without any further owner transaction', async () => {
  const nonce = await client.getTransactionCount({ address: owner.address });
  await cli('pay', payFlags('0.006'));
  const journal = JSON.parse(await readFile(resolve(dir, `state/payment-${paymentId}.json`), 'utf8'));
  expect(journal.status).toBe('confirmed'); expect(keccak256(journal.raw)).toBe(journal.hash);
  const transaction = await client.getTransaction({ hash: journal.hash });
  expect(transaction.from.toLowerCase()).toBe(agent.address.toLowerCase()); expect(transaction.to?.toLowerCase()).toBe(owner.address.toLowerCase());
  expect((await grant(client, owner.address, grantId)).spent).toBe(6000n);
  expect(await client.getTransactionCount({ address: owner.address })).toBe(nonce);
});
it('recovers a confirmed payment using the same ID without a second transaction', async () => {
  const nonce = await client.getTransactionCount({ address: agent.address });
  const file = resolve(dir, `state/payment-${paymentId}.json`);
  const record = JSON.parse(await readFile(file, 'utf8')); record.status = 'signed'; await writeFile(file, JSON.stringify(record), { mode: 0o600 });
  await cli('pay', payFlags('0.006'));
  expect(await client.getTransactionCount({ address: agent.address })).toBe(nonce);
  await expect(cli('pay', payFlags('0.004'))).rejects.toThrow();
});
it('rejects the second 0.006 and an onchain duplicate without moving Alice’s funds', async () => {
  const tokenAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
  const before = await client.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'balanceOf', args: [owner.address] });
  await expect(cli('pay', payFlags('0.006', keccak256('0x03')))).rejects.toThrow();
  const agentWallet = createWalletClient({ account: agent, chain, transport: http(rpcUrl) });
  const hash = await agentWallet.sendTransaction({ to: owner.address, gas: 300000n, data: encodeFunctionData({ abi: walletAbi, functionName: 'pay', args: [grantId, paymentId, recipient, 1000n] }) });
  expect((await client.waitForTransactionReceipt({ hash })).status).toBe('reverted');
  expect(await client.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'balanceOf', args: [owner.address] })).toBe(before);
  await cli('pay', payFlags('0.004', keccak256('0x04')));
  expect((await grant(client, owner.address, grantId)).spent).toBe(10000n);
});
it('fails closed when the RPC chain or implementation differs', async () => {
  await rpc('anvil_setChainId', [988]); await expect(verifyAccount(client, config)).rejects.toThrow('not Stable Testnet');
  await rpc('anvil_setChainId', [2201]); await expect(verifyAccount(client, { ...config, implementationCodeHash: keccak256('0x00') })).rejects.toThrow('bytecode differs');
});
it.each([1, 2])('upgrades an activated v%s account in place and preserves old spending and duplicate IDs', async version => {
  const key = generatePrivateKey(), alice = privateKeyToAccount(key);
  const wallet = createWalletClient({ account: alice, chain, transport: http(rpcUrl) });
  await rpc('anvil_setBalance', [alice.address, toHex(10n ** 19n)]);
  const artifact = JSON.parse(await readFile(`agent-wallet/out/AgentWalletV${version}.sol/AgentWalletV${version}.json`, 'utf8'));
  const deploy = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [TOKEN] });
  const implementation = (await client.waitForTransactionReceipt({ hash: deploy })).contractAddress!;
  const authorization = await wallet.signAuthorization({ contractAddress: implementation, executor: 'self' });
  await client.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to: alice.address, authorizationList: [authorization] }) });
  const mint = await wallet.sendTransaction({ to: TOKEN, data: encodeFunctionData({ abi: parseAbi(['function mint(address,uint256)']), functionName: 'mint', args: [alice.address, 10000n] }) });
  await client.waitForTransactionReceipt({ hash: mint });
  const id = keccak256('0x99'), payment = keccak256('0x98');
  const agentWallet = createWalletClient({ account: agent, chain, transport: http(rpcUrl) });
  if (version === 1) {
    await client.waitForTransactionReceipt({ hash: await agentWallet.writeContract({ address: alice.address, abi: artifact.abi, functionName: 'requestGrant', args: [id, recipient, 10000n, BigInt(Math.floor(Date.now() / 1000) + 86400)] }) });
    await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: alice.address, abi: artifact.abi, functionName: 'approveGrant', args: [id] }) });
  } else await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: alice.address, abi: artifact.abi, functionName: 'createGrant', args: [id, agent.address, recipient, 10000n, BigInt(Math.floor(Date.now() / 1000) + 86400)] }) });
  await client.waitForTransactionReceipt({ hash: await agentWallet.writeContract({ address: alice.address, abi: walletAbi, functionName: 'pay', args: [id, payment, recipient, 6000n] }) });
  const migration = resolve(dir, `migration-${version}`); await mkdir(migration, { mode: 0o700 });
  const previous = { ...config, alice: alice.address, implementation, implementationCodeHash: keccak256((await client.getCode({ address: implementation }))!) };
  await writeFile(resolve(migration, 'config.json'), JSON.stringify(previous), { mode: 0o600 });
  const keyFile = resolve(dir, `migration-${version}.env`); await writeFile(keyFile, `ALICE_PRIVATE_KEY=${key}\nWALLET_RPC_URL=${rpcUrl}\n`, { mode: 0o600 });
  const migrationEnv = { ...env, WALLET_STATE_DIR: migration, WALLET_ALICE_ENV: keyFile, WALLET_PUBLIC_CONFIG_PATH: resolve(dir, 'migration-public.json') };
  await expect(verifyAccount(client, previous)).rejects.toThrow('previous grant flow');
  await expect(cli('enable-account', [], migrationEnv)).rejects.toThrow();
  await cli('enable-account', ['--upgrade'], migrationEnv);
  const upgraded = JSON.parse(await readFile(resolve(migration, 'config.json'), 'utf8'));
  await verifyAccount(client, upgraded); expect(upgraded.alice).toBe(alice.address);
  expect((await grant(client, alice.address, id)).spent).toBe(6000n);
  expect(await client.readContract({ address: alice.address, abi: walletAbi, functionName: 'paymentUsed', args: [payment] })).toBe(true);
  const nonce = await client.getTransactionCount({ address: alice.address });
  await cli('enable-account', ['--upgrade'], migrationEnv);
  expect(await client.getTransactionCount({ address: alice.address })).toBe(nonce);
});
it('runs the owner-created live workflow, records receipt proofs, and resumes without duplicate payments', async () => {
  const mining = setInterval(() => { void rpc('evm_mine', []).catch(() => {}); }, 100);
  try {
    const balance = await client.getBalance({ address: agent.address });
    await rpc('anvil_setBalance', [agent.address, '0x0']);
    await cli('live-acceptance', ['--phase', 'prepare']);
    const path = resolve(dir, 'state/live-evidence.json'); let report = JSON.parse(await readFile(path, 'utf8'));
    expect(report.state).toBe('awaiting_owner');
    const before = await client.getTransactionCount({ address: agent.address });
    await cli('live-acceptance', ['--phase', 'exercise']);
    expect(await client.getTransactionCount({ address: agent.address })).toBe(before);
    await ownerCreate(report.grants.expiring, BigInt(report.expiresAt), agent.address, report.recipient);
    await ownerCreate(report.grants.main, BigInt(report.expiresAt) + 86400n, agent.address, report.recipient);
    await ownerCreate(report.grants.revoked, BigInt(report.expiresAt) + 86400n, agent.address, report.recipient);
    await ownerRevoke(report.grants.revoked);
    await rpc('anvil_setBalance', [agent.address, toHex(balance)]);
    await cli('live-acceptance', ['--phase', 'exercise']); report = JSON.parse(await readFile(path, 'utf8'));
    if (report.state === 'awaiting_expiry') { await rpc('evm_increaseTime', [301]); await rpc('evm_mine', []); await cli('live-acceptance', ['--phase', 'exercise']); report = JSON.parse(await readFile(path, 'utf8')); }
    expect(report.state).toBe('complete'); expect(report.steps).toHaveLength(17);
    expect(report.steps.every((s: any) => s.passed && BigInt(s.receipt.confirmations) >= 2n)).toBe(true);
    const failed = report.steps.filter((s: any) => s.receipt.status === 'reverted'); expect(failed).toHaveLength(8);
    for (const step of failed) expect(step.after).toEqual(step.before);
    const nonce = await client.getTransactionCount({ address: agent.address });
    await cli('live-acceptance', ['--phase', 'exercise']); await cli('live-acceptance', ['--phase', 'report']);
    expect(await client.getTransactionCount({ address: agent.address })).toBe(nonce);
    expect(await readFile(resolve(dir, 'state/live-evidence.md'), 'utf8')).not.toContain(ownerKey);
  } finally { clearInterval(mining); }
}, 120_000);
