#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { address, identifier, validateConfig, listGrants, readBalances, readGrant, parseAmount, fundingSuggestion, paymentGasReserve, duration, input, WalletError } from '@stablechain/agent-wallet-sdk/protocol';
import { AgentContext } from './agent/context.js';
import { grantLink, waitGrant } from './agent/grants.js';
import { listPayments, loadPayment, pay, paymentView, preparePayment, waitPayment } from './agent/payments.js';
import { publicError, render } from './output.js';

const help = `agent-wallet — Stable Testnet agent payments

  init                              Create or verify a private agent signer
  whoami                            Show the public agent address
  config import --file FILE         Import operator-provided public settings
  config show                       Show public settings
  status                            Account, balances and unresolved payments
  doctor                            Diagnose local state and account setup
  grants link --recipient ADDRESS --budget AMOUNT (--expires UTC | --expires-in 24h)
              [--agent ADDRESS] [--grant-id ID]
  grants list [--all-agents] [--status STATUS] [--limit 20] [--cursor CURSOR]
  grants show ID                    Grant terms and remaining budget
  grants wait ID [--timeout 300s]    Wait for exact saved authorization
  gas check --grant ID              Agent gas reserve and funding suggestion
  payments prepare --grant ID --recipient ADDRESS --amount AMOUNT [--payment-id ID]
  pay --payment-id ID [--grant ID --recipient ADDRESS --amount AMOUNT]
      [--dry-run | --no-wait] [--timeout 120s]
  payments list                     Local payment journals
  payments show ID                  Inspect without broadcasting
  payments wait ID [--timeout 120s]  Observe without broadcasting
  payments resume ID [--no-wait] [--timeout 120s]

Global: --json  --state-dir DIR  --help  --version
Alice authorizes grants and funds gas through the approval UI.
`;
const allowed: Record<string, string[]> = {
  init: [], whoami: [], status: [], doctor: [], 'config show': [], 'config import': ['file'],
  'grants link': ['recipient', 'budget', 'expires', 'expires-in', 'agent', 'grant-id'],
  'grants list': ['all-agents', 'status', 'limit', 'cursor'], 'grants show': [], 'grants wait': ['timeout'],
  'gas check': ['grant'], 'payments prepare': ['grant', 'recipient', 'amount', 'payment-id'],
  pay: ['grant', 'recipient', 'amount', 'payment-id', 'dry-run', 'no-wait', 'timeout'],
  'payments list': [], 'payments show': [], 'payments wait': ['timeout'], 'payments resume': ['no-wait', 'timeout'],
};
const globalFlags = ['json', 'state-dir', 'help', 'version'];
const booleans = new Set(['json', 'help', 'version', 'all-agents', 'dry-run', 'no-wait']);
let command = 'agent-wallet';
let asJson = process.argv.slice(2).includes('--json');
try {
  const names = [...new Set([...globalFlags, ...Object.values(allowed).flat()])];
  const parsed = input(() => parseArgs({ options: Object.fromEntries(names.map(name => [name, { type: booleans.has(name) ? 'boolean' as const : 'string' as const }])), allowPositionals: true, strict: true }));
  const opt = parsed.values;
  asJson = Boolean(opt.json);
  if (opt.help || opt.version || parsed.positionals.length === 0) {
    const data = opt.version
      ? JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
      : help;
    render(opt.version ? 'version' : 'help', data, asJson);
  } else {
    const positions = [...parsed.positionals];
    command = positions.shift()!;
    if (['config', 'grants', 'gas', 'payments'].includes(command)) command += ` ${positions.shift() || ''}`;
    if (!(command in allowed)) throw new WalletError('UNKNOWN_COMMAND', `Unknown command: ${command}. Use --help.`, 2);
    const positionalCount = ['grants show', 'grants wait', 'payments show', 'payments wait', 'payments resume'].includes(command) ? 1 : 0;
    if (positions.length !== positionalCount) throw new WalletError('INVALID_INPUT', positionalCount ? 'Supply exactly one full ID.' : 'Unexpected positional argument.', 2);
    for (const name of Object.keys(opt)) if (!globalFlags.includes(name) && !allowed[command].includes(name)) throw new WalletError('INVALID_INPUT', `--${name} is not supported by ${command}.`, 2);
    if (opt['dry-run'] && opt['no-wait']) throw new WalletError('INVALID_INPUT', '--dry-run and --no-wait cannot be combined.', 2);
    const value = (name: string) => typeof opt[name] === 'string' ? String(opt[name]) : undefined;
    const required = (name: string) => { const result = value(name); if (!result) throw new WalletError('INVALID_INPUT', `Missing --${name}.`, 2); return result; };
    // Reject syntax and scalar validation errors before creating private state.
    for (const name of ['grant', 'grant-id', 'payment-id']) if (opt[name]) input(() => identifier(required(name)));
    for (const name of ['recipient', 'agent']) if (opt[name]) input(() => address(required(name)));
    for (const name of ['amount', 'budget']) if (opt[name]) input(() => parseAmount(required(name)));
    if (positionalCount) input(() => identifier(positions[0]));
    if (command === 'payments prepare') for (const name of ['grant', 'recipient', 'amount']) required(name);
    if (command === 'grants link') {
      required('recipient'); required('budget');
      if (Boolean(opt.expires) === Boolean(opt['expires-in'])) throw new WalletError('INVALID_INPUT', 'Supply exactly one of --expires or --expires-in.', 2);
      if (opt['expires-in']) duration(required('expires-in'), 'expiry duration');
      if (opt.expires) input(() => {
        const expiry = required('expires');
        if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(expiry) || new Date(expiry).toISOString().replace('.000Z', 'Z') !== expiry) throw new Error('Expiry must be a valid UTC timestamp.');
      });
    }
    const ctx = new AgentContext(value('state-dir'));
    const timeout = opt.timeout ? duration(required('timeout'), 'timeout') : undefined;
    const paymentOptions = { paymentId: value('payment-id'), grant: value('grant'), recipient: value('recipient'), amount: value('amount') };
    let data: unknown;
    switch (command) {
      case 'init': data = await ctx.init(); break;
      case 'whoami': data = { address: await ctx.identity(), stateDir: ctx.state.directory }; break;
      case 'config show': data = await ctx.config(); break;
      case 'config import': {
        const text = await readFile(required('file'), 'utf8');
        let raw: unknown;
        try { raw = JSON.parse(text); }
        catch { throw new WalletError('INVALID_INPUT', 'Configuration must contain valid public wallet JSON.', 2); }
        const config = input(() => validateConfig(raw));
        data = await ctx.state.lock(async () => {
          if ((await ctx.state.files('payment-')).length && await ctx.state.has('config.json')) {
            const previous = await ctx.config();
            if (previous.alice !== config.alice || previous.implementation !== config.implementation || previous.implementationCodeHash !== config.implementationCodeHash || previous.rpcUrl !== config.rpcUrl) throw new WalletError('CONFIG_IN_USE', 'Payment records bind this directory to its account and RPC. Use a separate state directory.');
          }
          const { publicClient } = await import('@stablechain/agent-wallet-sdk/protocol');
          await ctx.verify(publicClient(config.rpcUrl), config);
          await ctx.state.write('config.json', config);
          return config;
        });
        break;
      }
      case 'doctor': {
        const checks: { name: string; ok: boolean; code?: string; message?: string }[] = [];
        for (const [name, check] of [
          ['agent', () => ctx.account()],
          ['payments', () => listPayments(ctx)],
          ['account', async () => { const { config, client } = await ctx.public(); await ctx.verify(client, config); }],
          ['lock', async () => { if (await ctx.state.has('command.lock')) throw new WalletError('STATE_LOCKED', 'A command lock exists. Verify its process before removing a stale lock.', 8); }],
        ] as const) {
          try { await check(); checks.push({ name, ok: true }); }
          catch (error) { const e = publicError(error); checks.push({ name, ok: false, code: e.code, message: e.message }); }
        }
        data = { checks, ready: checks.every(check => check.ok), stateDir: ctx.state.directory };
        break;
      }
      case 'status': {
        const payments = await listPayments(ctx);
        const identity = await ctx.state.has('agent-key.json') ? await ctx.identity() : undefined;
        if (!await ctx.state.has('config.json')) { data = { configured: false, agent: identity, stateDir: ctx.state.directory, payments }; break; }
        const { config, client } = await ctx.public(); await ctx.verify(client, config);
        data = { configured: true, verified: true, ...(await readBalances(client, config, identity)), unresolvedPayments: payments.filter(j => !['confirmed', 'reverted', 'rejected'].includes(j.status)), stateDir: ctx.state.directory };
        break;
      }
      case 'grants link': data = await grantLink(ctx, opt); break;
      case 'grants wait': data = await waitGrant(ctx, positions[0], timeout); break;
      case 'grants list': {
        const { config, client } = await ctx.public(); await ctx.verify(client, config);
        if (opt.status && !['unknown', 'pending', 'active', 'rejected', 'revoked', 'expired', 'exhausted'].includes(required('status').toLowerCase())) throw new WalletError('INVALID_INPUT', 'Unknown grant status.', 2);
        data = await listGrants(client, config, { agent: opt['all-agents'] ? undefined : await ctx.identity(), limit: opt.limit ? Number(required('limit')) : undefined, cursor: value('cursor'), status: value('status') });
        break;
      }
      case 'grants show': {
        const id = input(() => identifier(positions[0]));
        const { config, client } = await ctx.public(); await ctx.verify(client, config);
        const row = await readGrant(client, config, id);
        data = { ...row, matchesAgent: await ctx.state.has('agent-key.json') ? row.grant.agent === await ctx.identity() : false };
        break;
      }
      case 'gas check': {
        const id = input(() => identifier(required('grant')));
        const { config, client } = await ctx.public(); await ctx.verify(client, config);
        const row = await readGrant(client, config, id);
        const approval = new URL(config.approvalUrl); approval.searchParams.set('grant', id);
        const balance = await client.getBalance({ address: row.grant.agent });
        try {
          const reserve = await paymentGasReserve(client, config, id, row.grant);
          data = { agent: row.grant.agent, balance, reserve, suggestedTopUp: fundingSuggestion(balance, reserve), ready: balance >= reserve, available: true, decimals: 18, approvalUrl: approval.href };
        } catch { data = { agent: row.grant.agent, balance, ready: false, available: false, decimals: 18, approvalUrl: approval.href }; }
        break;
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
} catch (error) {
  const e = publicError(error);
  render(command, undefined, asJson, e);
  process.exitCode = e.exitCode;
}
