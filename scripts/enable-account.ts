import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';
import { encodeDeployData, keccak256, type Hex } from 'viem';
import { walletAbi, CHAIN_ID, RPC, TOKEN, address, validateConfig, type WalletConfig, publicClient, verifyAccount, verifyImplementation, verifyNetwork } from 'agent-wallet-sdk/protocol';
import { aliceEnvPath, configPath, exists, keyAccount, publishConfig, readJson, root, run, saveJson, signer, stateDir, submit, type Journal } from './local';

await run(async () => {
  const upgrade = parseArgs({ options: { upgrade: { type: 'boolean' } }, strict: true }).values.upgrade;
  const info = await lstat(aliceEnvPath);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) throw new Error(`Alice key file must have mode 600: ${aliceEnvPath}`);
  const env = parse(await readFile(aliceEnvPath));
  const account = keyAccount(env.ALICE_PRIVATE_KEY);
  const rpcUrl = env.WALLET_RPC_URL || RPC;
  const approvalUrl = env.WALLET_APPROVAL_URL || 'http://localhost:5174';
  const client = publicClient(rpcUrl);
  await verifyNetwork(client);
  let previous: WalletConfig | undefined;
  if (await exists(configPath)) {
    previous = validateConfig(await readJson(configPath));
    if (previous.alice.toLowerCase() !== account.address.toLowerCase() || previous.rpcUrl !== rpcUrl) throw new Error('Saved configuration belongs to a different Alice or RPC. Use a separate WALLET_STATE_DIR.');
    await verifyImplementation(client, previous);
    let version = 1n;
    try { version = await client.readContract({ address: previous.implementation, abi: walletAbi, functionName: 'VERSION' }); } catch { /* v1 has no VERSION getter. */ }
    if (version === 3n) {
      await verifyAccount(client, previous);
      await publish(previous);
      console.log(`Alice is already enabled for owner-created grants: ${account.address}`);
      return;
    }
    if (!upgrade) throw new Error('Alice uses the previous grant flow. Run npm run wallet:enable -- --upgrade to deploy v3 and preserve existing grant storage.');
    if (![1n, 2n].includes(version)) throw new Error('Only known v1/v2-to-v3 migrations are supported.');
    const archive = resolve(stateDir, 'upgrade-v3-previous.json');
    if (!await exists(archive)) await saveJson(archive, previous);
  }
  const current = await client.getCode({ address: account.address });
  const targetPath = resolve(stateDir, 'enable-v3-target.json');
  let target: WalletConfig;
  const oldCode = previous ? `0xef0100${previous.implementation.slice(2)}`.toLowerCase() : '0x';
  if (await exists(targetPath)) {
    target = validateConfig(await readJson(targetPath));
    if (target.alice !== account.address || target.rpcUrl !== rpcUrl) throw new Error('Saved activation target belongs to a different Alice or RPC.');
    await verifyImplementation(client, target);
  } else {
    if ((current || '0x').toLowerCase() !== oldCode) throw new Error('Unexpected account code. Refusing to replace an unrelated delegation.');
    const artifact = JSON.parse(await readFile(resolve(root, 'packages/contracts/out/AgentWallet.sol/AgentWallet.json'), 'utf8'));
    const data = encodeDeployData({ abi: walletAbi, bytecode: artifact.bytecode.object as Hex, args: [TOKEN] });
    const path = resolve(stateDir, 'deployment-v3.json');
    const journal: Journal = await exists(path) ? await readJson(path) : { kind: 'deploy-v3', intent: { alice: account.address, dataHash: keccak256(data) }, status: 'created' };
    if (journal.intent.alice !== account.address || journal.intent.dataHash !== keccak256(data)) throw new Error('Deployment journal differs from this key or build. Retain the original build to recover.');
    await saveJson(path, journal);
    const result = await submit(client, account, path, journal, { data });
    const receipt = await client.getTransactionReceipt({ hash: result.hash });
    if (!receipt.contractAddress) throw new Error('Deployment receipt has no contract address.');
    const implementation = address(receipt.contractAddress);
    const code = await client.getCode({ address: implementation });
    if (!code || code === '0x') throw new Error('Implementation deployment has no code.');
    target = { chainId: CHAIN_ID, rpcUrl, token: TOKEN, alice: account.address, implementation, implementationCodeHash: keccak256(code), approvalUrl };
    await verifyImplementation(client, target);
    if (await client.readContract({ address: implementation, abi: walletAbi, functionName: 'VERSION' }) !== 3n) throw new Error('Build is not the owner-created-grant implementation.');
    await saveJson(targetPath, target);
  }
  const targetCode = `0xef0100${target.implementation.slice(2)}`.toLowerCase();
  const freshCode = (await client.getCode({ address: account.address }) || '0x').toLowerCase();
  if (freshCode !== oldCode && freshCode !== targetCode) throw new Error('Unexpected account code. Refusing to replace delegation.');
  const countBefore = previous ? await client.readContract({ address: account.address, abi: walletAbi, functionName: 'grantCount' }) : 0n;
  if (freshCode !== targetCode) {
    const path = resolve(stateDir, 'activation-v3.json');
    const journal: Journal = await exists(path) ? await readJson(path) : { kind: 'enable-v3', intent: { alice: account.address, implementation: target.implementation, previousImplementation: previous?.implementation || 'none' }, status: 'created' };
    if (journal.intent.alice !== account.address || journal.intent.implementation !== target.implementation) throw new Error('Activation journal differs from the saved target.');
    await saveJson(path, journal);
    const authorization = journal.raw ? undefined : await signer(account, rpcUrl).signAuthorization({ contractAddress: target.implementation, chainId: CHAIN_ID, executor: 'self' });
    await submit(client, account, path, journal, { to: account.address, data: '0x', ...(authorization ? { authorizationList: [authorization] } : {}) });
  }
  await verifyAccount(client, target);
  const countAfter = await client.readContract({ address: account.address, abi: walletAbi, functionName: 'grantCount' });
  if (countBefore !== countAfter) throw new Error('Grant count changed during activation. Stop and inspect the saved deployment.');
  await publish(target);
  console.log(`Enabled and verified v3 Alice: ${target.alice}\nImplementation: ${target.implementation}\nExisting grants preserved: ${countAfter}\nGrant app: ${target.approvalUrl}`);
  async function publish(config: WalletConfig) {
    const agentPath = resolve(stateDir, 'agent-key.json');
    if (await exists(agentPath)) config = { ...config, defaultAgent: address((await readJson<{ address: string }>(agentPath)).address) };
    await saveJson(configPath, config);
    await publishConfig(config);
  }
});
