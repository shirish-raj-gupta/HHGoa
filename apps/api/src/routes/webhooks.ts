import { Hono } from 'hono';
import type { AffiliateNetwork } from '@receipts/rails';
import { UserError, billing, identity, merchants, proofs, shop, type Engine } from '@receipts/engine';
import { ok, type Env } from '../http';

// Inbound calls from providers: Reclaim proof deliveries, the Self app, affiliate networks, Razorpay and Dodo.
// Each one is authenticated by its own proof, signature or shared secret.

export function webhookRoutes(e: Engine) {
  const app = new Hono<Env>();

  app.post('/v1/reclaim/callback', async (c) => {
    const request = c.req.query('request');
    if (!request) throw new UserError('missing request id', 400);
    const purchase = await proofs.handleReclaimCallback(e, request, await c.req.text());
    return ok(c, { ok: true, purchaseId: purchase.id });
  });

  /** The Self app posts the proof here. Self expects { status, result } in the response. */
  app.post('/v1/self/verify', async (c) => {
    try {
      const b = (await c.req.json()) as { attestationId: number; proof: unknown; publicSignals: unknown[]; userContextData: string };
      const r = await identity.verifySelf(e, b);
      return ok(c, { status: 'success', result: true, reviewerId: r.id });
    } catch (err) {
      return ok(c, { status: 'error', result: false, reason: err instanceof Error ? err.message : 'verification failed' }, 200);
    }
  });

  const postback = async (network: AffiliateNetwork, params: Record<string, string>, rawBody: string | undefined, headers: Record<string, string>) =>
    shop.handlePostback(e, network, { params, rawBody, headers });

  app.get('/v1/affiliate/postback/:network', async (c) => ok(c, await postback(c.req.param('network') as AffiliateNetwork, c.req.query(), undefined, c.req.header())));
  app.post('/v1/affiliate/postback/:network', async (c) => {
    const raw = await c.req.text();
    let params: Record<string, string> = c.req.query();
    const type = c.req.header('content-type') ?? '';
    if (type.includes('json')) params = { ...params, ...(JSON.parse(raw || '{}') as Record<string, string>) };
    else if (type.includes('form')) params = { ...params, ...Object.fromEntries(new URLSearchParams(raw)) };
    return ok(c, await postback(c.req.param('network') as AffiliateNetwork, params, raw, c.req.header()));
  });

  app.post('/v1/razorpay/webhook', async (c) => ok(c, await merchants.handleRazorpayWebhook(e, await c.req.text(), c.req.header('x-razorpay-signature'))));
  app.post('/v1/dodo/webhook', async (c) => ok(c, await billing.handleDodoWebhook(e, await c.req.text(), c.req.header())));

  return app;
}
