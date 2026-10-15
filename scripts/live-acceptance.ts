import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { BaseError, ContractFunctionRevertedError, decodeFunctionData, encodeFunctionData, formatUnits, parseEther, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { walletAbi, tokenAbi, EXPLORER, TOKEN, paymentCheck, publicClient, creationCheck, statusCheck, verifyAccount } from 'agent-wallet-sdk/protocol';
import { agentAccount, args, exists, loadConfig, newId, readJson, run, saveJson, stateDir, submit, type Journal } from './local';

type ReceiptEvidence = { hash: Hex; status: string; block: string; confirmations: string; fee: string; explorer: string; signer: Address };
type Snapshot = { aliceToken: string; aliceNative: string; recipientToken: string; spent: string; paymentUsed: boolean };
type Step = { name: string; passed: boolean; receipt: ReceiptEvidence; reason?: string; before?: Snapshot; after?: Snapshot };
type LiveRun = {
  version: 3; chainId: 2201; alice: Address; agent: Address; recipient: Address; wrongSigner: Address;
  implementation: Address; startedBlock: string; expiresAt: string;
  grants: Record<'main' | 'uncreated' | 'revoked' | 'expiring', Hex>;
  paymentIds: Record<string, Hex>; steps: Step[]; state: string;
};
const reportPath = resolve(stateDir, 'live-evidence.json');

await run(async () => {
  const phase = args(['phase']).phase || 'report';
  if (!['prepare', 'exercise', 'report'].includes(phase)) throw new Error('Use --phase prepare, exercise, or report.');
  const c = await loadConfig();
  const client = publicClient(c.rpcUrl);
  await verifyAccount(client, c);
  const agent = await agentAccount();
  let state: LiveRun;
  if (await exists(reportPath)) {
    state = await readJson<LiveRun>(reportPath);
    if (state.version !== 3) throw new Error('Previous-flow live evidence must be preserved in a separate state directory before starting the v3 run.');
    if (state.alice !== c.alice || state.agent !== agent.address || state.implementation !== c.implementation) throw new Error('Live evidence belongs to different accounts or implementation. Preserve it and use a separate state directory.');
  } else {
    if (phase !== 'prepare') throw new Error('Run --phase prepare first.');
    const recipient = await testAccount('live-recipient-key.json');
    const wrongSigner = await testAccount('live-wrong-signer-key.json');
    const block = await client.getBlock();
    state = { version: 3, chainId: 2201, alice: c.alice, agent: agent.address, recipient: recipient.address, wrongSigner: wrongSigner.address, implementation: c.implementation, startedBlock: String(block.number), expiresAt: String(block.timestamp + 300n), grants: { main: newId(), uncreated: newId(), revoked: newId(), expiring: newId() }, paymentIds: {}, steps: [], state: 'preparing' };
    await persist();
  }
  async function testAccount(file: string) {
    const path = resolve(stateDir, file);
    if (!await exists(path)) {
      const key = generatePrivateKey();
      await saveJson(path, { privateKey: key, address: privateKeyToAccount(key).address });
    }
    return privateKeyToAccount((await readJson<{ privateKey: Hex }>(path)).privateKey);
  }
  async function persist() {
    await saveJson(reportPath, state);
    const lines = [ '# Stable Testnet live acceptance', '', `State: **${state.state}** · chain **2201**`, '', `Alice: ${state.alice}`, '', `Agent / gas payer: ${state.agent}`, '', `Test recipient: ${state.recipient}`, '', '| Step | Result | Receipt | Block | Confirmations | Fee (USDT0) | Transaction |', '| --- | --- | --- | --- | --- | --- | --- |', ...state.steps.map(s => `| ${s.name}${s.reason ? ` (${s.reason})` : ''} | ${s.passed ? 'PASS' : 'FAIL'} | ${s.receipt.status} | ${s.receipt.block} | ${s.receipt.confirmations} | ${s.receipt.fee} | [${s.receipt.hash}](${s.receipt.explorer}) |`), '', 'Failed-payment steps compare Alice’s native and ERC-20 balances, the recipient balance, grant spending, and the payment-ID marker before and after. Revert reasons are separately verified by preflight simulation; receipts prove the included transactions reverted.', '', 'Owner transactions are checked for Alice as sender, the fixed implementation as destination, the exact grant action and ID, and the expected status event. A receipt alone does not prove which wallet UI was used; Chrome MetaMask interaction must also be observed.', '' ];
    await writeFile(resolve(stateDir, 'live-evidence.md'), lines.join('\n'), { mode: 0o600 });
  }
  async function evidence(hash: Hex, expected: 'success' | 'reverted'): Promise<ReceiptEvidence> {
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000, pollingInterval: 250 });
    if (receipt.status !== expected) throw new Error(`Unexpected receipt status ${receipt.status} for ${hash}; expected ${expected}.`);
    const tx = await client.getTransaction({ hash });
    const head = await client.getBlockNumber({ cacheTime: 0 });
    return { hash, status: receipt.status, block: String(receipt.blockNumber), confirmations: String(head - receipt.blockNumber + 1n), fee: formatUnits(receipt.gasUsed * receipt.effectiveGasPrice, 18), explorer: `${EXPLORER}/tx/${hash}`, signer: tx.from };
  }
  const done = (name: string) => state.steps.some(s => s.name === name && s.passed);
  async function record(step: Step) {
    state.steps.push(step); await persist();
    console.log(`${step.passed ? 'PASS' : 'FAIL'} ${step.name}: ${step.receipt.status}, block ${step.receipt.block}, ${step.receipt.confirmations} confirmations\n${step.receipt.explorer}`);
  }
  async function journal(name: string, intent: Record<string, string>): Promise<[string, Journal]> {
    const path = resolve(stateDir, `live-${name}.json`);
    const j: Journal = await exists(path) ? await readJson(path) : { kind: 'live-test', intent, status: 'created' };
    if (JSON.stringify(j.intent) !== JSON.stringify(intent)) throw new Error(`Live step ${name} has different saved terms.`);
    await saveJson(path, j); return [path, j];
  }
  async function snapshot(id: Hex, paymentId: Hex): Promise<Snapshot> {
    const block = await client.getBlockNumber({ cacheTime: 0 });
    const [aliceToken, aliceNative, recipientToken, g, paymentUsed] = await Promise.all([
      client.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'balanceOf', args: [c.alice], blockNumber: block }),
      client.getBalance({ address: c.alice, blockNumber: block }),
      client.readContract({ address: TOKEN, abi: tokenAbi, functionName: 'balanceOf', args: [state.recipient], blockNumber: block }),
      client.readContract({ address: c.alice, abi: walletAbi, functionName: 'getGrant', args: [id], blockNumber: block }),
      client.readContract({ address: c.alice, abi: walletAbi, functionName: 'paymentUsed', args: [paymentId], blockNumber: block }),
    ]);
    return { aliceToken: String(aliceToken), aliceNative: String(aliceNative), recipientToken: String(recipientToken), spent: String(g.spent), paymentUsed };
  }
  async function payment(name: string, grantId: Hex, amount: bigint, reason?: string, account = agent, recipient = state.recipient, reuseId?: Hex) {
    if (done(name)) return;
    const id = reuseId ?? (state.paymentIds[name] ||= newId());
    await persist();
    const [path, j] = await journal(name, { alice: c.alice, agent: account.address, grantId, paymentId: id, recipient, amount: String(amount) });
    const snapshotPath = resolve(stateDir, `live-${name}-before.json`);
    const before = await exists(snapshotPath) ? await readJson<Snapshot>(snapshotPath) : await snapshot(grantId, id);
    await saveJson(snapshotPath, before);
    if (reason && !j.raw) {
      let actual: string | undefined;
      try { await client.simulateContract({ account, address: c.alice, abi: walletAbi, functionName: 'pay', args: [grantId, id, recipient, amount] }); }
      catch (error) {
        if (error instanceof BaseError) {
          const reverted = error.walk(e => e instanceof ContractFunctionRevertedError);
          if (reverted instanceof ContractFunctionRevertedError) actual = reverted.data?.errorName;
        }
      }
      if (actual !== reason) throw new Error(`${name}: expected ${reason}, preflight returned ${actual || 'no matching revert'}.`);
    }
    const gas = 300_000n;
    const block = await client.getBlock();
    const maxFeePerGas = (block.baseFeePerGas ?? await client.getGasPrice()) * 2n;
    if (!j.raw && gas * maxFeePerGas > parseEther('0.01')) throw new Error('Live test gas cap exceeded (0.01 USDT0 per attempt).');
    try {
      await submit(client, account, path, j, { to: c.alice, gas, maxFeePerGas, data: encodeFunctionData({ abi: walletAbi, functionName: 'pay', args: [grantId, id, recipient, amount] }) }, reason ? undefined : paymentCheck(c.alice, grantId, id, recipient, amount));
    } catch (error) { if (!reason || j.status !== 'reverted') throw error; }
    const receipt = await evidence(j.confirmedHash ?? j.hash!, reason ? 'reverted' : 'success');
    const after = await snapshot(grantId, id);
    const passed = reason ? JSON.stringify(before) === JSON.stringify(after) : BigInt(after.spent) - BigInt(before.spent) === amount && BigInt(before.aliceToken) - BigInt(after.aliceToken) === amount && BigInt(after.recipientToken) - BigInt(before.recipientToken) === amount && after.paymentUsed;
    await record({ name, passed, receipt, before, after, ...(reason ? { reason } : {}) });
    if (!passed) throw new Error(`${name}: balance or accounting assertions failed. Stop and inspect live-evidence.json.`);
  }
  for (const name of ['deployment-v3', 'activation-v3']) {
    if (done(name)) continue;
    const path = resolve(stateDir, `${name}.json`);
    if (!await exists(path)) throw new Error(`Missing ${name} journal; run wallet:enable in this state directory.`);
    const j = await readJson<Journal>(path);
    await record({ name, passed: true, receipt: await evidence(j.confirmedHash ?? j.hash!, 'success') });
  }
  if (phase === 'prepare') {
    if (state.state === 'preparing') { state.state = 'awaiting_owner'; await persist(); }
    console.log('Alice creates and authorizes the expiring grant FIRST, then main and revoked, in Chrome MetaMask. Revoke the revoked grant after creating it.');
    for (const name of ['expiring', 'main', 'revoked'] as const) {
      const url = new URL(c.approvalUrl);
      for (const [key, value] of Object.entries({ newGrant: state.grants[name], agent: state.agent, recipient: state.recipient, budget: '0.01', expires: new Date(Number(name === 'expiring' ? state.expiresAt : BigInt(state.expiresAt) + 86400n) * 1000).toISOString().replace('.000Z', 'Z') })) url.searchParams.set(key, value);
      console.log(`${name}: ${url.href}`);
    }
    console.log(`Expiring grant deadline: ${new Date(Number(state.expiresAt) * 1000).toISOString()}`);
    console.log('Preparation is local only. The agent has not submitted grant transactions.');
  } else if (phase === 'exercise') {
    for (const name of ['main', 'revoked', 'expiring'] as const) {
      const label = `owner-create-${name}`;
      if (done(label)) continue;
      const events = await client.getContractEvents({ address: c.alice, abi: walletAbi, eventName: 'GrantCreated', args: { grantId: state.grants[name] }, fromBlock: BigInt(state.startedBlock), toBlock: 'latest' });
      const event = events[0];
      if (!event?.transactionHash) { console.log(`Awaiting MetaMask grant creation: ${name}. No agent tests submitted.`); return; }
      const tx = await client.getTransaction({ hash: event.transactionHash });
      const decoded = decodeFunctionData({ abi: walletAbi, data: tx.input });
      if (tx.from.toLowerCase() !== c.alice.toLowerCase() || tx.to?.toLowerCase() !== c.implementation.toLowerCase() || decoded.functionName !== 'createGrantFor' || decoded.args?.[0]?.toLowerCase() !== c.alice.toLowerCase() || decoded.args?.[1] !== state.grants[name]) throw new Error('Owner creation transaction does not match the expected signer, account, and grant.');
      const receipt = await evidence(event.transactionHash, 'success');
      const expiresAt = name === 'expiring' ? BigInt(state.expiresAt) : BigInt(state.expiresAt) + 86400n;
      creationCheck(c.alice, state.grants[name], state.agent, state.recipient, 10000n, expiresAt)(await client.getTransactionReceipt({ hash: receipt.hash }));
      await record({ name: label, passed: true, receipt });
    }
    if (!done('owner-revoke')) {
      const events = await client.getContractEvents({ address: c.alice, abi: walletAbi, eventName: 'GrantStatusChanged', args: { grantId: state.grants.revoked }, fromBlock: BigInt(state.startedBlock), toBlock: 'latest' });
      const event = events.find(e => e.args.status === 4);
      if (!event?.transactionHash) { console.log('Awaiting MetaMask revocation of the revoked test grant. No agent tests submitted.'); return; }
      const tx = await client.getTransaction({ hash: event.transactionHash });
      const decoded = decodeFunctionData({ abi: walletAbi, data: tx.input });
      if (tx.from.toLowerCase() !== c.alice.toLowerCase() || tx.to?.toLowerCase() !== c.implementation.toLowerCase() || decoded.functionName !== 'revokeGrantFor' || decoded.args?.[0]?.toLowerCase() !== c.alice.toLowerCase() || decoded.args?.[1] !== state.grants.revoked) throw new Error('Revocation transaction does not match the owner and grant.');
      const receipt = await evidence(event.transactionHash, 'success');
      statusCheck(c.alice, state.grants.revoked, 4)(await client.getTransactionReceipt({ hash: receipt.hash }));
      await record({ name: 'owner-revoke', passed: true, receipt });
    }
    const wrong = await testAccount('live-wrong-signer-key.json');
    if (!done('wrong-signer-gas-funding')) {
      const value = parseEther('0.01');
      const [path, j] = await journal('wrong-signer-gas-funding', { to: wrong.address, value: String(value) });
      await submit(client, agent, path, j, { to: wrong.address, value });
      await record({ name: 'wrong-signer-gas-funding', passed: true, receipt: await evidence(j.confirmedHash ?? j.hash!, 'success') });
    }
    await payment('uncreated-grant', state.grants.uncreated, 6000n, 'InvalidStatus');
    await payment('first-0.006', state.grants.main, 6000n);
    await payment('over-budget-0.006', state.grants.main, 6000n, 'BudgetExceeded');
    await payment('wrong-signer', state.grants.main, 1000n, 'WrongSigner', wrong);
    await payment('wrong-recipient', state.grants.main, 1000n, 'WrongRecipient', agent, wrong.address);
    await payment('duplicate-payment', state.grants.main, 1000n, 'DuplicatePayment', agent, state.recipient, state.paymentIds['first-0.006']);
    await payment('revoked-payment', state.grants.revoked, 1000n, 'InvalidStatus');
    await payment('remaining-0.004', state.grants.main, 4000n);
    await payment('exhausted-payment', state.grants.main, 1n, 'BudgetExceeded');
    if ((await client.getBlock()).timestamp < BigInt(state.expiresAt)) {
      state.state = 'awaiting_expiry'; await persist();
      console.log(`Remaining check: expiry at ${new Date(Number(state.expiresAt) * 1000).toISOString()}. Rerun exercise after that time.`); return;
    }
    await payment('expired-payment', state.grants.expiring, 1000n, 'Expired');
    state.state = 'complete'; await persist();
    console.log('Live onchain acceptance COMPLETE. Confirm Chrome MetaMask observations separately.');
  }
  // Refresh observed confirmations in the saved report without resubmitting transactions.
  for (const step of state.steps) step.receipt = await evidence(step.receipt.hash, step.receipt.status as 'success' | 'reverted');
  await persist();
  console.log(`Evidence: ${reportPath}\nReadable report: ${resolve(stateDir, 'live-evidence.md')}`);
});
