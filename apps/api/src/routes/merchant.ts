import { Hono } from 'hono';
import type { Hex } from 'viem';
import type { MerchantClaimMethod, MerchantReceipt } from '@receipts/core';
import { billing, merchants, type Engine } from '@receipts/engine';
import { body, ok, rateLimit, requireSession, type Env } from '../http';

// The merchant dashboard API. Claim, reply in public, learn, issue signed receipts. There is deliberately no route
// that deletes, hides, edits or re-ranks a review.

export function merchantRoutes(e: Engine) {
  const app = new Hono<Env>();

  app.get('/search', async (c) => ok(c, await merchants.searchListings(e, c.req.query('q') ?? '', c.req.query('city') ?? null, c.req.query('near') ?? null)));
  app.get('/mine', async (c) => ok(c, await merchants.accountsFor(e, requireSession(c).sub)));
  // Not on Receipts yet? Find the business on Google Maps and make its listing from there.
  app.get('/search/google', rateLimit('places', 30), async (c) =>
    ok(c, await merchants.searchGoogle(e, c.req.query('q') ?? '', { cityId: c.req.query('city') ?? null, near: c.req.query('near') ?? null })),
  );
  app.post('/from-google', rateLimit('places', 30), async (c) => {
    requireSession(c);
    const { placeId } = await body<{ placeId: string }>(c);
    return ok(c, await merchants.listingFromGoogle(e, String(placeId ?? '')));
  });

  app.post('/claim', async (c) => {
    const s = requireSession(c);
    return ok(c, await merchants.startClaim(e, s.sub, await body<{ merchantId: string; method: MerchantClaimMethod; domain?: string; gstin?: string }>(c)));
  });
  app.post('/claims/:id/check', async (c) => ok(c, await merchants.checkClaim(e, requireSession(c).sub, c.req.param('id'))));

  app.get('/:id/insights', async (c) => ok(c, await merchants.insights(e, requireSession(c).sub, c.req.param('id'))));

  app.post('/:id/replies', async (c) => {
    const s = requireSession(c);
    return ok(c, await merchants.prepareReply(e, s.sub, await body<{ reviewId: string; text: string }>(c)));
  });
  app.post('/replies/:replyId/publish', async (c) => {
    const s = requireSession(c);
    return ok(c, await merchants.publishReply(e, s.sub, c.req.param('replyId'), await body<{ signature: Hex }>(c)));
  });

  app.post('/:id/receipts', async (c) => {
    const s = requireSession(c);
    return ok(c, await merchants.recordReceipt(e, s.sub, await body<MerchantReceipt>(c)));
  });

  app.post('/flags', async (c) => {
    const s = requireSession(c);
    return ok(c, await merchants.flagReview(e, s.sub, await body<{ reviewId: string; reason: 'unlawful' | 'personal_data'; note?: string }>(c)));
  });

  app.post('/:id/billing/checkout', async (c) => {
    const s = requireSession(c);
    const mine = await merchants.accountsFor(e, s.sub);
    const account = mine.find((a) => a.merchant_id === c.req.param('id'));
    if (!account) return c.json({ error: 'not your listing' }, 403);
    const { email, name } = await body<{ email: string; name?: string }>(c);
    return ok(c, await billing.merchantCheckout(e, { accountId: account.id, email, name }));
  });

  return app;
}
