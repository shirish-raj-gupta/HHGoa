import { RECLAIM_PROVIDERS } from '@receipts/brands';
import { UserError, type Engine } from './context';

// The operator's queues for the admin console: business claims a person must decide, reviews held for moderation,
// trust flags, attestations waiting to anchor. Every decision is logged on the event stream. There is still no way to
// edit, re-rank or hide a review here; a held review can only be released (or stays held), and flags go through
// decideFlag as before.

export async function overview(e: Engine) {
  const n = async (sql: string) => Number((await e.db.one<{ n: string }>(sql)).n);
  const [claims, held, flags, anchors, businesses, reviews] = await Promise.all([
    n(`SELECT count(*)::text AS n FROM merchant_claims WHERE status = 'open'`),
    n(`SELECT count(*)::text AS n FROM reviews WHERE status = 'held'`),
    n(`SELECT count(*)::text AS n FROM flags WHERE status = 'open'`),
    n(`SELECT count(*)::text AS n FROM reviews WHERE eas_uid IS NULL AND anchor IS NOT NULL`),
    n(`SELECT count(*)::text AS n FROM merchant_accounts`),
    n(`SELECT count(*)::text AS n FROM reviews WHERE status = 'active' AND NOT simulated`),
  ]);
  return {
    queues: { claims, held, flags, anchors },
    totals: { businesses, reviews, providers: RECLAIM_PROVIDERS.length },
    chain: { mode: e.chain.mode, anchoring: e.chain.enabled },
    keys: {
      reclaim: !!(e.env.RECLAIM_APP_ID && e.env.RECLAIM_APP_SECRET),
      google: !!e.env.GOOGLE_MAPS_API_KEY,
      llm: e.llm.provider,
      adminToken: !!e.env.ADMIN_TOKEN,
    },
  };
}

/** Business claims, newest first: the listing, who claims it, how, and what they sent. */
export async function claims(e: Engine, status: 'open' | 'verified' | 'failed' = 'open') {
  return e.db.query(
    `SELECT c.id, c.method, c.wallet, c.status, c.challenge, c.evidence, c.created_at,
            m.id AS merchant_id, m.name AS merchant, m.address, m.city_id, m.maps_url, m.claimed_by IS NOT NULL AS claimed
       FROM merchant_claims c JOIN merchants m ON m.id = c.merchant_id
      WHERE c.status = $1 ORDER BY c.created_at DESC LIMIT 100`,
    [status],
  );
}

export async function rejectClaim(e: Engine, claimId: string, note: string) {
  const c = await e.db.maybe<{ status: string }>('SELECT status FROM merchant_claims WHERE id = $1', [claimId]);
  if (!c) throw new UserError('claim not found', 404);
  if (c.status !== 'open') throw new UserError(`This claim is already ${c.status}.`, 409);
  await e.db.query(`UPDATE merchant_claims SET status = 'failed', evidence = COALESCE(evidence, '{}'::jsonb) || $2 WHERE id = $1`, [claimId, { rejected: note.slice(0, 300) || 'rejected by admin' }]);
  await e.events.emit('merchant.claim_rejected', { claimId });
  return { claimId, status: 'failed' };
}

/** Reviews held for a person to look at (a fake-product claim or a personal allegation, by category rules). */
export async function heldReviews(e: Engine) {
  return e.db.query(
    `SELECT r.id, r.rating, r.claims, r.summary_en, r.created_at, r.simulated, i.canonical_name AS item, m.name AS merchant
       FROM reviews r JOIN items i ON i.id = r.item_id JOIN merchants m ON m.id = r.merchant_id
      WHERE r.status = 'held' ORDER BY r.created_at DESC LIMIT 100`,
  );
}

/** Release a held review: it goes live as written. (Keeping it held needs no action.) */
export async function releaseReview(e: Engine, reviewId: string) {
  const r = await e.db.maybe<{ status: string; reviewer_id: string; item_id: string }>('SELECT status, reviewer_id, item_id FROM reviews WHERE id = $1', [reviewId]);
  if (!r) throw new UserError('review not found', 404);
  if (r.status !== 'held') throw new UserError(`This review is ${r.status}, not held.`, 409);
  await e.db.tx(async (t) => {
    await t.query(`UPDATE reviews SET status = 'superseded' WHERE reviewer_id = $1 AND item_id = $2 AND status = 'active'`, [r.reviewer_id, r.item_id]);
    await t.query(`UPDATE reviews SET status = 'active' WHERE id = $1`, [reviewId]);
  });
  await e.events.emit('review.released', { reviewId });
  return { reviewId, status: 'active' };
}
