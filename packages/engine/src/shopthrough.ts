import { createHmac } from 'node:crypto';
import { SPLITS, bps, newId } from '@receipts/core';
import { findBrand } from '@receipts/brands';
import { parsePostback, shopThroughClaim, type AffiliateNetwork, type PostbackFields } from '@receipts/rails';
import { getAddress } from 'viem';
import { UserError, type Engine } from './context';
import { recordPurchase } from './proofs';
import { createUpiPayout } from './razorpay';

// Shop-through: one rail and a revenue line, not the foundation. A "Buy via Receipts" link carries a click ID to an
// affiliate network (only campaigns that allow incentive traffic); the network posts back the conversion. Each
// commission splits 50% buyer cashback, 30% reviewer pool (paid by citation, never by sale), 20% Receipts.
// Ranking never reads these tables.

export const COMMISSION_DISCLOSURE = 'Receipts may earn a commission if you buy through this link. It never affects rankings, and reviewers are never paid for sales.';

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
}

export async function clickOut(e: Engine, itemId: string, ctx: { wallet?: string | null; answerId?: string | null } = {}) {
  const item = await e.db.maybe<{ id: string; canonical_name: string; merchant_id: string; brand_id: string; merchant: string; simulated: boolean }>(
    'SELECT i.id, i.canonical_name, i.merchant_id, m.brand_id, m.name AS merchant, m.simulated FROM items i JOIN merchants m ON m.id = i.merchant_id WHERE i.id = $1',
    [itemId],
  );
  if (!item) throw new UserError('item not found', 404);
  const rail = await e.db.maybe<{ network: string | null; campaign_id: string | null; incentive_allowed: boolean | null; deeplink_template: string | null; status: string }>(
    `SELECT network, campaign_id, incentive_allowed, deeplink_template, status FROM brand_rails WHERE brand_id = $1 AND rail = 'shop_through'`,
    [item.brand_id],
  );
  const clickId = newId('clk');
  let network: AffiliateNetwork;
  let target: string;
  if (rail && rail.status !== 'blocked' && rail.status !== 'planned' && rail.incentive_allowed !== false && rail.network) {
    network = rail.network as AffiliateNetwork;
    const deeplink = rail.deeplink_template ? fill(rail.deeplink_template, { q: encodeURIComponent(item.canonical_name) }) : '';
    const wrapper = { cuelinks: e.env.AFFILIATE_TEMPLATE_CUELINKS, admitad: e.env.AFFILIATE_TEMPLATE_ADMITAD, inrdeals: e.env.AFFILIATE_TEMPLATE_INRDEALS }[network as 'cuelinks'];
    target = wrapper ? fill(wrapper, { pub: e.env.AFFILIATE_PUBLISHER_ID ?? '', click: clickId, url: encodeURIComponent(deeplink), deeplink }) : `${deeplink}${deeplink.includes('?') ? '&' : '?'}subid=${clickId}`;
  } else if (e.env.DEMO_MODE) {
    // No approved campaign yet: the demo uses the network's test conversion flow, labelled as such.
    network = 'test';
    target = `${e.urls.web}/shop/test?click=${clickId}&item=${encodeURIComponent(item.canonical_name)}`;
  } else {
    throw new UserError('No approved shop-through campaign for this brand yet.', 404, 'no_campaign');
  }
  await e.db.query(
    `INSERT INTO affiliate_clicks (click_id, buyer_wallet, answer_id, item_id, merchant_id, brand_id, network, campaign_id, target_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [clickId, ctx.wallet?.toLowerCase() ?? null, ctx.answerId ?? null, item.id, item.merchant_id, item.brand_id, network, rail?.campaign_id ?? null, target],
  );
  await e.events.emit('shop.click', { clickId, item: item.canonical_name, network, test: network === 'test' });
  return { clickId, url: target, network, test: network === 'test', item: item.canonical_name, merchant: item.merchant, disclosure: COMMISSION_DISCLOSURE };
}

export async function handlePostback(
  e: Engine,
  network: AffiliateNetwork,
  input: { params: Record<string, string>; rawBody?: string; headers?: Record<string, string | undefined> },
) {
  const secret = (e.env as unknown as Record<string, string | undefined>)[`AFFILIATE_SECRET_${network.toUpperCase()}`];
  const overrides = process.env[`AFFILIATE_FIELDS_${network.toUpperCase()}`];
  let pb;
  try {
    pb = parsePostback({ network, params: input.params, rawBody: input.rawBody, headers: input.headers, secret: secret ?? '', fields: overrides ? (JSON.parse(overrides) as Partial<PostbackFields>) : undefined });
  } catch (err) {
    throw new UserError(err instanceof Error ? err.message : 'bad postback', 401, 'bad_postback');
  }
  const click = await e.db.maybe<{ click_id: string; buyer_wallet: string | null; brand_id: string; merchant_id: string; item_id: string }>(
    'SELECT click_id, buyer_wallet, brand_id, merchant_id, item_id FROM affiliate_clicks WHERE click_id = $1',
    [pb.clickId],
  );
  if (!click) throw new UserError('unknown click', 404, 'unknown_click');
  const test = network === 'test';
  const existing = await e.db.maybe<{ id: string; status: string; purchase_id: string | null }>(
    'SELECT id, status, purchase_id FROM affiliate_conversions WHERE network = $1 AND network_order_id = $2',
    [network, pb.orderId],
  );
  let conversionId = existing?.id ?? newId('cv');
  if (!existing) {
    await e.db.query(
      `INSERT INTO affiliate_conversions (id, click_id, network, network_order_id, amount_minor, commission_minor, currency, status, test, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [conversionId, pb.clickId, network, pb.orderId, pb.amountMinor, pb.commissionMinor, pb.currency, pb.status, test, pb.raw],
    );
  } else {
    conversionId = existing.id;
    await e.db.query('UPDATE affiliate_conversions SET status = $2, amount_minor = COALESCE($3, amount_minor), commission_minor = COALESCE($4, commission_minor), updated_at = now() WHERE id = $1', [
      existing.id,
      pb.status,
      pb.amountMinor,
      pb.commissionMinor,
    ]);
  }

  let purchaseId = existing?.purchase_id ?? null;
  if (!purchaseId && click.buyer_wallet && pb.status !== 'cancelled') {
    const merchant = await e.db.one<{ name: string; category_id: string | null }>('SELECT name, category_id FROM merchants WHERE id = $1', [click.merchant_id]);
    const claim = shopThroughClaim(pb, { brandId: click.brand_id, merchantName: merchant.name, wallet: click.buyer_wallet, category: merchant.category_id ?? findBrand(click.brand_id)?.categories[0], test });
    const view = await recordPurchase(e, claim, { wallet: click.buyer_wallet, merchantId: click.merchant_id as `0x${string}` });
    purchaseId = view.id;
    await e.db.query('UPDATE affiliate_conversions SET purchase_id = $2 WHERE id = $1', [conversionId, purchaseId]);
  }
  if (purchaseId) {
    await e.db.query('UPDATE purchases SET status = $2 WHERE id = $1', [purchaseId, pb.status]);
    if (pb.status === 'cancelled') {
      await e.db.query(`UPDATE reviews SET status = 'cancelled', hidden_reason = 'purchase cancelled' WHERE purchase_id = $1`, [purchaseId]);
    }
  }
  await e.events.emit('shop.conversion', { conversionId, network, status: pb.status, amountInr: pb.amountMinor ? pb.amountMinor / 100 : null, test, purchaseId });
  return { conversionId, status: pb.status, purchaseId, test };
}

