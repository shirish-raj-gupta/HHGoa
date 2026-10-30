import { Hono } from 'hono';
import { UserError, admin, anchorPending, billing, decideFlag, demo, followups, investigate, merchants, payouts, shop, syncGraph, trust, type Engine } from '@receipts/engine';
import { body, ok, requireAdmin, type Env } from '../http';

// Stage and operator controls. Protected by ADMIN_TOKEN (open on a local machine without one). Every action is
// logged to the event stream, and simulated data stays labelled.

export function adminRoutes(e: Engine) {
  const app = new Hono<Env>();

  // Answered before the guard, so a signed-out console can ask for the token without a failed request.
  app.get('/whoami', (c) => {
    let signedIn = true;
    try {
      requireAdmin(e, c);
    } catch {
      signedIn = false;
    }
    return ok(c, { ok: true, open: !e.env.ADMIN_TOKEN, signedIn });
  });

  app.use('*', async (c, next) => {
    requireAdmin(e, c);
    await next();
  });

  app.post('/trust', async (c) => ok(c, await trust.runTrust(e, { onChainLevels: true })));
  app.post('/graph-sync', async (c) => ok(c, (await syncGraph(e)) ?? { skipped: 'TigerGraph not configured' }));
  app.post('/epoch', async (c) => ok(c, await payouts.buildEpoch(e, { post: true })));
  // The stage's Settle now (DEMO_MODE only): every accrued balance goes into a USDC root at once instead of nightly,
  // labelled as a demo settlement.
  app.post('/settle-now', async (c) => {
    if (!e.env.DEMO_MODE) throw new UserError('Settle now is a demo control (DEMO_MODE).', 403, 'demo_only');
    return ok(c, { label: 'Demo settlement', ...(await payouts.buildEpoch(e, { post: true })) });
  });

  app.get('/flags', async (c) => ok(c, await e.db.query(`SELECT * FROM flags ORDER BY created_at DESC LIMIT 100`)));
  app.post('/flags/:id/investigate', async (c) => ok(c, await investigate(e, c.req.param('id'))));
  app.post('/flags/:id/decide', async (c) => {
    const { decision, by = 'admin' } = await body<{ decision: 'confirm' | 'clear'; by?: string }>(c);
    const res = await decideFlag(e, c.req.param('id'), decision, by);
    await trust.runTrust(e, { onChainLevels: true });
    return ok(c, res);
  });

  app.post('/attack', async (c) => ok(c, await demo.runAttack(e)));
  app.post('/attack/reset', async (c) => ok(c, await demo.resetAttack(e)));

  app.post('/claims/:id/approve', async (c) => ok(c, await merchants.approveClaim(e, c.req.param('id'), 'admin')));

  // The admin console (apps/admin) --------------------------------------------------------------------------
  app.get('/overview', async (c) => ok(c, await admin.overview(e)));
  app.get('/claims', async (c) => ok(c, await admin.claims(e, (c.req.query('status') as 'open' | 'verified' | 'failed') ?? 'open')));
  app.post('/claims/:id/reject', async (c) => ok(c, await admin.rejectClaim(e, c.req.param('id'), String((await body<{ note?: string }>(c)).note ?? ''))));
  app.get('/reviews/held', async (c) => ok(c, await admin.heldReviews(e)));
  app.post('/reviews/:id/release', async (c) => ok(c, await admin.releaseReview(e, c.req.param('id'))));
  app.post('/anchor', async (c) => ok(c, await anchorPending(e)));
  app.post('/shop/test-conversion', async (c) => {
    const b = await body<{ clickId: string; amountInr: number; status?: 'pending' | 'confirmed' | 'cancelled' }>(c);
    return ok(c, await shop.testConversion(e, b.clickId, b));
  });
  app.post('/followups/:id/fast-forward', async (c) => {
    const b = await body<{ stillGood: boolean; newRating?: number }>(c);
    await followups.fastForwardAnswer(e, c.req.param('id'), b);
    return ok(c, { ok: true, labelled: 'fast-forwarded for the demo' });
  });
  app.post('/api-keys', async (c) => {
    const b = await body<{ email?: string; label?: string; creditsUsd?: number }>(c);
    const key = await billing.createApiKey(e, b);
    if (b.creditsUsd) await e.db.query('UPDATE api_keys SET credits_usdc = $2 WHERE id = $1', [key.id, Math.round(b.creditsUsd * 1e6)]);
    return ok(c, key);
  });

  return app;
}
