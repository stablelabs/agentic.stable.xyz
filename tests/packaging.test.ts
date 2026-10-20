import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from 'viem';
import { tokenAbi, TOKEN } from '../shared/protocol.js';

const execute = promisify(execFile);
const root = resolve('.');
const owner = '0x1111111111111111111111111111111111111111';
const recipient = '0x3333333333333333333333333333333333333333';

it('installs the packed executable offline and pays from existing signer state outside the checkout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'standalone-agent-'));
  const state = join(directory, 'original signer');
  const prefix = join(directory, 'install prefix');
  const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`, npm_config_cache: join(directory, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false' };
  const rpcMethods: string[] = [];
  const rawTransactions: TransactionSerialized[] = [];
  let signer = '';
  let hash: Hex;
  const server = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      const call = JSON.parse(body);
      const result = await rpc(call.method, call.params ?? []);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }));
    } catch (error) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: String(error) } }));
    }
  });
  async function rpc(method: string, params: any[]) {
    rpcMethods.push(method);
    switch (method) {
      case 'eth_chainId': return '0x899';
      case 'eth_blockNumber': return '0x1';
      case 'eth_getBalance': return '0xde0b6b3a7640000';
      case 'eth_getTransactionCount': return '0x0';
      case 'eth_getBlockByNumber': return { number: '0x1', baseFeePerGas: '0x1', timestamp: '0x1', transactions: [] };
      case 'eth_estimateGas': return '0xc350';
      case 'eth_call': {
        const selector = params[0].data.slice(0, 10);
        if (selector === '0x313ce567') return encodeFunctionResult({ abi: tokenAbi, functionName: 'decimals', result: 6 });
        if (selector === '0x95d89b41') return encodeFunctionResult({ abi: tokenAbi, functionName: 'symbol', result: 'USDT0' });
        if (selector === '0x70a08231') return encodeFunctionResult({ abi: tokenAbi, functionName: 'balanceOf', result: 100_000n });
        if (selector === '0xdd62ed3e') return encodeFunctionResult({ abi: tokenAbi, functionName: 'allowance', result: 10_000n });
        if (selector === '0x23b872dd') return encodeFunctionResult({ abi: tokenAbi, functionName: 'transferFrom', result: true });
        throw new Error(`Unexpected token call ${selector}`);
      }
      case 'eth_sendRawTransaction': {
        rawTransactions.push(params[0]);
        hash = keccak256(params[0]);
        return hash;
      }
      case 'eth_getTransactionReceipt': return {
        transactionHash: hash, transactionIndex: '0x0', blockHash: `0x${'11'.repeat(32)}`, blockNumber: '0x1', from: signer, to: TOKEN,
        cumulativeGasUsed: '0xc350', gasUsed: '0xc350', effectiveGasPrice: '0x1', contractAddress: null, status: '0x1', type: '0x2',
        logsBloom: `0x${'00'.repeat(256)}`,
        logs: [{ address: TOKEN, topics: encodeEventTopics({ abi: tokenAbi, eventName: 'Transfer', args: { from: owner, to: recipient } }), data: encodeAbiParameters([{type: 'uint256'}], [1000n]), transactionHash: hash, transactionIndex: '0x0', blockHash: `0x${'11'.repeat(32)}`, blockNumber: '0x1', logIndex: '0x0', removed: false }],
      };
      case 'eth_getTransactionByHash': {
        const tx = parseTransaction(rawTransactions[0]);
        return { hash, from: signer, to: TOKEN, input: tx.data, value: '0x0', nonce: '0x0', gas: '0xea60', maxFeePerGas: '0x2', maxPriorityFeePerGas: '0x0', type: '0x2', chainId: '0x899', blockNumber: '0x1', blockHash: `0x${'11'.repeat(32)}`, transactionIndex: '0x0', r: tx.r, s: tx.s, v: '0x0' };
      }
      default: throw new Error(`Unexpected RPC method ${method}`);
    }
  }
  try {
    // The source runner creates state; the standalone executable must retain it.
    const source = JSON.parse((await execute(process.execPath, ['--import', 'tsx', 'agent/main.ts', 'init', '--state-dir', state, '--json'], {cwd: root, env})).stdout);
    signer = source.data.address;
    const packed = JSON.parse((await execute('npm', ['--silent', 'pack', './packages/cli', '--json', '--pack-destination', directory], { cwd: root, env })).stdout)[0];
    const files = packed.files.map((file: {path: string}) => file.path);
    expect(files).toEqual(expect.arrayContaining(['package.json', 'README.md', 'dist/main.js', 'dist/THIRD_PARTY_NOTICES.txt', 'docs/cli.md', 'docs/wallet.md', 'skills/agent-wallet-cli/SKILL.md', 'skills/agent-wallet-cli/references/configuration.md']));
    expect(files.every((file: string) => file === 'package.json' || file === 'README.md' || /^(dist|docs|skills)\//.test(file))).toBe(true);
    expect(files.some((file: string) => /agent-key|payment-0x|wallet-config|\.env|\.map$/.test(file))).toBe(false);
    await execute('npm', ['install', '--global', '--offline', '--ignore-scripts', '--prefix', prefix, join(directory, packed.filename)], {cwd: directory, env});
    const installed = join(prefix, 'lib/node_modules/@stablechain/agent-wallet-cli');
    const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
    expect(manifest.dependencies ?? {}).toEqual({});
    const bin = join(prefix, 'bin/agent-wallet');
    const run = async (...args: string[]) => JSON.parse((await execute(bin, [...args, '--state-dir', state, '--json'], { cwd: directory, env })).stdout);
    expect((await run('--version')).data).toBe(manifest.version);
    expect((await run('--help')).data).toContain('payments resume');
    expect((await run('init')).data).toMatchObject({retained: true, address: signer});
    expect((await run('whoami')).data).toMatchObject({address: signer, stateDir: state});

    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address() as { port: number };
    const config = join(directory, 'public-config.json');
    await writeFile(config, JSON.stringify({ schemaVersion: 2, chainId: 2201, token: TOKEN, alice: owner, rpcUrl: `http://127.0.0.1:${address.port}`, approvalUrl: 'https://agentic.stable.xyz' }));
    expect((await run('config', 'import', '--file', config)).data.alice).toBe(owner);
    expect((await run('doctor')).data.ready).toBe(true);
    const link = new URL((await run('allowance', 'link', '--amount', '0.01')).data.approvalUrl);
    expect(link.searchParams.get('agent')).toBe(signer);
    const payment = (await run('payments', 'prepare', '--recipient', recipient, '--amount', '0.001')).data;
    expect((await run('pay', '--payment-id', payment.paymentId, '--dry-run')).data).toMatchObject({status: 'simulated', signed: false, submitted: false});
    expect(rawTransactions).toHaveLength(0);
    expect((await run('pay', '--payment-id', payment.paymentId, '--no-wait')).data.status).toBe('submitted');
    expect(await recoverTransactionAddress({serializedTransaction: rawTransactions[0]})).toBe(signer);
    const signed = parseTransaction(rawTransactions[0]);
    expect(signed).toMatchObject({chainId: 2201, to: TOKEN.toLowerCase()});
    expect(signed.value ?? 0n).toBe(0n);
    expect(decodeFunctionData({abi: tokenAbi, data: signed.data!})).toEqual({functionName: 'transferFrom', args: [owner, recipient, 1000n]});
    expect((await run('payments', 'wait', payment.paymentId, '--timeout', '5s')).data).toMatchObject({status: 'confirmed', success: true, amountAtomic: '1000'});
    expect((await run('payments', 'resume', payment.paymentId, '--no-wait')).data.status).toBe('confirmed');
    expect(rawTransactions).toHaveLength(1);
    expect(rpcMethods).toContain('eth_sendRawTransaction');
    // Changing cwd does not create a second default signer beside the executable.
    await expect(readFile(join(installed, '.agent-wallet-erc20/agent-key.json'))).rejects.toMatchObject({code: 'ENOENT'});
    // A Unix executable bit and shebang must survive npm packing/linking.
    expect((await readFile(await realpath(bin), 'utf8')).startsWith('#!/usr/bin/env node\n')).toBe(true);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, {recursive: true, force: true});
  }
});
