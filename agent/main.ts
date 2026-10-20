#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { address, identifier, validateConfig, readBalances, readAllowance, publicClient, parseAmount, fundingSuggestion, paymentGasReserve, duration, input, WalletError } from '../shared/protocol.js';
import { AgentContext } from './context.js';
import { listPayments, loadPayment, pay, paymentView, preparePayment, waitPayment } from './payments.js';
import { publicError, render } from './output.js';

const help = `agent-wallet — direct ERC-20 agent payments on Stable Testnet

  init                              Create or verify a private agent signer
  whoami                            Show the public agent address
  config import --file FILE         Import public owner/token settings (schema 2)
  config show                       Show public settings
  status                            Balances, allowance and unresolved payments
  doctor                            Diagnose local state and network
  allowance show                    Read this agent's remaining token allowance
  allowance link --amount AMOUNT    Generate the owner's approval-page link
  allowance wait --amount AMOUNT [--timeout 300s]
                                    Wait until allowance is at least AMOUNT
  gas check --recipient ADDRESS --amount AMOUNT
                                    Estimate gas for this transferFrom
  payments prepare --recipient ADDRESS --amount AMOUNT [--payment-id ID]
  pay --payment-id ID [--recipient ADDRESS --amount AMOUNT]
      [--dry-run | --no-wait] [--timeout 120s]
  payments list                     Local payment journals
  payments show ID                  Inspect without broadcasting
  payments wait ID [--timeout 120s]  Observe without broadcasting
  payments resume ID [--no-wait] [--timeout 120s]

Global: --json  --state-dir DIR  --help  --version
The owner approves the agent address on the token and funds its gas separately.
The agent can choose any recipient. Allowances have no automatic expiry.
Payment IDs are local recovery labels, not onchain duplicate protection.
`;
const allowed: Record<string, string[]> = {
  init: [], whoami: [], status: [], doctor: [], 'config show': [], 'config import': ['file'],
  'allowance show': [], 'allowance link': ['amount'], 'allowance wait': ['amount', 'timeout'],
  'gas check': ['recipient', 'amount'], 'payments prepare': ['recipient', 'amount', 'payment-id'],
  pay: ['recipient', 'amount', 'payment-id', 'dry-run', 'no-wait', 'timeout'],
  'payments list': [], 'payments show': [], 'payments wait': ['timeout'], 'payments resume': ['no-wait', 'timeout'],
};
const globalFlags = ['json', 'state-dir', 'help', 'version'];
const booleans = new Set(['json', 'help', 'version', 'dry-run', 'no-wait']);
let command = 'agent-wallet';
let asJson = process.argv.slice(2).includes('--json');
try {
  const names = [...new Set([...globalFlags, ...Object.values(allowed).flat()])];
  const parsed = input(() => parseArgs({ options: Object.fromEntries(names.map(name => [name, { type: booleans.has(name) ? 'boolean' as const : 'string' as const }])), allowPositionals: true, strict: true }));
  const opt = parsed.values; asJson = Boolean(opt.json);
  if (opt.help || opt.version || parsed.positionals.length === 0) {
    render(opt.version ? 'version' : 'help', opt.version ? JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version : help, asJson);
  } else {
    const positions = [...parsed.positionals]; command = positions.shift()!;
    if (['config', 'allowance', 'gas', 'payments'].includes(command)) command += ` ${positions.shift() || ''}`;
    if (!(command in allowed)) throw new WalletError('UNKNOWN_COMMAND', `Unknown command: ${command}. Use --help.`, 2);
    const positionalCount = ['payments show', 'payments wait', 'payments resume'].includes(command) ? 1 : 0;
    if (positions.length !== positionalCount) throw new WalletError('INVALID_INPUT', positionalCount ? 'Supply exactly one full ID.' : 'Unexpected positional argument.', 2);
    for (const name of Object.keys(opt)) if (!globalFlags.includes(name) && !allowed[command].includes(name)) throw new WalletError('INVALID_INPUT', `--${name} is not supported by ${command}.`, 2);
    if (opt['dry-run'] && opt['no-wait']) throw new WalletError('INVALID_INPUT', '--dry-run and --no-wait cannot be combined.', 2);
    const value = (name: string) => typeof opt[name] === 'string' ? String(opt[name]) : undefined;
    const required = (name: string) => { const result = value(name); if (!result) throw new WalletError('INVALID_INPUT', `Missing --${name}.`, 2); return result; };
    if (opt['payment-id']) input(() => identifier(required('payment-id')));
    if (opt.recipient) input(() => address(required('recipient')));
    if (opt.amount) input(() => parseAmount(required('amount')));
    if (positionalCount) input(() => identifier(positions[0]));
    if (['payments prepare', 'gas check'].includes(command)) { required('recipient'); required('amount'); }
    if (['allowance link', 'allowance wait'].includes(command)) required('amount');
    const timeout = opt.timeout ? duration(required('timeout'), 'timeout') : undefined;
    const ctx = new AgentContext(value('state-dir'));
    const paymentOptions = { paymentId: value('payment-id'), recipient: value('recipient'), amount: value('amount') };
    let data: unknown;
    switch (command) {
      case 'init': data = await ctx.init(); break;
      case 'whoami': data = { address: await ctx.identity(), stateDir: ctx.state.directory }; break;
      case 'config show': data = await ctx.config(); break;
      case 'config import': {
        let raw: unknown;
        try { raw = JSON.parse(await readFile(required('file'), 'utf8')); }
        catch { throw new WalletError('INVALID_INPUT', 'Configuration must contain valid public wallet JSON.', 2); }
        const config = input(() => validateConfig(raw));
        data = await ctx.state.lock(async () => {
          const files = await ctx.state.files('payment-');
          // Old journals require their matching CLI and must never be adopted as token payments.
          for (const file of files) if ((await ctx.state.read<{ schemaVersion?: number }>(file)).schemaVersion !== 2) throw new WalletError('LEGACY_PAYMENT_JOURNAL', 'Use a fresh state directory for token payments. Recover old records with their original CLI first.');
          if (files.length && await ctx.state.has('config.json')) {
            const previous = await ctx.config();
            if (previous.alice !== config.alice || previous.token !== config.token || previous.rpcUrl !== config.rpcUrl) throw new WalletError('CONFIG_IN_USE', 'Payment records bind this directory to its owner, token and RPC. Use a separate state directory.');
          }
          await ctx.verify(publicClient(config.rpcUrl), config); await ctx.state.write('config.json', config); return config;
        }); break;
      }
      case 'doctor': {
        const checks: { name: string; ok: boolean; code?: string; message?: string }[] = [];
        for (const [name, check] of [
          ['agent', () => ctx.account()], ['payments', () => listPayments(ctx)],
          ['network', async () => { const { config, client } = await ctx.public(); await ctx.verify(client, config); }],
          ['lock', async () => { if (await ctx.state.has('command.lock')) throw new WalletError('STATE_LOCKED', 'A command lock exists. Verify its process before removing a stale lock.', 8); }],
        ] as const) {
          try { await check(); checks.push({ name, ok: true }); }
          catch (error) { const e = publicError(error); checks.push({ name, ok: false, code: e.code, message: e.message }); }
        }
        data = { checks, ready: checks.every(check => check.ok), stateDir: ctx.state.directory }; break;
      }
      case 'status': {
        const payments = await listPayments(ctx);
        const agent = await ctx.state.has('agent-key.json') ? await ctx.identity() : undefined;
        if (!await ctx.state.has('config.json')) { data = { configured: false, agent, stateDir: ctx.state.directory, payments }; break; }
        const { config, client } = await ctx.public(); await ctx.verify(client, config);
        data = { configured: true, ...(await readBalances(client, config, agent)), allowance: agent ? await readAllowance(client, config, agent) : undefined, unresolvedPayments: payments.filter(j => !['confirmed', 'reverted', 'rejected'].includes(j.status)), stateDir: ctx.state.directory }; break;
      }
      case 'allowance show': {
        const { config, client } = await ctx.public(); await ctx.verify(client, config); const agent = await ctx.identity();
        data = { agent, owner: config.alice, token: config.token, amount: await readAllowance(client, config, agent), decimals: 6 }; break;
      }
      case 'allowance link': {
        const config = await ctx.config(), agent = await ctx.identity();
        const link = new URL(config.approvalUrl); link.searchParams.set('agent', agent); link.searchParams.set('amount', required('amount'));
        data = { agent, amount: required('amount'), approvalUrl: link.href }; break;
      }
      case 'allowance wait': {
        const { config, client } = await ctx.public(); await ctx.verify(client, config); const agent = await ctx.identity();
        const target = parseAmount(required('amount')); const end = Date.now() + (timeout ?? 300_000);
        while (true) {
          const allowance = await readAllowance(client, config, agent);
          if (allowance >= target) { data = { agent, allowance, status: 'available' }; break; }
          if (Date.now() >= end) throw new WalletError('ALLOWANCE_TIMEOUT', 'Allowance is below the requested amount. Recheck allowance; this is not proof that an approval transaction failed.', 5);
          await new Promise(resolve => setTimeout(resolve, Math.min(2000, end - Date.now())));
        } break;
      }
      case 'gas check': {
        const { config, client } = await ctx.public(); await ctx.verify(client, config); const agent = await ctx.identity();
        const balance = await client.getBalance({ address: agent });
        try {
          const reserve = await paymentGasReserve(client, config, agent, address(required('recipient')), parseAmount(required('amount')));
          data = { agent, balance, reserve, suggestedTopUp: fundingSuggestion(balance, reserve), ready: balance >= reserve, available: true, decimals: 18 };
        } catch { data = { agent, balance, ready: false, available: false, decimals: 18 }; } break;
      }
      case 'payments prepare': data = await preparePayment(ctx, paymentOptions); break;
      case 'pay': data = await pay(ctx, { ...paymentOptions, dryRun: Boolean(opt['dry-run']), noWait: Boolean(opt['no-wait']), timeout }); break;
      case 'payments list': data = await listPayments(ctx); break;
      case 'payments show': data = paymentView(await loadPayment(ctx, positions[0])); break;
      case 'payments wait': data = await waitPayment(ctx, positions[0], { timeout }); break;
      case 'payments resume': data = await pay(ctx, { paymentId: positions[0], noWait: Boolean(opt['no-wait']), timeout }); break;
    }
    render(command, data, asJson);
  }
} catch (error) { const e = publicError(error); render(command, undefined, asJson, e); process.exitCode = e.exitCode; }
