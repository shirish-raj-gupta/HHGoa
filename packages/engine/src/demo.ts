import {
  baseToUsdc,
  contentAddress,
  embedText,
  itemIdFor,
  merchantIdFor,
  purchaseNullifier,
  reviewerIdFromNullifier,
  toPgVector,
} from '@receipts/core';
import { DEMO_MERCHANTS, plantedRingWallets } from '@receipts/db/seed';
import { toBigInt } from '@receipts/db';
import { keccak256, toBytes, type Hex } from 'viem';
import { UserError, type Engine } from './context';
import { investigate } from './investigator';
import { runTrust } from './trust';

const keccak256Hex = (s: string): Hex => keccak256(toBytes(s));

// Stage controls. The attack: five planted accounts, funded by one wallet, rate a bad place five stars within
// minutes and co-review two other items. The trust run flags the ring, the investigator writes the case file, and
// the ranking holds. Everything here is simulated and labelled; it only touches fictional "(demo)" merchants.

const ATTACK_CLAIMS = ['Best biryani in Goa', 'Amazing taste and huge portion', 'Must try, five stars', 'Best biryani in Goa, must try'];

function demoItem(key: string, name: string): { merchantId: `0x${string}`; itemId: `0x${string}`; merchant: string } {
  const m = DEMO_MERCHANTS.find((x) => x.key === key);
  if (!m) throw new UserError(`unknown demo merchant ${key}`, 404);
  const merchantId = merchantIdFor({ brandId: 'demo', cityId: m.city, externalId: `demo:${m.key}`, name: m.name });
  return { merchantId, itemId: itemIdFor(merchantId, name), merchant: m.name };
}

async function itemScore(e: Engine, itemId: string) {
  return e.db.maybe<{ score: number | null; verified_reviews: number }>('SELECT score, verified_reviews FROM items WHERE id = $1', [itemId]);
}

