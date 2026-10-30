import { Hono } from 'hono';
import type { Hex } from 'viem';
import { RAILS, type Rail } from '@receipts/core';
import { UserError, followups, identity, notify, payouts, places, proofs, reviews, signSession, type Engine } from '@receipts/engine';
import { body, ok, rateLimit, requireSession, type Env } from '../http';

export function reviewerRoutes(e: Engine) {
  const app = new Hono<Env>();

  app.get('/me', async (c) => {
    const s = requireSession(c);
    const r = await identity.reviewerByWallet(e, s.sub);
    return ok(c, { wallet: s.sub, human: !!r, reviewer: r ? { id: r.id, level: r.level, reliability: r.reliability, idType: r.id_type, since: r.created_at } : null });
  });

  // One human ----------------------------------------------------------------------------------------------
  const sessionFor = async (wallet: string, reviewerId: string) => signSession({ sub: wallet.toLowerCase(), reviewerId }, e.env.SESSION_SECRET);

  app.post('/identity/anon-aadhaar', rateLimit('aadhaar', 10), async (c) => {
    const s = requireSession(c);
    const { pcd } = await body<{ pcd: string }>(c);
    const r = await identity.verifyAnonAadhaar(e, { pcd, wallet: s.sub });
    return ok(c, { verified: true, reviewerId: r.id, token: await sessionFor(s.sub, r.id), message: 'Verified unique human. Nothing about you left your phone.' });
  });

  app.post('/identity/mock', rateLimit('mock', 10), async (c) => {
    const s = requireSession(c);
    const r = await identity.mockHuman(e, s.sub);
    return ok(c, { verified: true, reviewerId: r.id, token: await sessionFor(s.sub, r.id), mock: true, message: 'Mock human for rehearsals (labelled).' });
  });

  app.get('/identity/status', async (c) => {
    const s = requireSession(c);
    const r = await identity.reviewerByWallet(e, s.sub);
    return ok(c, { human: !!r, reviewerId: r?.id ?? null, idType: r?.id_type ?? null, token: r ? await sessionFor(s.sub, r.id) : null });
  });

  // Proofs on any rail -------------------------------------------------------------------------------------
  app.post('/proofs/:rail', rateLimit('proofs', 30), async (c) => {
    const s = requireSession(c);
    const rail = c.req.param('rail') as Rail | 'simulated';
    const b = await body<Record<string, unknown>>(c);
    if (rail === 'simulated') return ok(c, await proofs.submitSimulated(e, s.sub, b as never));
    if (!RAILS.includes(rail)) throw new UserError(`unknown rail ${rail}`, 404);
    // Reclaim rails always start a request (the proof arrives at the callback); others start only when asked.
    if (rail === 'order_page' || rail === 'payment_proof' || b.start) {
      return ok(c, await proofs.startProof(e, s.sub, { rail, brandId: b.brandId as string | undefined, cityId: b.cityId as string | undefined }));
    }
    switch (rail) {
      case 'order_email':
        return ok(c, await proofs.submitEmail(e, s.sub, b as never));
      case 'merchant_receipt':
        return ok(c, await proofs.submitMerchantReceipt(e, s.sub, b as never));
      case 'onchain_payment':
        return ok(c, await proofs.submitOnchain(e, s.sub, b as never));
      case 'network_order':
        return ok(c, await proofs.submitOndc(e, s.sub, b as never));
      default:
        throw new UserError('Shop-through purchases arrive from the affiliate network automatically.', 400, 'not_submittable');
    }
  });

  app.get('/proofs/requests/:id', async (c) => ok(c, await proofs.proofRequestStatus(e, c.req.param('id'), requireSession(c).sub)));
  app.get('/purchases', async (c) => ok(c, await proofs.listPurchases(e, requireSession(c).sub)));
  // A UPI payment proves the payee, not the shop: the reviewer picks it on Google Maps.
  app.get('/purchases/:id/places', rateLimit('places', 30), async (c) =>
    ok(c, await places.placeCandidates(e, c.req.param('id'), requireSession(c).sub, c.req.query('q'))),
  );
  app.post('/purchases/:id/place', rateLimit('places', 30), async (c) => {
    const s = requireSession(c);
    const { placeId } = await body<{ placeId: string }>(c);
    await places.pinPlace(e, c.req.param('id'), s.sub, String(placeId ?? ''));
    return ok(c, await proofs.purchaseView(e, c.req.param('id')));
  });
  app.get('/purchases/:id', async (c) => {
    const s = requireSession(c);
    const p = await proofs.purchaseView(e, c.req.param('id'));
    const owner = await e.db.one<{ wallet: string }>('SELECT wallet FROM purchases WHERE id = $1', [p.id]);
    if (owner.wallet !== s.sub) throw new UserError('not found', 404);
    return ok(c, p);
  });
  // Which shop a UPI payment went to: Google Maps candidates, then the reviewer's pick (checked with Google).
  app.get('/purchases/:id/places', rateLimit('places', 30), async (c) => ok(c, await places.placeCandidates(e, c.req.param('id'), requireSession(c).sub, c.req.query('q'))));
  app.post('/purchases/:id/place', rateLimit('places', 30), async (c) => {
    const s = requireSession(c);
    const { placeId } = await body<{ placeId: string }>(c);
    await places.pinPlace(e, c.req.param('id'), s.sub, placeId);
    return ok(c, await proofs.purchaseView(e, c.req.param('id')));
  });

  // Reviews ------------------------------------------------------------------------------------------------
  app.post('/reviews', async (c) => {
    const s = requireSession(c);
    const b = await body<{ purchaseId: string; itemId?: Hex }>(c);
    return ok(c, await reviews.createDraft(e, s.sub, b));
  });
  app.get('/reviews/:draftId', async (c) => ok(c, await reviews.getDraft(e, requireSession(c).sub, c.req.param('draftId'))));

  /** The 15-second voice note: raw audio body (audio/webm, audio/mp4...) or multipart with a "file" field. */
  app.post('/reviews/:draftId/audio', rateLimit('audio', 20), async (c) => {
    const s = requireSession(c);
    const type = c.req.header('content-type') ?? '';
    let audio: Uint8Array;
    let mime = type.split(';')[0] || 'audio/webm';
    if (type.startsWith('multipart/')) {
      const form = await c.req.parseBody();
      const file = form.file;
      if (!(file instanceof File)) throw new UserError('Attach the recording as "file".', 400);
      audio = new Uint8Array(await file.arrayBuffer());
      mime = file.type || 'audio/webm';
    } else {
      audio = new Uint8Array(await c.req.arrayBuffer());
    }
    return ok(c, await reviews.addVoice(e, s.sub, c.req.param('draftId'), { audio, mime, languageHint: c.req.query('lang') ?? null }));
  });

  app.post('/reviews/:draftId/text', async (c) => {
    const s = requireSession(c);
    const b = await body<{ text: string; language?: string }>(c);
    return ok(c, await reviews.addText(e, s.sub, c.req.param('draftId'), b));
  });

  app.post('/reviews/:draftId/finalize', async (c) => {
    const s = requireSession(c);
    const b = await body<{ rating?: number; itemId?: Hex; claims?: string[] }>(c).catch(() => ({}));
    return ok(c, await reviews.finalizeDraft(e, s.sub, c.req.param('draftId'), b));
  });

  app.post('/reviews/:draftId/publish', async (c) => {
    const s = requireSession(c);
    const b = await body<{ signature: Hex }>(c);
    return ok(c, await reviews.publishDraft(e, s.sub, c.req.param('draftId'), b));
  });

  app.get('/me/reviews', async (c) => ok(c, await reviews.listMyReviews(e, requireSession(c).sub)));

  // Follow-ups ---------------------------------------------------------------------------------------------
  app.get('/followups', async (c) => ok(c, await followups.inbox(e, requireSession(c).sub)));
  app.post('/followups/:id', async (c) => {
    const s = requireSession(c);
    const b = await body<{ stillGood: boolean; newRating?: number; note?: string }>(c);
    return ok(c, await followups.prepareFollowup(e, s.sub, c.req.param('id'), b));
  });
  app.post('/followups/:id/answer', async (c) => {
    const s = requireSession(c);
    const b = await body<{ signature: Hex }>(c);
    return ok(c, await followups.answerFollowup(e, s.sub, c.req.param('id'), b));
  });

  // Money --------------------------------------------------------------------------------------------------
  app.get('/earnings', async (c) => ok(c, await payouts.earnings(e, requireSession(c).sub)));
  app.post('/payout-methods', async (c) => {
    const s = requireSession(c);
    return ok(c, await payouts.setPayoutMethod(e, s.sub, await body<{ kind: 'usdc' | 'upi'; address: string }>(c)));
  });
  app.post('/payouts/claim', async (c) => {
    const s = requireSession(c);
    const b = await body<{ to?: string; deadline?: string; signature?: Hex }>(c).catch(() => ({}));
    return ok(c, await payouts.relayClaim(e, s.sub, b));
  });
  app.post('/payouts/claim-to', async (c) => {
    const s = requireSession(c);
    const { to } = await body<{ to: string }>(c);
    return ok(c, await payouts.claimToTypedData(e, s.sub, to));
  });
  app.post('/payouts/inr', async (c) => ok(c, await payouts.withdrawInr(e, requireSession(c).sub)));

  // Notifications -------------------------------------------------------------------------------------------
  app.post('/push-targets', async (c) => {
    const s = requireSession(c);
    const r = await identity.requireHuman(e, s.sub);
    const b = await body<{ kind: 'expo' | 'webpush' | 'whatsapp' | 'email'; target: Record<string, unknown> }>(c);
    return ok(c, { id: await notify.addPushTarget(e, r.id, b.kind, b.target) });
  });

  return app;
}
