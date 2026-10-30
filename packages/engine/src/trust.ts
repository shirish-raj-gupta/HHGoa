import {
  TRUST_PARAMS,
  bayesianScore,
  capReviewerShare,
  durability,
  encodeReputation,
  recencyDecay,
  reliabilityByReviewer,
  reputationLevel,
  scoreAgainstFutureConsensus,
  type WeightedRating,
} from '@receipts/core';
import { CATEGORY_CONFIGS, getCategory } from '@receipts/categories';
import { getAddress, type Hex } from 'viem';
import type { Engine } from './context';
import { detectSignals, syncFlags } from './graph';

// Weight reviewers by how well they predicted reality. A review's weight is its author's track record x collusion
// penalty x recency; an item's score is a Bayesian average pulled toward its category mean until enough weight
// accumulates. A handful of new accounts cannot move it, and a bought five-star only gains weight if later honest
// buyers agree with it.

interface Row {
  id: string;
  reviewer_id: string;
  item_id: string;
  merchant_id: string;
  category_id: string;
  rating: number;
  tier: string;
  rail: string;
  created_at: Date;
  simulated: boolean;
}

export interface TrustReport {
  reviews: number;
  reviewers: number;
  items: number;
  merchants: number;
  newFlags: string[];
  levelChanges: number;
  ms: number;
}

