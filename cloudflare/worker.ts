import { DurableObject } from 'cloudflare:workers';
import { handleAsNodeRequest } from 'cloudflare:node';
import { createServer } from 'node:http';
import { createApp } from '../server/app';
import { configFromEnv } from '../server/config';
import { Engine, type RunRecord, type SessionRecord } from '../server/engine';
import { StableChain } from '../server/payments/chain';
import { DurableLedger } from './store';

export class FundingLedger extends DurableObject<Env> {
  private engine: Engine;
  private port: number;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const values = Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    const config = configFromEnv('site', values);
    this.engine = new Engine(new DurableLedger(ctx.storage), new StableChain(config.rpc), config);
    const server = createServer(
      createApp(this.engine, false, {
        apiOnly: true,
        // The public Worker overwrites this header before crossing the private binding.
        clientIp: (req) => req.get('x-agentic-client-ip') || 'unknown',
        onWork: () => this.schedule(),
      }),
    );
    server.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Node HTTP adapter unavailable.');
    this.port = address.port;
    ctx.blockConcurrencyWhile(async () => {
      if (this.pending()) await this.schedule();
    });
  }
  private async schedule() {
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + 2000);
  }
  async handle(request: Request, clientIp: string) {
    const headers = new Headers(request.headers);
    headers.set('x-agentic-client-ip', clientIp);
    const response = await handleAsNodeRequest(this.port, new Request(request, { headers }));
    if (this.pending()) await this.schedule();
    await this.ctx.storage.sync();
    return response;
  }
  private pending() {
    return (
      this.engine.store.all<SessionRecord>('sessions').some((s) => !s.fundingDone) ||
      this.engine.store
        .all<RunRecord>('runs')
        .some((r) => !['completed', 'blocked', 'failed'].includes(r.view.status))
    );
  }
  async alarm() {
    if (!this.engine.config.enabled || !this.pending()) return;
    await this.ctx.storage.setAlarm(Date.now() + 10_000);
    await this.engine.tick();
    if (this.pending()) await this.ctx.storage.setAlarm(Date.now() + 2000);
    // Let the already scheduled wakeup expire naturally; deleting it can race new work.
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      // All mutable payment state is coordinated per funding wallet, not per visitor.
      return env.FUNDING_LEDGER.getByName('funding-wallet-v1').handle(
        request,
        request.headers.get('CF-Connecting-IP') || 'unknown',
      );
    }
    if (url.pathname.replace(/\/$/, '') === '/docs/source')
      return Response.redirect(env.REPOSITORY_URL, 302);
    const result = await env.ASSETS.fetch(request);
    const response = new Response(result.body, result);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'",
    );
    if (url.origin !== 'https://agentic.stable.xyz')
      response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    if (url.pathname === '/' && result.ok && url.origin === 'https://agentic.stable.xyz') {
      return new HTMLRewriter()
        .on('meta[name="robots"]', {
          element(element) {
            element.replace('<link rel="canonical" href="https://agentic.stable.xyz" />', {
              html: true,
            });
          },
        })
        .transform(response);
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