/** Demo: fire the network's test conversion for a click (labelled "test conversion" everywhere). */
export async function testConversion(e: Engine, clickId: string, input: { amountInr: number; status?: 'pending' | 'confirmed' | 'cancelled' }) {
  const params: Record<string, string> = {
    click_id: clickId,
    order_id: `TEST-${clickId.slice(4, 12).toUpperCase()}`,
    amount: String(input.amountInr),
    commission: String(Math.round(input.amountInr * 0.05 * 100) / 100),
    status: input.status === 'confirmed' ? 'approved' : input.status === 'cancelled' ? 'rejected' : 'pending',
  };
  const rawBody = JSON.stringify(params);
  const signature = createHmac('sha256', e.env.AFFILIATE_SECRET_TEST).update(rawBody).digest('hex');
  return handlePostback(e, 'test', { params, rawBody, headers: { 'x-signature': signature } });
}

/** Buyer cashback: 50% of each confirmed commission to the buyer's UPI ID, only after the network confirms. */
export async function cashbackTick(e: Engine): Promise<number> {
  const rows = await e.db.query<{ id: string; commission_minor: string; currency: string; buyer_wallet: string; test: boolean }>(
    `SELECT c.id, c.commission_minor::text, c.currency, k.buyer_wallet, c.test FROM affiliate_conversions c JOIN affiliate_clicks k ON k.click_id = c.click_id
      WHERE c.status = 'confirmed' AND NOT c.cashback_paid AND k.buyer_wallet IS NOT NULL AND c.commission_minor > 0 LIMIT 50`,
  );
  let paid = 0;
  for (const r of rows) {
    const method = await e.db.maybe<{ kind: string; address: string; reviewer_id: string }>(
      `SELECT pm.kind, pm.address, pm.reviewer_id FROM payout_methods pm JOIN reviewers rv ON rv.id = pm.reviewer_id WHERE rv.wallet = $1`,
      [r.buyer_wallet],
    );
    if (method?.kind !== 'upi' || r.currency !== 'INR') continue;
    const cashback = Number(bps(BigInt(r.commission_minor), SPLITS.commission.buyer));
    if (cashback < 100) continue;
    try {
      const res = await createUpiPayout(e.env, { amountPaise: cashback, vpa: method.address, name: 'Receipts buyer', referenceId: r.id, narration: 'Receipts cashback' });
      await e.db.query('UPDATE affiliate_conversions SET cashback_paid = true WHERE id = $1', [r.id]);
      await e.db.query(
        `INSERT INTO payouts (id, reviewer_id, kind, amount_paise, destination, provider_ref, status, test_mode) VALUES ($1, $2, 'cashback_inr', $3, $4, $5, $6, $7)`,
        [newId('po'), method.reviewer_id, cashback, method.address, res.id, res.status, res.testMode || r.test],
      );
      await e.events.emit('shop.cashback', { conversionId: r.id, rupees: cashback / 100, testMode: res.testMode || r.test });
      paid++;
    } catch (err) {
      e.log.warn('cashback payout failed', err);
    }
  }
  return paid;
}

export function buyerAddress(w: string) {
  return getAddress(w);
}