export async function runTrust(e: Engine, opts: { onChainLevels?: boolean } = {}): Promise<TrustReport> {
  const t0 = Date.now();
  const newFlags = await syncFlags(e, await detectSignals(e));

  const rows = await e.db.query<Row>(
    `SELECT r.id, r.reviewer_id, r.item_id, r.merchant_id, r.category_id, r.rating, r.tier, r.rail, r.created_at, r.simulated
       FROM reviews r JOIN purchases p ON p.id = r.purchase_id
      WHERE r.status = 'active' AND p.status <> 'cancelled'`,
  );

  // Penalties from open or confirmed flags (cleared flags no longer count).
  const flags = await e.db.query<{ signal: string; reviewer_ids: string[]; merchant_id: string | null; penalty: number; status: string; evidence: { reviewIds?: string[] } }>(
    `SELECT signal, reviewer_ids, merchant_id, penalty, status, evidence FROM flags WHERE status IN ('open', 'confirmed')`,
  );

  // Track record against future consensus; reviewers flagged together cannot vouch for each other.
  const groupsOf = new Map<string, Set<number>>();
  flags.forEach((f, i) => {
    if (!['review_ring', 'shared_funder', 'seller_linked_payout', 'merchant_burst'].includes(f.signal)) return;
    for (const id of f.reviewer_ids) groupsOf.set(id, (groupsOf.get(id) ?? new Set()).add(i));
  });
  const dependent = (a: string, b: string) => {
    const ga = groupsOf.get(a);
    const gb = groupsOf.get(b);
    return !!ga && !!gb && [...ga].some((g) => gb.has(g));
  };
  const scored = scoreAgainstFutureConsensus(
    rows.map((r) => ({ reviewId: r.id, reviewerId: r.reviewer_id, itemId: r.item_id, rating: r.rating, createdAt: new Date(r.created_at).getTime() })),
    undefined,
    dependent,
  );
  const scoredById = new Map(scored.map((s) => [s.reviewId, s]));
  const rel = reliabilityByReviewer(scored);
  const reviewerPenalty = new Map<string, number>();
  const heldReviews = new Set<string>();
  const halfWeightReviews = new Set<string>();
  const ringConfirmed = new Set<string>();
  for (const f of flags) {
    if (f.signal === 'merchant_burst' || f.signal === 'cashback_farming') {
      for (const id of f.evidence.reviewIds ?? []) heldReviews.add(id);
      continue;
    }
    if (f.signal === 'selective_receipts') {
      for (const id of f.evidence.reviewIds ?? []) halfWeightReviews.add(id);
      continue;
    }
    for (const id of f.reviewer_ids) reviewerPenalty.set(id, Math.min(reviewerPenalty.get(id) ?? 1, Number(f.penalty)));
    if (f.signal === 'review_ring' && f.status === 'confirmed') for (const id of f.reviewer_ids) ringConfirmed.add(id);
  }

  const now = Date.now();
  const weights = new Map<string, number>();
  for (const r of rows) {
    const cat = getCategory(r.category_id);
    const R = rel.get(r.reviewer_id)?.reliability ?? TRUST_PARAMS.prior;
    const P = reviewerPenalty.get(r.reviewer_id) ?? 1;
    const held = heldReviews.has(r.id) && scoredById.get(r.id)?.accuracy == null;
    const ageDays = (now - new Date(r.created_at).getTime()) / 86_400_000;
    const tierFactor = r.tier === 'B' && cat.publish.level === 'item' ? TRUST_PARAMS.tierBItemFactor : 1;
    const w = held ? 0 : R * P * recencyDecay(ageDays, cat.decay_half_life_days) * tierFactor * (halfWeightReviews.has(r.id) ? 0.5 : 1);
    weights.set(r.id, Math.round(w * 10_000) / 10_000);
  }

  await e.db.tx(async (t) => {
    for (const r of rows) {
      const s = scoredById.get(r.id);
      await t.query('UPDATE reviews SET trust_weight = $2, consensus = $3, accuracy = $4 WHERE id = $1', [r.id, weights.get(r.id) ?? 0, s?.consensus ?? null, s?.accuracy ?? null]);
    }
    const reviewerIds = await t.query<{ id: string }>('SELECT id FROM reviewers');
    for (const { id } of reviewerIds) {
      const x = rel.get(id);
      await t.query('UPDATE reviewers SET reliability = $2, scored_reviews = $3, penalty = $4 WHERE id = $1', [
        id,
        x?.reliability ?? TRUST_PARAMS.prior,
        x?.n ?? 0,
        reviewerPenalty.get(id) ?? 1,
      ]);
    }
  });

  // Category means (the prior each item is pulled toward).
  const mu = new Map<string, number>();
  for (const c of CATEGORY_CONFIGS) {
    const rs = rows.filter((r) => r.category_id === c.category);
    mu.set(c.category, rs.length >= 5 ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : 3.8);
    await e.db.query('UPDATE categories SET category_mean = $2 WHERE id = $1', [c.category, mu.get(c.category)]);
  }

  // Follow-up durability per item.
  const fus = await e.db.query<{ item_id: string; kind: string; still_good: boolean }>(
    `SELECT r.item_id, f.kind, f.still_good FROM followups f JOIN reviews r ON r.id = f.review_id WHERE f.status = 'answered' AND f.still_good IS NOT NULL AND r.status = 'active'`,
  );
  const prices = await e.db.query<{ item_id: string; min: string | null; max: string | null }>(
    `SELECT x.item_id, min(x.price)::text AS min, max(x.price)::text AS max FROM (
       SELECT r.item_id, COALESCE((SELECT (it->>'priceMinor')::bigint FROM jsonb_array_elements(p.items) it WHERE it->>'itemId' = r.item_id LIMIT 1), p.amount_minor) AS price
         FROM reviews r JOIN purchases p ON p.id = r.purchase_id WHERE r.status = 'active') x
      WHERE x.price > 0 GROUP BY x.item_id`,
  );
  const priceOf = new Map(prices.map((p) => [p.item_id, p]));

  // Items.
  const byItem = new Map<string, Row[]>();
  for (const r of rows) byItem.set(r.item_id, [...(byItem.get(r.item_id) ?? []), r]);
  const allItems = await e.db.query<{ id: string; category_id: string }>('SELECT id, category_id FROM items');
  await e.db.tx(async (t) => {
    for (const item of allItems) {
      const list = byItem.get(item.id) ?? [];
      const cat = getCategory(item.category_id);
      const entries: WeightedRating[] = capReviewerShare(list.map((r) => ({ reviewId: r.id, reviewerId: r.reviewer_id, rating: r.rating, weight: weights.get(r.id) ?? 0 })));
      const { score, totalWeight } = bayesianScore(entries, mu.get(item.category_id) ?? 3.8);
      const itemFus = fus.filter((f) => f.item_id === item.id);
      const nextDay = itemFus.filter((f) => f.kind === '1d');
      const price = priceOf.get(item.id);
      await t.query(
        `UPDATE items SET score = $2, score_weight = $3, verified_reviews = $4, ranked = $5, durability = $6, still_good_next_day = $7,
           price_min_minor = COALESCE($8::bigint, price_min_minor), price_max_minor = COALESCE($9::bigint, price_max_minor), updated_at = now() WHERE id = $1`,
        [
          item.id,
          list.length ? Math.round(score * 1000) / 1000 : null,
          Math.round(totalWeight * 1000) / 1000,
          list.length,
          list.length >= cat.min_receipts_to_rank,
          durability(itemFus.map((f) => ({ stillGood: f.still_good }))),
          durability(nextDay.map((f) => ({ stillGood: f.still_good }))),
          price?.min ?? null,
          price?.max ?? null,
        ],
      );
    }
  });

  // Merchants: the same across all their items, with the per-reviewer cap applied across items.
  const byMerchant = new Map<string, Row[]>();
  for (const r of rows) byMerchant.set(r.merchant_id, [...(byMerchant.get(r.merchant_id) ?? []), r]);
  await e.db.tx(async (t) => {
    for (const [merchantId, list] of byMerchant) {
      const entries = capReviewerShare(list.map((r) => ({ reviewId: r.id, reviewerId: r.reviewer_id, rating: r.rating, weight: weights.get(r.id) ?? 0 })));
      const { score, totalWeight } = bayesianScore(entries, mu.get(list[0]!.category_id) ?? 3.8);
      const mFus = fus.filter((f) => list.some((r) => r.item_id === f.item_id));
      await t.query('UPDATE merchants SET score = $2, score_weight = $3, verified_reviews = $4, durability = $5 WHERE id = $1', [
        merchantId,
        Math.round(score * 1000) / 1000,
        Math.round(totalWeight * 1000) / 1000,
        list.length,
        durability(mFus.map((f) => ({ stillGood: f.still_good }))),
      ]);
    }
  });

  // Reputation levels.
  const counts = new Map<string, number>();
  for (const r of rows) if (!r.simulated) counts.set(r.reviewer_id, (counts.get(r.reviewer_id) ?? 0) + 1);
  const reviewers = await e.db.query<{ id: string; level: number; wallet: string; simulated: boolean; reliability: number }>('SELECT id, level, wallet, simulated, reliability FROM reviewers');
  let levelChanges = 0;
  for (const r of reviewers) {
    const n = r.simulated ? rows.filter((x) => x.reviewer_id === r.id).length : counts.get(r.id) ?? 0;
    const level = reputationLevel({ reliability: rel.get(r.id)?.reliability ?? r.reliability, reviews: n, ringConfirmed: ringConfirmed.has(r.id) });
    if (level === r.level) continue;
    levelChanges++;
    await e.db.query('UPDATE reviewers SET level = $2 WHERE id = $1', [r.id, level]);
    if (r.simulated || !opts.onChainLevels || !e.chain.canOperate) continue;
    const cred = await e.db.maybe('SELECT 1 FROM credentials WHERE reviewer_id = $1', [r.id]);
    if (!cred) continue;
    try {
      const tx = await e.chain.setReputationLevel(r.id as Hex, level);
      const { uid } = await e.chain.attestAsOperator(
        'reputation',
        encodeReputation({ reviewer: getAddress(r.wallet), level, reviews: n, reliabilityBps: Math.round((rel.get(r.id)?.reliability ?? 0.5) * 10_000) }),
        { recipient: getAddress(r.wallet) },
      );
      await e.db.query('UPDATE credentials SET level = $2, tx_hash = $3, eas_uid = $4, updated_at = now() WHERE reviewer_id = $1', [r.id, level, tx, uid]);
      await e.events.emit('reputation.level', { reviewerId: r.id, level, tx, uid });
    } catch (err) {
      e.log.warn('reputation level update on-chain failed', err);
    }
  }

  const report = { reviews: rows.length, reviewers: reviewers.length, items: allItems.length, merchants: byMerchant.size, newFlags, levelChanges, ms: Date.now() - t0 };
  await e.events.emit('trust.ran', report as unknown as Record<string, unknown>);
  return report;
}
