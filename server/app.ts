import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { inputSchema } from '../shared/contracts';
import type { Engine } from './engine';
import { AppError, requireThat } from './errors';
import { sellerRoutes } from './seller/routes';
export function createApp(
  engine: Engine,
  standalone = false,
  options: {
    apiOnly?: boolean;
    clientIp?: (req: express.Request) => string;
    onWork?: () => Promise<void>;
  } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(compression());
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          upgradeInsecureRequests: engine.config.origin.startsWith('https:') ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: '8kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.locals.requestId = randomUUID();
    res.locals.clientIp = options.clientIp?.(req) || req.ip || 'unknown';
    engine.store.rate(`api:${res.locals.clientIp}`, 300, 60_000);
    if (req.method !== 'GET') {
      requireThat(req.is('application/json'), 'INVALID_REQUEST', 'JSON request required.', 400);
      if (req.path.startsWith('/agentic/') || req.headers.origin)
        requireThat(
          req.headers.origin === engine.config.origin,
          'FORBIDDEN_ORIGIN',
          'Request origin is not allowed.',
          403,
        );
    }
    next();
  });
  app.get('/api/health', async (_req, res) => {
    const chainVerified = await engine.readiness();
    const fundingReady = standalone ? null : chainVerified && (await engine.fundingReadiness());
    const ready = chainVerified && (standalone || fundingReady);
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'unavailable',
      database: 'ready',
      paymentsEnabled: engine.config.enabled,
      chainVerified,
      fundingReady,
    });
  });
  app.use(
    '/api/seller/v1',
    sellerRoutes(engine.seller, () => engine.readiness()),
  );
  const prefix = '/api/agentic/v1';
  if (!standalone) {
    app.get(`${prefix}/capabilities`, async (_req, res) => {
      await engine.readiness();
      res.json(engine.capabilities());
    });
    const token = (req: express.Request) =>
      req.headers.cookie
        ?.split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('agentic_session='))
        ?.slice('agentic_session='.length);
    const key = (req: express.Request) => z.string().uuid().parse(req.headers['idempotency-key']);
    app.post(`${prefix}/sessions`, async (req, res) => {
      z.object({}).strict().parse(req.body);
      const requestKey = key(req);
      let id: string | undefined;
      try {
        id = engine.authenticate(token(req));
      } catch {
        /* Recover provisioning with its original idempotency key. */
      }
      if (!id) {
        await engine.readiness();
        id = engine.createSession(requestKey, res.locals.clientIp);
      }
      engine.authenticate(engine.cookie(id));
      await options.onWork?.();
      const expires = engine.session(id).expiresAt;
      res.cookie('agentic_session', engine.cookie(id), {
        httpOnly: true,
        secure: engine.config.origin.startsWith('https:'),
        sameSite: 'lax',
        path: prefix,
        expires: new Date(expires),
      });
      res.status(201).json(engine.session(id));
    });
    app.use(prefix, (req, res, next) => {
      res.locals.sessionId = engine.authenticate(token(req));
      next();
    });
    app.get(`${prefix}/session`, (_req, res) => res.json(engine.session(res.locals.sessionId)));
    app.post(`${prefix}/quotes`, (req, res) => {
      inputSchema.parse(req.body);
      engine.store.rate(`quotes:${res.locals.sessionId}`, 30);
      res.status(201).json(engine.quote(res.locals.sessionId));
    });
    app.post(`${prefix}/runs`, async (req, res) => {
      const { quoteId } = z.object({ quoteId: z.string().uuid() }).strict().parse(req.body);
      const run = engine.start(res.locals.sessionId, quoteId, key(req));
      await options.onWork?.();
      res.status(202).json(run);
    });
    app.get(`${prefix}/runs/:id`, (req, res) =>
      res.json(engine.run(String(req.params.id), res.locals.sessionId)),
    );
    app.post(`${prefix}/runs/:id/resume`, async (req, res) => {
      z.object({}).strict().parse(req.body);
      const run = engine.resume(String(req.params.id), res.locals.sessionId, key(req));
      await options.onWork?.();
      res.status(202).json(run);
    });
    app.get(['/docs/source', '/docs/source/'], (_req, res, next) => {
      if (engine.config.repository) res.redirect(302, engine.config.repository);
      else next();
    });
    if (!options.apiOnly) {
      app.use('/docs', express.static(resolve('dist/docs')));
      app.use(express.static(resolve('dist'), { index: false }));
      app.get('/', (_req, res, next) => {
        try {
          let html = readFileSync(resolve('dist/index.html'), 'utf8');
          if (engine.config.origin === 'https://agentic.stable.xyz')
            html = html.replace(
              '<meta name="robots" content="noindex,nofollow" />',
              '<link rel="canonical" href="https://agentic.stable.xyz" />',
            );
          res.type('html').send(html);
        } catch {
          next();
        }
      });
    }
  }
  app.use('/api', (_req, res) =>
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Not found.', retryable: false },
      requestId: res.locals.requestId,
    }),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const e =
        error instanceof AppError
          ? error
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? new AppError('INVALID_REQUEST', 'Check the request fields.', 400)
            : new AppError(
                'SERVICE_UNAVAILABLE',
                'The service is temporarily unavailable.',
                503,
                true,
              );
      if (e.status === 429) res.set('Retry-After', String(e.retryAfterSeconds || 60));
      res.status(e.status).json({
        error: { code: e.code, message: e.message, retryable: e.retryable },
        requestId: res.locals.requestId || randomUUID(),
      });
    },
  );
  return app;
}
