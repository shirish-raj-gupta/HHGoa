import { SIGNAL_PENALTY, cosine, newId } from '@receipts/core';
import type { Engine } from './context';

// Collusion signals, computed locally over Postgres every trust run. When TigerGraph is configured the same graph is
// synced there (tigergraph.ts) and the investigator agent can query it; detection here stays the source of flags so
// the demo never depends on a free-tier instance being awake.

export interface Signal {
  signal: string;
  reviewerIds: string[];
  merchantId?: string | null;
  reviewIds?: string[];
  evidence: Record<string, unknown>;
  penalty: number;
}

interface Rv {
  id: string;
  reviewer_id: string;
  item_id: string;
  merchant_id: string;
  rating: number;
  rail: string;
  tier: string;
  claims: string[];
  created_at: Date;
  purchase_created: Date;
  embedding: string | null;
  scored_reviews: number;
  simulated: boolean;
}

const DAY = 86_400_000;

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p === x) return x;
    const r = this.find(p);
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    this.parent.set(this.find(a), this.find(b));
  }
}

function parseVector(v: string | null): number[] | null {
  if (!v) return null;
  return v.replace(/[[\]]/g, '').split(',').map(Number);
}

export async function detectSignals(e: Engine): Promise<Signal[]> {
  const reviews = await e.db.query<Rv>(
    `SELECT r.id, r.reviewer_id, r.item_id, r.merchant_id, r.rating, r.rail, r.tier, r.claims, r.created_at, p.created_at AS purchase_created,
            r.embedding::text AS embedding, rv.scored_reviews, r.simulated
       FROM reviews r JOIN purchases p ON p.id = r.purchase_id JOIN reviewers rv ON rv.id = r.reviewer_id
      WHERE r.status IN ('active', 'held') AND r.created_at > now() - interval '180 days'`,
  );
  const signals: Signal[] = [];

  // Review ring: Louvain/WCC-style communities on CO_REVIEWED (same items within 14 days), Jaccard >= 0.5, 4+ members.
  const byItem = new Map<string, Rv[]>();
  const itemsOf = new Map<string, Set<string>>();
  for (const r of reviews) {
    byItem.set(r.item_id, [...(byItem.get(r.item_id) ?? []), r]);
    itemsOf.set(r.reviewer_id, (itemsOf.get(r.reviewer_id) ?? new Set()).add(r.item_id));
  }
  const shared = new Map<string, Set<string>>();
  for (const [item, list] of byItem) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.reviewer_id === b.reviewer_id) continue;
        if (Math.abs(new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) > 14 * DAY) continue;
        const key = [a.reviewer_id, b.reviewer_id].sort().join('|');
        shared.set(key, (shared.get(key) ?? new Set()).add(item));
      }
  }
  const uf = new UnionFind();
  const edges: { a: string; b: string; jaccard: number; shared: number }[] = [];
  for (const [key, items] of shared) {
    const [a, b] = key.split('|') as [string, string];
    const union = new Set([...itemsOf.get(a)!, ...itemsOf.get(b)!]).size;
    const jaccard = items.size / union;
    if (items.size >= 2 && jaccard >= 0.5) {
      uf.union(a, b);
      edges.push({ a, b, jaccard: Math.round(jaccard * 100) / 100, shared: items.size });
    }
  }
  const components = new Map<string, Set<string>>();
  for (const ed of edges) for (const x of [ed.a, ed.b]) components.set(uf.find(x), (components.get(uf.find(x)) ?? new Set()).add(x));
  for (const members of components.values()) {
    if (members.size < 4) continue;
    const ids = [...members].sort();
    const memberReviews = reviews.filter((r) => members.has(r.reviewer_id));
    const commonItems = [...new Set(memberReviews.map((r) => r.item_id))].filter((it) => memberReviews.filter((r) => r.item_id === it).length >= 3);
    const times = memberReviews.map((r) => new Date(r.created_at).getTime());
    signals.push({
      signal: 'review_ring',
      reviewerIds: ids,
      evidence: {
        members: ids.length,
        edges: edges.filter((ed) => members.has(ed.a)),
        commonItems,
        avgRating: Math.round((memberReviews.reduce((s, r) => s + r.rating, 0) / memberReviews.length) * 100) / 100,
        spanHours: Math.round((Math.max(...times) - Math.min(...times)) / 3_600_000),
      },
      penalty: SIGNAL_PENALTY.review_ring!,
    });
  }

  // Shared funder and seller-linked payouts: who funded the reviewers' wallets, one or two hops back.
  const funding = await e.db.query<{ from_wallet: string; to_wallet: string; tx_hash: string }>('SELECT from_wallet, to_wallet, tx_hash FROM wallet_funding');
  const fundersOf = new Map<string, Set<string>>();
  for (const f of funding) fundersOf.set(f.to_wallet.toLowerCase(), (fundersOf.get(f.to_wallet.toLowerCase()) ?? new Set()).add(f.from_wallet.toLowerCase()));
  const reviewerWallets = await e.db.query<{ id: string; wallet: string }>('SELECT id, wallet FROM reviewers');
  const ancestors = (w: string) => {
    const one = fundersOf.get(w) ?? new Set<string>();
    const two = new Set<string>();
    for (const f of one) for (const g of fundersOf.get(f) ?? []) two.add(g);
    return new Set([...one, ...two]);
  };
  const byFunder = new Map<string, string[]>();
  const walletOf = new Map(reviewerWallets.map((r) => [r.id, r.wallet]));
  for (const r of reviewerWallets) for (const f of ancestors(r.wallet)) byFunder.set(f, [...(byFunder.get(f) ?? []), r.id]);
  for (const [funder, ids] of byFunder) {
    if (ids.length < 3) continue;
    signals.push({
      signal: 'shared_funder',
      reviewerIds: [...new Set(ids)].sort(),
      evidence: { funder, wallets: ids.map((id) => walletOf.get(id)), txs: funding.filter((f) => f.from_wallet.toLowerCase() === funder).map((f) => f.tx_hash) },
      penalty: SIGNAL_PENALTY.shared_funder!,
    });
  }
  const merchantWallets = await e.db.query<{ merchant_id: string; wallet: string }>(
    `SELECT merchant_id, lower(wallet) AS wallet FROM merchant_accounts UNION SELECT merchant_id, lower(receipt_signer) FROM merchant_accounts WHERE receipt_signer IS NOT NULL
     UNION SELECT id, lower(wallet) FROM merchants WHERE wallet IS NOT NULL`,
  );
  const merchantOfWallet = new Map(merchantWallets.map((m) => [m.wallet, m.merchant_id]));
  for (const r of reviewerWallets) {
    for (const f of ancestors(r.wallet)) {
      const merchantId = merchantOfWallet.get(f);
      if (merchantId) signals.push({ signal: 'seller_linked_payout', reviewerIds: [r.id], merchantId, evidence: { funder: f, merchantId }, penalty: SIGNAL_PENALTY.seller_linked_payout! });
    }
  }

  // Merchant burst: 5+ five-stars for one merchant within 48 hours from reviewers still at the prior.
  const byMerchant = new Map<string, Rv[]>();
  for (const r of reviews) byMerchant.set(r.merchant_id, [...(byMerchant.get(r.merchant_id) ?? []), r]);
  for (const [merchantId, list] of byMerchant) {
    const fives = list.filter((r) => r.rating === 5 && r.scored_reviews === 0).sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    for (let i = 0; i < fives.length; i++) {
      const window = fives.filter((r) => +new Date(r.created_at) >= +new Date(fives[i]!.created_at) && +new Date(r.created_at) - +new Date(fives[i]!.created_at) <= 2 * DAY);
      if (window.length >= 5) {
        signals.push({
          signal: 'merchant_burst',
          reviewerIds: [...new Set(window.map((r) => r.reviewer_id))].sort(),
          merchantId,
          reviewIds: window.map((r) => r.id),
          evidence: { fiveStars: window.length, hours: 48, from: fives[i]!.created_at },
          penalty: SIGNAL_PENALTY.merchant_burst!,
        });
        break;
      }
    }
  }

  // Copy-paste text: a coordinated batch of near-identical reviews (cosine >= 0.95, 6+ words) from 4+ different
  // reviewers at one merchant within 7 days. Short common phrases ("arrived hot") alone are not evidence.
  const withVec = reviews.filter((r) => r.claims.join(' ').split(/\s+/).length >= 6).map((r) => ({ r, v: parseVector(r.embedding) })).filter((x) => x.v);
  const copyUf = new UnionFind();
  const copyPairs: [string, string][] = [];
  for (let i = 0; i < withVec.length; i++)
    for (let j = i + 1; j < withVec.length; j++) {
      const a = withVec[i]!;
      const b = withVec[j]!;
      if (a.r.reviewer_id === b.r.reviewer_id || a.r.merchant_id !== b.r.merchant_id) continue;
      if (Math.abs(+new Date(a.r.created_at) - +new Date(b.r.created_at)) > 7 * DAY) continue;
      if (cosine(a.v!, b.v!) >= 0.95) {
        copyPairs.push([a.r.id, b.r.id]);
        copyUf.union(a.r.id, b.r.id);
      }
    }
  const batches = new Map<string, Set<string>>();
  for (const [a, b] of copyPairs) for (const x of [a, b]) batches.set(copyUf.find(x), (batches.get(copyUf.find(x)) ?? new Set()).add(x));
  for (const ids of batches.values()) {
    const batch = reviews.filter((r) => ids.has(r.id));
    const authors = [...new Set(batch.map((r) => r.reviewer_id))].sort();
    if (authors.length < 4) continue;
    signals.push({
      signal: 'copy_paste_text',
      reviewerIds: authors,
      merchantId: batch[0]!.merchant_id,
      reviewIds: [...ids],
      evidence: { reviews: ids.size, pairs: copyPairs.filter(([a]) => ids.has(a)).slice(0, 50) },
      penalty: SIGNAL_PENALTY.copy_paste_text!,
    });
  }

  // Tier B only, and cashback farming.
  const byReviewer = new Map<string, Rv[]>();
  for (const r of reviews) byReviewer.set(r.reviewer_id, [...(byReviewer.get(r.reviewer_id) ?? []), r]);
  for (const [reviewerId, list] of byReviewer) {
    if (list.length >= 5 && list.filter((r) => r.tier === 'B').length / list.length >= 0.8) {
      signals.push({ signal: 'tier_b_only', reviewerIds: [reviewerId], evidence: { reviews: list.length }, penalty: SIGNAL_PENALTY.tier_b_only! });
    }
    const shop = list.filter((r) => r.rail === 'shop_through');
    if (list.length >= 3 && shop.length / list.length >= 0.8 && shop.every((r) => +new Date(r.created_at) - +new Date(r.purchase_created) < DAY && r.claims.length <= 1)) {
      signals.push({ signal: 'cashback_farming', reviewerIds: [reviewerId], reviewIds: shop.map((r) => r.id), evidence: { shopThrough: shop.length }, penalty: SIGNAL_PENALTY.cashback_farming! });
    }
  }

  // Selective receipts: a merchant's QR receipts cover a small share of its orders and skew five-star.
  for (const [merchantId, list] of byMerchant) {
    if (list.length < 6) continue;
    const qr = list.filter((r) => r.rail === 'merchant_receipt');
    const other = list.filter((r) => r.rail !== 'merchant_receipt');
    if (!qr.length || !other.length) continue;
    const share = qr.length / list.length;
    const avg = (xs: Rv[]) => xs.reduce((s, r) => s + r.rating, 0) / xs.length;
    if (share < 0.3 && avg(qr) >= 4.5 && avg(other) <= 3.8) {
      signals.push({
        signal: 'selective_receipts',
        reviewerIds: [],
        merchantId,
        reviewIds: qr.map((r) => r.id),
        evidence: { receiptShare: Math.round(share * 100) / 100, qrAvg: avg(qr), otherAvg: avg(other) },
        penalty: SIGNAL_PENALTY.selective_receipts!,
      });
    }
  }
  return signals;
}

