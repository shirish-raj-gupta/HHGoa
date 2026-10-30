// Trust engine math. A review's weight is its author's track record times a collusion penalty times recency;
// an item's score is a Bayesian average of weighted ratings. Starting values to tune, not facts.

export const TRUST_PARAMS = {
  /** p: a newcomer's reliability. */
  prior: 0.5,
  /** alpha: how many reviews' worth of evidence the prior is worth. */
  alpha: 5,
  /** C: pseudo-weight pulling an item toward its category mean. */
  C: 5,
  /** A review is scored only once this many later verified reviews from other people exist. */
  minLaterReviews: 3,
  /** No single reviewer above this share of (C + total weight) for one item or merchant. */
  maxReviewerShare: 0.15,
  /** An item needs this many verified reviews before it is ranked at all. */
  minReviewsToRank: 3,
  /** Tier B (payment-only) proofs carry item-level claims at half weight. */
  tierBItemFactor: 0.5,
} as const;

/** Effect of each collusion signal on the penalty P (1 = clean, 0 = excluded). */
export const SIGNAL_PENALTY: Record<string, number> = {
  review_ring: 0.2,
  shared_funder: 0.5,
  seller_linked_payout: 0,
  merchant_burst: 0, // hold until consensus forms
  cashback_farming: 0, // hold until consensus forms
  copy_paste_text: 1, // flag for human review only
  selective_receipts: 0.5, // applied to that merchant's QR receipts
  tier_b_only: 1, // handled by tierBItemFactor
};

/** a = 1 when the reviewer matched the future consensus exactly, 0 when 4 stars off. */
export function accuracy(rating: number, consensus: number): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(rating - consensus) / 4));
}

/** R = (alpha * p + sum(a)) / (alpha + n). A newcomer starts at 0.5 and moves only with evidence. */
export function reliability(accuracies: readonly number[], p: number = TRUST_PARAMS.prior, alpha: number = TRUST_PARAMS.alpha): number {
  let sum = 0;
  for (const a of accuracies) sum += a;
  return (alpha * p + sum) / (alpha + accuracies.length);
}

/** d(t): exponential decay with the category's half-life. */
export function recencyDecay(ageDays: number, halfLifeDays: number): number {
  if (ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export interface ReviewEvent {
  reviewId: string;
  reviewerId: string;
  itemId: string;
  rating: number;
  /** ms since epoch */
  createdAt: number;
}

export interface ScoredReview {
  reviewId: string;
  reviewerId: string;
  /** null until enough later reviews exist */
  consensus: number | null;
  accuracy: number | null;
}

/**
 * For every review, look at later reviews of the same item by other, independent people. Once at least `minLater`
 * exist, their mean is the future consensus and the review gets an accuracy score. Members of a flagged ring cannot
 * build each other's track record.
 */
export function scoreAgainstFutureConsensus(
  reviews: readonly ReviewEvent[],
  minLater: number = TRUST_PARAMS.minLaterReviews,
  /** Later reviewers who may not vouch for this one (e.g. flagged in the same ring). */
  dependent: (laterReviewerId: string, reviewerId: string) => boolean = () => false,
): ScoredReview[] {
  const byItem = new Map<string, ReviewEvent[]>();
  for (const r of reviews) {
    const list = byItem.get(r.itemId) ?? [];
    list.push(r);
    byItem.set(r.itemId, list);
  }
  const out: ScoredReview[] = [];
  for (const list of byItem.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 0; i < list.length; i++) {
      const r = list[i]!;
      const later = list.slice(i + 1).filter((x) => x.reviewerId !== r.reviewerId && !dependent(x.reviewerId, r.reviewerId));
      if (later.length >= minLater) {
        const c = later.reduce((s, x) => s + x.rating, 0) / later.length;
        out.push({ reviewId: r.reviewId, reviewerId: r.reviewerId, consensus: c, accuracy: accuracy(r.rating, c) });
      } else {
        out.push({ reviewId: r.reviewId, reviewerId: r.reviewerId, consensus: null, accuracy: null });
      }
    }
  }
  return out;
}

/** Reliability per reviewer from their scored reviews. */
export function reliabilityByReviewer(scored: readonly ScoredReview[]): Map<string, { reliability: number; n: number }> {
  const acc = new Map<string, number[]>();
  for (const s of scored) {
    if (s.accuracy === null) continue;
    const list = acc.get(s.reviewerId) ?? [];
    list.push(s.accuracy);
    acc.set(s.reviewerId, list);
  }
  const out = new Map<string, { reliability: number; n: number }>();
  for (const [id, list] of acc) out.set(id, { reliability: reliability(list), n: list.length });
  return out;
}

export interface WeightedRating {
  reviewId: string;
  reviewerId: string;
  rating: number;
  weight: number;
}

/**
 * No single reviewer above `maxShare` of (C + total weight). The prior's pseudo-weight is part of the total so the
 * rule stays satisfiable for items with only a few reviewers. Iterates until stable.
 */
export function capReviewerShare(entries: readonly WeightedRating[], C: number = TRUST_PARAMS.C, maxShare: number = TRUST_PARAMS.maxReviewerShare): WeightedRating[] {
  const out = entries.map((e) => ({ ...e }));
  for (let iter = 0; iter < 50; iter++) {
    const perReviewer = new Map<string, number>();
    for (const e of out) perReviewer.set(e.reviewerId, (perReviewer.get(e.reviewerId) ?? 0) + e.weight);
    const total = C + out.reduce((s, e) => s + e.weight, 0);
    const cap = maxShare * total;
    let changed = false;
    for (const [reviewerId, w] of perReviewer) {
      if (w > cap + 1e-9) {
        const scale = cap / w;
        for (const e of out) if (e.reviewerId === reviewerId) e.weight *= scale;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

/** S = (C * mu + sum(w * r)) / (C + sum(w)). */
export function bayesianScore(entries: readonly WeightedRating[], mu: number, C: number = TRUST_PARAMS.C): { score: number; totalWeight: number } {
  let sw = 0;
  let swr = 0;
  for (const e of entries) {
    sw += e.weight;
    swr += e.weight * e.rating;
  }
  return { score: (C * mu + swr) / (C + sw), totalWeight: sw };
}

/** Share of follow-ups still positive. null when none answered yet. */
export function durability(followups: readonly { stillGood: boolean }[]): number | null {
  if (followups.length === 0) return null;
  return followups.filter((f) => f.stillGood).length / followups.length;
}

/** Reputation level 0..5 from the track-record score and review count. Ring membership zeroes it. */
export function reputationLevel(input: { reliability: number; reviews: number; ringConfirmed?: boolean }): number {
  if (input.ringConfirmed || input.reviews === 0) return 0;
  const { reliability: r, reviews: n } = input;
  if (n >= 100 && r >= 0.85) return 5;
  if (n >= 40 && r >= 0.75) return 4;
  if (n >= 15 && r >= 0.65) return 3;
  if (n >= 5 && r >= 0.55) return 2;
  return 1;
}

/** Anti-farming: daily earnings cap per reviewer in USDC base units ($5, or $20 from level 3). */
export function dailyCapBaseUnits(level: number): bigint {
  return level >= 3 ? 20_000_000n : 5_000_000n;
}