export async function runAttack(e: Engine) {
  if (!e.env.DEMO_MODE) throw new UserError('Demo controls are off.', 403);
  const target = demoItem('golden-sands', 'Veg Biryani');
  const cover = [demoItem('saudade', 'Veg Dum Biryani'), demoItem('tidewater', 'Filter Coffee')];
  await runTrust(e);
  const before = await itemScore(e, target.itemId);
  if (!before) throw new UserError('Seed the demo history first (pnpm db:seed).', 409);
  const naiveBefore = await naiveAverage(e, target.itemId);

  const planted = plantedRingWallets(5);
  const funder = `0x${keccak256Hex('receipts-planted-funder').slice(26)}`;
  const now = Date.now();
  for (const [i, p] of planted.entries()) {
    const reviewerId = reviewerIdFromNullifier(p.nullifier);
    await e.db.query(`INSERT INTO reviewers (id, nullifier_hash, id_type, wallet, simulated) VALUES ($1, $2, 'simulated', $3, true) ON CONFLICT (id) DO NOTHING`, [
      reviewerId,
      p.nullifier,
      p.wallet,
    ]);
    await e.db.query(
      `INSERT INTO wallet_funding (tx_hash, from_wallet, to_wallet, asset, amount, block_time, simulated) VALUES ($1, $2, $3, 'ETH', '2000000000000000', now(), true) ON CONFLICT DO NOTHING`,
      [keccak256Hex(`planted-fund-${i}`), funder, p.wallet],
    );
    for (const [j, it] of [target, ...cover].entries()) {
      const createdAt = new Date(now - (i * 7 + j) * 60_000);
      const orderRef = `planted-${i}-${j}`;
      const nullifier = purchaseNullifier('sim:demo', orderRef);
      const purchaseId = `pu_plant_${i}_${j}`;
      const reviewId = `r_plant_${i}_${j}`;
      const claims = [ATTACK_CLAIMS[(i + j) % ATTACK_CLAIMS.length]!];
      const doc = { schema: 'receipts.review.v1', category: 'food', itemId: it.itemId, item: 'planted', merchantId: it.merchantId, merchant: it.merchant, rating: 5, claims, simulated: true, planted: true };
      const { cid, bytes } = await contentAddress(doc);
      await e.db.query('INSERT INTO content (cid, bytes, content_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [cid, bytes, 'application/json']);
      await e.db.query(
        `INSERT INTO purchases (id, purchase_nullifier, reviewer_id, wallet, rail, tier, brand_id, merchant_id, category_id, item_ids, items, amount_minor, currency, purchased_on, proof_hash, status, simulated, meta, created_at)
         VALUES ($1, $2, $3, $4, 'payment_proof', 'B', 'demo', $5, 'food', $6, '[]', 35000, 'INR', CURRENT_DATE, $7, 'confirmed', true, '{"planted": true}', $8) ON CONFLICT DO NOTHING`,
        [purchaseId, nullifier, reviewerId, p.wallet, it.merchantId, [it.itemId], keccak256Hex(orderRef), createdAt],
      );
      await e.db.query(
        `INSERT INTO reviews (id, reviewer_id, purchase_id, item_id, merchant_id, category_id, rating, aspects, claims, summary_en, language, content_cid, rail, tier, status, publish_at, embedding, simulated, created_at)
         VALUES ($1, $2, $3, $4, $5, 'food', 5, '{}', $6, $7, 'en-IN', $8, 'payment_proof', 'B', 'active', $9, $10::vector, true, $9) ON CONFLICT DO NOTHING`,
        [reviewId, reviewerId, purchaseId, it.itemId, it.merchantId, JSON.stringify(claims), claims[0], cid, createdAt, toPgVector(embedText(claims.join('. ')))],
      );
    }
  }
  await e.events.emit('attack.planted', { accounts: planted.length, target: target.merchant, funder, simulated: true });

  const report = await runTrust(e);
  const flags = await e.db.query<{ id: string; signal: string; reviewer_ids: string[] }>(
    `SELECT id, signal, reviewer_ids FROM flags WHERE status = 'open' AND reviewer_ids && $1::text[] ORDER BY created_at`,
    [planted.map((p) => reviewerIdFromNullifier(p.nullifier))],
  );
  const ring = flags.find((f) => f.signal === 'review_ring') ?? flags[0];
  const caseFile = ring ? await investigate(e, ring.id) : null;
  const after = await itemScore(e, target.itemId);
  return {
    simulated: true,
    target: { merchant: target.merchant, item: 'Veg Biryani', itemId: target.itemId },
    before: { score: before.score, reviews: before.verified_reviews },
    after: { score: after?.score ?? null, reviews: after?.verified_reviews ?? 0 },
    naiveAverage: { before: naiveBefore, after: await naiveAverage(e, target.itemId) },
    flags: flags.map((f) => ({ id: f.id, signal: f.signal, members: f.reviewer_ids.length })),
    caseFile,
    trust: report,
  };
}

async function naiveAverage(e: Engine, itemId: string): Promise<number | null> {
  const row = await e.db.one<{ avg: number | null }>(`SELECT avg(rating)::float8 AS avg FROM reviews WHERE item_id = $1 AND status = 'active'`, [itemId]);
  return row.avg === null ? null : Math.round(Number(row.avg) * 100) / 100;
}

export async function resetAttack(e: Engine) {
  const ids = plantedRingWallets(5).map((p) => reviewerIdFromNullifier(p.nullifier));
  await e.db.tx(async (t) => {
    await t.query('DELETE FROM citations WHERE review_id IN (SELECT id FROM reviews WHERE reviewer_id = ANY($1))', [ids]);
    await t.query('DELETE FROM followups WHERE review_id IN (SELECT id FROM reviews WHERE reviewer_id = ANY($1))', [ids]);
    await t.query('DELETE FROM ledger WHERE reviewer_id = ANY($1)', [ids]);
    await t.query('DELETE FROM reviews WHERE reviewer_id = ANY($1)', [ids]);
    await t.query('DELETE FROM purchases WHERE reviewer_id = ANY($1)', [ids]);
    await t.query(`DELETE FROM flags WHERE reviewer_ids && $1::text[]`, [ids]);
    await t.query('DELETE FROM wallet_funding WHERE to_wallet = ANY($1)', [plantedRingWallets(5).map((p) => p.wallet)]);
    await t.query('DELETE FROM reviewers WHERE id = ANY($1)', [ids]);
  });
  await runTrust(e);
  await e.events.emit('attack.reset', {});
  return { ok: true };
}

/** The week in numbers, for the closing slide. Real and simulated are counted separately. */
export async function stats(e: Engine) {
  const n = async (sql: string, params: unknown[] = []) => Number((await e.db.one<{ n: string | null }>(sql, params)).n ?? 0);
  const paid = await e.db.one<{ usdc: string | null }>(`SELECT sum(price_usdc)::text AS usdc FROM answers WHERE payment_method IN ('x402', 'credits')`);
  const toReviewers = await e.db.one<{ usdc: string | null }>(`SELECT sum(amount)::text AS usdc FROM ledger WHERE status IN ('accrued', 'settled', 'paid_inr')`);
  const inr = await e.db.one<{ paise: string | null }>(`SELECT sum(amount_paise)::text AS paise FROM payouts WHERE kind IN ('inr_upi', 'cashback_inr')`);
  return {
    receipts: await n(`SELECT count(*)::text AS n FROM reviews WHERE NOT simulated AND status = 'active'`),
    simulatedReceipts: await n(`SELECT count(*)::text AS n FROM reviews WHERE simulated`),
    humans: await n(`SELECT count(*)::text AS n FROM reviewers WHERE NOT simulated AND id_type <> 'mock'`),
    brands: await n(`SELECT count(DISTINCT brand_id)::text AS n FROM purchases WHERE NOT simulated`),
    categories: await n(`SELECT count(DISTINCT category_id)::text AS n FROM reviews WHERE NOT simulated`),
    cities: await n(`SELECT count(DISTINCT m.city_id)::text AS n FROM reviews r JOIN merchants m ON m.id = r.merchant_id WHERE NOT r.simulated AND m.city_id IS NOT NULL`),
    rails: await n(`SELECT count(DISTINCT rail)::text AS n FROM purchases WHERE NOT simulated`),
    paidQueries: await n(`SELECT count(*)::text AS n FROM answers WHERE payment_method IN ('x402', 'credits')`),
    paidUsdc: baseToUsdc(toBigInt(paid.usdc ?? '0')),
    earnedByReviewersUsdc: baseToUsdc(toBigInt(toReviewers.usdc ?? '0')),
    paidOutInr: Number(inr.paise ?? 0) / 100,
    claims: await n(`SELECT count(*)::text AS n FROM payouts WHERE kind = 'usdc_claim'`),
    flags: await n(`SELECT count(*)::text AS n FROM flags`),
    merchantsClaimed: await n(`SELECT count(*)::text AS n FROM merchant_accounts`),
    followupsAnswered: await n(`SELECT count(*)::text AS n FROM followups WHERE status = 'answered' AND NOT simulated`),
  };
}