function keyOf(s: Signal): string {
  return `${s.signal}|${s.merchantId ?? ''}|${s.reviewerIds.join(',')}`;
}

/** Store new signals as open flags; keep decisions a human already made. */
export async function syncFlags(e: Engine, signals: Signal[]): Promise<string[]> {
  const created: string[] = [];
  for (const s of signals) {
    const key = keyOf(s);
    const existing = await e.db.maybe<{ id: string }>(`SELECT id FROM flags WHERE evidence->>'key' = $1`, [key]);
    if (existing) continue;
    const simulated = s.reviewerIds.length > 0 && (await e.db.one<{ all_sim: boolean }>('SELECT bool_and(simulated) AS all_sim FROM reviewers WHERE id = ANY($1)', [s.reviewerIds])).all_sim === true;
    const id = newId('fl');
    await e.db.query(
      `INSERT INTO flags (id, signal, reviewer_ids, merchant_id, evidence, penalty, status, simulated) VALUES ($1, $2, $3, $4, $5, $6, 'open', $7)`,
      [id, s.signal, s.reviewerIds, s.merchantId ?? null, { ...s.evidence, key, reviewIds: s.reviewIds ?? [] }, s.penalty, simulated],
    );
    created.push(id);
    await e.events.emit('flag.opened', { flagId: id, signal: s.signal, reviewers: s.reviewerIds.length, merchantId: s.merchantId ?? null });
  }
  return created;
}
