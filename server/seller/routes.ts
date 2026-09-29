import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { verifyMessage, type Hex } from 'viem';
import { z } from 'zod';
import { inputSchema } from '../../shared/contracts';
import { digest } from '../crypto';
import { requireThat } from '../errors';
import type { Seller } from './seller';
type Challenge = { address: string; message: string; expires: number; used: boolean };
export function sellerRoutes(seller: Seller, available: () => Promise<boolean>) {
  const router = Router();
  router.get('/capabilities', async (_req, res) =>
    res.json({
      contractVersion: 'site-demo/v1',
      environment: 'testnet',
      available: await available(),
    }),
  );
  router.post('/challenge', (req, res) => {
    seller.store.rate(`challenge:${req.ip}`, 30);
    const { address } = z
      .object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) })
      .strict()
      .parse(req.body);
    const id = randomUUID();
    const expires = Date.now() + 300_000;
    const message = `Stable invoice extraction\nOrigin: ${seller.config.origin}\nChain: 2201\nAddress: ${address.toLowerCase()}\nNonce: ${id}\nExpires: ${new Date(expires).toISOString()}`;
    seller.store.put('challenges', id, {
      address,
      message,
      expires,
      used: false,
    } satisfies Challenge);
    res.json({ id, message });
  });
  router.post('/authenticate', async (req, res) => {
    seller.store.rate(`auth:${req.ip}`, 60);
    const { challengeId, signature } = z
      .object({
        challengeId: z.string().uuid(),
        signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
      })
      .strict()
      .parse(req.body);
    const challenge = seller.store.get<Challenge>('challenges', challengeId);
    requireThat(
      challenge && !challenge.used && challenge.expires > Date.now(),
      'UNAUTHORIZED',
      'Challenge expired or already used.',
      401,
    );
    requireThat(
      await verifyMessage({
        address: challenge.address as Hex,
        message: challenge.message,
        signature: signature as Hex,
      }),
      'UNAUTHORIZED',
      'Invalid wallet signature.',
      401,
    );
    const token = randomBytes(32).toString('hex');
    seller.store.atomic(() => {
      requireThat(
        !seller.store.get<Challenge>('challenges', challengeId)!.used,
        'UNAUTHORIZED',
        'Challenge already used.',
        401,
      );
      challenge.used = true;
      seller.store.put('challenges', challengeId, challenge);
      seller.store.put('seller-tokens', digest(token), {
        owner: challenge.address.toLowerCase(),
        expires: Date.now() + 30 * 60_000,
      });
    });
    res.json({ token });
  });
  router.use((req, res, next) => {
    const auth = seller.store.get<{ owner: string; expires: number }>(
      'seller-tokens',
      digest(req.headers.authorization?.replace(/^Bearer /, '') || ''),
    );
    requireThat(
      auth && auth.expires > Date.now(),
      'UNAUTHORIZED',
      'Authenticate with a fresh wallet challenge.',
      401,
    );
    res.locals.owner = auth.owner;
    next();
  });
  router.post('/quotes', async (req, res) => {
    inputSchema.parse(req.body);
    requireThat(
      await available(),
      'SERVICE_UNAVAILABLE',
      'Seller is temporarily unavailable.',
      503,
    );
    const owner = res.locals.owner as string;
    seller.store.rate(`quote:${owner}`, 30);
    const key = z.string().uuid().parse(req.headers['idempotency-key']);
    res
      .status(201)
      .json(
        seller.store.once(owner, 'seller/quotes', key, digest(req.body), () =>
          seller.quote(owner, owner),
        ),
      );
  });
  router.get('/orders/:id', (req, res) => {
    const o = seller.order(String(req.params.id), res.locals.owner);
    res.json({ quote: o.quote, receipt: o.receipt, result: o.result });
  });
  router.post('/orders/:id/redeem', async (req, res) => {
    const { txHash } = z
      .object({ txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/) })
      .strict()
      .parse(req.body);
    const owner = res.locals.owner as string;
    seller.store.rate(`redeem:${owner}`, 120);
    await seller.verify(String(req.params.id), owner, txHash as Hex);
    res.json(seller.deliver(String(req.params.id), owner));
  });
  return router;
}
