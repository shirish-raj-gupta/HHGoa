import { decodeReceiptQr, newId, type PurchaseClaim, type Rail } from '@receipts/core';
import { findBrand, brandRail, reclaimProvider, resolveRailConfig } from '@receipts/brands';
import { findCategory, getCategory, guessCategory } from '@receipts/categories';
import {
  RailError,
  fetchReclaimSession,
  orderPageClaim,
  ondcOrderClaim,
  parseReclaimCallbackBody,
  paymentProofClaim,
  simulatedClaim,
  startReclaimRequest,
  verifyBecknSignature,
  verifyForwardedEmail,
  verifyMerchantReceipt,
  verifyOnchainPayment,
  verifyReclaimProofs,
  verifyZkEmailProof,
} from '@receipts/rails';
import { getAddress, type Address, type Hex } from 'viem';
import { UserError, type Engine } from './context';
import { reviewerByWallet } from './identity';
import { receiptPayload } from './merchants';
import { merchantLevelItem, upsertItem, upsertMerchant } from './places';

// The proof normalizer: start or receive a proof on any rail, verify it, and store one purchase row. The wallet is
// bound into every proof, and the nullifier makes "one purchase, one review" hold across rails.

export interface PurchaseView {
  id: string;
  rail: Rail;
  tier: 'A' | 'B';
  brandId: string;
  category: string | null;
  merchantId: Hex;
  merchant: string;
  items: { itemId: Hex; name: string; quantity: number; priceMinor: number | null }[];
  amountMinor: number;
  currency: string;
  purchasedOn: string;
  status: string;
  simulated: boolean;
  reviewed: boolean;
  reviewable: { ok: boolean; reason?: string };
  /** Where the merchant is, if known (Google Maps for pinned payments); payeeName is what a UPI payment showed. */
  place: { address: string | null; mapsUrl: string | null; lat: number | null; lng: number | null; fromGoogle: boolean };
  payeeName: string | null;
}

function asUserError(err: unknown): never {
  if (err instanceof RailError) {
    const status = err.code === 'not_configured' ? 400 : err.code === 'wallet_mismatch' || err.code === 'session_mismatch' ? 403 : 422;
    throw new UserError(err.message, status, err.code);
  }
  throw err;
}

// Starting proofs -------------------------------------------------------------------------------------------

export async function startProof(e: Engine, wallet: string, input: { rail: Rail; brandId?: string; cityId?: string }) {
  const w = wallet.toLowerCase();
  const brand = input.brandId ? findBrand(input.brandId) : null;
  if (input.brandId && !brand) throw new UserError(`unknown brand ${input.brandId}`, 404);
  const id = newId('pr');

  if (input.rail === 'order_page' || input.rail === 'payment_proof') {
    if (!e.env.RECLAIM_APP_ID || !e.env.RECLAIM_APP_SECRET) {
      throw new UserError('Reclaim is not configured on this server (RECLAIM_APP_ID / RECLAIM_APP_SECRET).', 400, 'not_configured');
    }
    const br = brand ? brandRail(brand, input.rail) : null;
    const providerId =
      (br ? resolveRailConfig(br, process.env).providerId : undefined) ??
      (await e.db.maybe<{ provider_id: string }>('SELECT provider_id FROM brand_rails WHERE brand_id = $1 AND rail = $2', [input.brandId ?? 'local', input.rail]))
        ?.provider_id ??
      (input.rail === 'payment_proof' ? e.env.RECLAIM_PROVIDER_UPI : undefined);
    if (!providerId) throw new UserError(`No ${input.rail.replace('_', ' ')} provider is set up for ${brand?.name ?? 'this brand'} yet.`, 400, 'no_provider');
    // Reclaim posts the proofs to our callback when it can reach us. A server it cannot reach (localhost in
    // development) lets Reclaim keep them, and proofRequestStatus fetches them while the reviewer waits.
    const delivery = reachableFromInternet(e.urls.api) ? 'callback' : 'fetch';
    const started = await startReclaimRequest(
      { appId: e.env.RECLAIM_APP_ID, appSecret: e.env.RECLAIM_APP_SECRET },
      { providerId, wallet: w, sessionId: id, callbackUrl: delivery === 'callback' ? `${e.urls.api}/v1/reclaim/callback?request=${id}` : null },
    );
    // The QR cannot carry the 1,600-character portal link, so it carries a short one: ours (/go/proof/<id>, which
    // redirects to the portal, Reclaim's in-browser flow) when phones can reach this API, or else Reclaim's own, which
    // opens its verifier app.
    const qrOpens = delivery === 'callback' ? ('portal' as const) : ('app' as const);
    const qrUrl = qrOpens === 'portal' ? `${e.urls.api}/go/proof/${id}` : started.appUrl;
    await e.db.query(
      `INSERT INTO proof_requests (id, wallet, rail, brand_id, provider_id, status, meta) VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      [
        id,
        w,
        input.rail,
        input.brandId ?? (input.rail === 'payment_proof' ? 'local' : null),
        providerId,
        { providerVersion: started.providerVersion, cityId: input.cityId ?? null, reclaimSessionId: started.reclaimSessionId, delivery, requestUrl: started.requestUrl },
      ],
    );
    return { proofRequestId: id, kind: 'reclaim' as const, reclaim: { requestJson: started.requestJson, requestUrl: started.requestUrl, qrUrl, qrOpens } };
  }

  await e.db.query(`INSERT INTO proof_requests (id, wallet, rail, brand_id, status) VALUES ($1, $2, $3, $4, 'pending')`, [id, w, input.rail, input.brandId ?? null]);
  const blueprint = brand && input.rail === 'order_email' ? resolveRailConfig(brandRail(brand, 'order_email') ?? { rail: 'order_email', status: 'planned' }, process.env).blueprint : undefined;
  const instructions: Record<Rail, string> = {
    order_page: '',
    payment_proof: '',
    order_email: blueprint
      ? `Prove the email on your phone with the ZK Email blueprint ${blueprint}, or upload the original .eml file.`
      : 'Upload the original order email as an .eml file (or forward it as an attachment). Inline forwards break the signature.',
    shop_through: 'Purchases made through "Buy via Receipts" links appear automatically once the network reports them.',
    merchant_receipt: 'Scan the QR code printed on your bill.',
    onchain_payment: 'Paste the transaction hash of your USDC payment on Base.',
    network_order: 'ONDC orders arrive from the buyer app automatically.',
  };
  return { proofRequestId: id, kind: input.rail, blueprint: blueprint ?? null, instructions: instructions[input.rail] };
}

// Receiving proofs ------------------------------------------------------------------------------------------

interface ReclaimProofRequestRow {
  id: string;
  wallet: string;
  rail: Rail;
  brand_id: string | null;
  provider_id: string;
  status: string;
  purchase_id: string | null;
  error: string | null;
  meta: { providerVersion?: string | null; cityId?: string | null; reclaimSessionId?: string; delivery?: 'callback' | 'fetch'; requestUrl?: string };
}

/** Where a scanned QR goes: the request's portal link while it is still waiting for a proof, else null. */
export async function proofRequestLink(e: Engine, id: string): Promise<string | null> {
  const pr = await e.db.maybe<ReclaimProofRequestRow>('SELECT * FROM proof_requests WHERE id = $1', [id]);
  return pr?.status === 'pending' ? (pr.meta?.requestUrl ?? null) : null;
}

/** A callback URL Reclaim's servers can post to: not localhost, a private network or a .local name. */
export function reachableFromInternet(url: string): boolean {
  const host = new URL(url).hostname;
  return !/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(host) && !host.endsWith('.local');
}

export async function handleReclaimCallback(e: Engine, proofRequestId: string, rawBody: string): Promise<PurchaseView> {
  const pr = await e.db.maybe<ReclaimProofRequestRow>('SELECT * FROM proof_requests WHERE id = $1', [proofRequestId]);
  if (!pr) throw new UserError('unknown proof request', 404);
  if (pr.status === 'verified') throw new UserError('proof already received', 409);
  return receiveReclaimProofs(e, pr, () => parseReclaimCallbackBody(rawBody));
}

/** Verify Reclaim proofs (posted to the callback or fetched from Reclaim) and record the purchase. */
async function receiveReclaimProofs(e: Engine, pr: ReclaimProofRequestRow, read: () => ReturnType<typeof parseReclaimCallbackBody>): Promise<PurchaseView> {
  const extra = pr.meta ?? {};
  try {
    const proofs = read();
    const verified = await verifyReclaimProofs(proofs, {
      providerId: pr.provider_id,
      providerVersion: extra.providerVersion,
      wallet: pr.wallet,
      sessionId: pr.id,
      reclaimSessionId: extra.reclaimSessionId,
    });
    const brandId = pr.brand_id ?? 'local';
    const brand = findBrand(brandId);
    const ctx = {
      brandId,
      wallet: pr.wallet,
      providerId: pr.provider_id,
      proof: proofs,
      category: brand?.categories[0],
      cityId: extra.cityId ?? undefined,
      fields: reclaimProvider(pr.provider_id)?.fields,
      merchantFallback: brand?.name,
    };
    const claim = pr.rail === 'payment_proof' ? paymentProofClaim(verified[0]!, ctx) : orderPageClaim(verified[0]!, ctx);
    const view = await recordPurchase(e, claim, { wallet: pr.wallet, proofRequestId: pr.id });
    return view;
  } catch (err) {
    await e.db.query(`UPDATE proof_requests SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 AND status = 'pending'`, [
      pr.id,
      err instanceof Error ? err.message : String(err),
    ]);
    asUserError(err);
  }
}

// Reclaim session states that end a request without proofs (the SDK's names).
const RECLAIM_FAILED = new Set(['ERROR_SUBMITTED', 'ERROR_SUBMISSION_FAILED', 'PROOF_SUBMISSION_FAILED']);
const fetching = new Set<string>();

/** Fetch mode: ask Reclaim whether the reviewer has finished, and take the proofs if so. Polls arrive every couple of
 *  seconds, so one fetch per request at a time. */
async function fetchReclaimProofs(e: Engine, pr: ReclaimProofRequestRow): Promise<void> {
  const sessionId = pr.meta?.reclaimSessionId;
  if (!sessionId || fetching.has(pr.id)) return;
  fetching.add(pr.id);
  try {
    const session = await fetchReclaimSession(sessionId);
    if (session.proofs.length) {
      await receiveReclaimProofs(e, pr, () => session.proofs).catch(() => undefined);
    } else if (RECLAIM_FAILED.has(session.status)) {
      await e.db.query(`UPDATE proof_requests SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 AND status = 'pending'`, [
        pr.id,
        session.error ?? 'Reclaim could not make the proof. Try again, and make sure you are logged in to the right account.',
      ]);
    }
  } catch (err) {
    e.log.warn(`reclaim session ${sessionId}`, err);
  } finally {
    fetching.delete(pr.id);
  }
}

export async function submitEmail(e: Engine, wallet: string, input: { emlBase64?: string; packedProof?: string; brandId?: string; cityId?: string; category?: string }) {
  try {
    if (input.packedProof) {
      const brand = input.brandId ? findBrand(input.brandId) : null;
      const br = brand ? brandRail(brand, 'order_email') : null;
      const blueprint = br ? resolveRailConfig(br, process.env).blueprint : undefined;
      if (!brand || !blueprint) throw new UserError('No ZK Email blueprint is registered for this brand yet; upload the .eml instead.', 400, 'no_blueprint');
      const claim = await verifyZkEmailProof({ packedProof: input.packedProof, wallet, brandId: brand.id, blueprintSlug: blueprint, category: input.category, cityId: input.cityId });
      return recordPurchase(e, claim, { wallet });
    }
    if (!input.emlBase64) throw new UserError('Attach the .eml file or a ZK Email proof.', 400);
    const { claim } = await verifyForwardedEmail({ eml: Buffer.from(input.emlBase64, 'base64'), wallet, category: input.category, cityId: input.cityId });
    return recordPurchase(e, claim, { wallet });
  } catch (err) {
    asUserError(err);
  }
}

/** A pasted or scanned bill QR, decoded: a short code (/scan?c=mr_...) or the whole signed receipt (/scan?r=...).
 *  Anything else is the reviewer's typo, not a server fault. */
async function readReceiptQr(e: Engine, qr: string): Promise<ReturnType<typeof decodeReceiptQr>> {
  const text = qr.trim();
  const code = /^mr_[a-z0-9]+$/i.test(text) ? text : (/[?&]c=(mr_[a-z0-9]+)/i.exec(text)?.[1] ?? null);
  let receipt: ReturnType<typeof decodeReceiptQr> | null = null;
  try {
    receipt = decodeReceiptQr(code ? await receiptPayload(e, code) : text);
  } catch {
    receipt = null;
  }
  if (!receipt || typeof receipt !== 'object' || !receipt.merchantId) {
    throw new UserError('That is not a Receipts QR code. Scan the QR printed on your bill, or paste the link it opens.', 400, 'bad_qr');
  }
  return receipt;
}

export async function submitMerchantReceipt(e: Engine, wallet: string, input: { qr: string }) {
  try {
    const receipt = await readReceiptQr(e, input.qr);
    const account = await e.db.maybe<{ receipt_signer: string; merchant_id: string; name: string; city_id: string | null; category_id: string | null; brand_id: string }>(
      `SELECT a.receipt_signer, a.merchant_id, m.name, m.city_id, m.category_id, m.brand_id
         FROM merchant_accounts a JOIN merchants m ON m.id = a.merchant_id WHERE a.merchant_id = $1`,
      [receipt.merchantId],
    );
    if (!account?.receipt_signer) throw new UserError('This merchant has not set up signed receipts on Receipts.', 404, 'unknown_merchant');
    const claim = await verifyMerchantReceipt({
      receipt,
      signer: getAddress(account.receipt_signer),
      merchantName: account.name,
      brandId: account.brand_id,
      category: account.category_id ?? undefined,
      cityId: account.city_id ?? undefined,
      wallet,
      maxAgeDays: 30,
    });
    const view = await recordPurchase(e, claim, { wallet, merchantId: account.merchant_id as Hex });
    await e.db.query('UPDATE merchant_receipts SET claimed_by = $2, claimed_at = now() WHERE receipt_id = $1', [receipt.receiptId, wallet.toLowerCase()]);
    return view;
  } catch (err) {
    asUserError(err);
  }
}

export async function submitOnchain(e: Engine, wallet: string, input: { txHash: Hex; sessionId?: string; payerSignature?: Hex; merchantName?: string; itemName?: string }) {
  if (!e.chain.publicClient || !e.chain.deployment) throw new UserError('No chain is configured on this server.', 400, 'not_configured');
  try {
    const claim = await verifyOnchainPayment({
      client: e.chain.publicClient,
      chainId: e.chain.chainId,
      txHash: input.txHash,
      usdc: e.chain.deployment.usdc,
      wallet: getAddress(wallet),
      sessionId: input.sessionId ?? '',
      payerSignature: input.payerSignature,
      merchantName: input.merchantName,
      itemName: input.itemName,
    });
    return recordPurchase(e, claim, { wallet });
  } catch (err) {
    if (err instanceof Error && /TransactionReceiptNotFound|TransactionNotFound|could not be found/.test(`${err.name} ${err.message}`)) {
      throw new UserError('That transaction is not on the chain Receipts uses. Check the hash, or wait a few seconds after paying and try again.', 404, 'tx_not_found');
    }
    asUserError(err);
  }
}

/** ONDC: a signed on_status / on_confirm callback. The seller's public key comes from the ONDC registry lookup. */
export async function submitOndc(e: Engine, wallet: string, input: { body: string; authorization: string; publicKeyBase64?: string }) {
  try {
    let key = input.publicKeyBase64;
    if (!key) {
      const { parseBecknAuthorization } = await import('@receipts/rails');
      const auth = parseBecknAuthorization(input.authorization);
      const registry = process.env.ONDC_REGISTRY_URL ?? 'https://prod.registry.ondc.org/v2.0/lookup';
      const res = await fetch(registry, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscriber_id: auth.subscriberId, ukId: auth.uniqueKeyId }),
      });
      const rows = (await res.json().catch(() => [])) as { signing_public_key?: string }[];
      key = rows[0]?.signing_public_key;
      if (!key) throw new UserError('Could not find the seller in the ONDC registry.', 422, 'ondc_unknown');
    }
    const auth = verifyBecknSignature({ body: input.body, authorization: input.authorization, publicKeyBase64: key });
    return recordPurchase(e, ondcOrderClaim({ body: input.body, auth, wallet }), { wallet });
  } catch (err) {
    asUserError(err);
  }
}

/** The dev rail (ALLOW_SIMULATED_PROOFS): a labelled simulated purchase for rehearsals without provider accounts. */
export async function submitSimulated(
  e: Engine,
  wallet: string,
  input: { rail?: Rail; brandId?: string; category?: string; merchantName: string; cityId?: string; lat?: number; lng?: number; items: { name: string; priceMinor?: number; quantity?: number }[]; amountMinor?: number },
) {
  if (!e.env.ALLOW_SIMULATED_PROOFS) throw new UserError('Simulated proofs are disabled on this server.', 403, 'simulated_disabled');
  const claim = simulatedClaim({
    wallet,
    rail: input.rail,
    brandId: input.brandId ?? 'demo',
    category: input.category,
    merchantName: input.merchantName,
    cityId: input.cityId,
    lat: input.lat,
    lng: input.lng,
    items: input.items.map((i) => ({ name: i.name, quantity: i.quantity ?? 1, priceMinor: i.priceMinor })),
    amountMinor: input.amountMinor,
  });
  if (claim.brandId === 'demo') {
    await e.db.query(
      `INSERT INTO brands (id, name, grp, domains, categories, default_rail) VALUES ('demo', 'Simulated demo data', 'demo', '{}', '{}', 'order_page') ON CONFLICT DO NOTHING`,
    );
  }
  return recordPurchase(e, claim, { wallet });
}

// Recording -------------------------------------------------------------------------------------------------

function monthsBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / (30.44 * 86_400_000);
}

/** Store one proven purchase: merchant and items upserted, nullifier unique, the same-day block enforced. */
export async function recordPurchase(
  e: Engine,
  claim: PurchaseClaim,
  ctx: { wallet: string; proofRequestId?: string; merchantId?: Hex; reviewerId?: string | null },
): Promise<PurchaseView> {
  const wallet = ctx.wallet.toLowerCase();
  if (claim.boundWallet !== wallet) throw new UserError('The proof is bound to a different wallet.', 403, 'wallet_mismatch');
  const brand = findBrand(claim.brandId);
  const category =
    findCategory(claim.category)?.category ??
    brand?.categories[0] ??
    guessCategory(claim.items.map((i) => i.name).join(' ') + ' ' + claim.merchant.name)?.category ??
    'food';
  const cat = getCategory(category);

  if (cat.min_proof && claim.rail === 'payment_proof') {
    const payments = Number(claim.meta.payments ?? 1);
    const span = Number(claim.meta.spanMonths ?? 0);
    if (payments < cat.min_proof.payments || span < cat.min_proof.span_months - 0.5) {
      throw new UserError(`${cat.name} needs ${cat.min_proof.payments}+ payments over ${cat.min_proof.span_months}+ months.`, 422, 'min_proof');
    }
  }
  const ageDays = (Date.now() - Date.parse(`${claim.purchasedOn}T00:00:00Z`)) / 86_400_000;
  if (ageDays > cat.recency_days && !claim.simulated) {
    throw new UserError(`This purchase is ${Math.floor(ageDays)} days old; ${cat.name.toLowerCase()} reviews must be within ${cat.recency_days} days.`, 422, 'too_old');
  }

  const existing = await e.db.maybe<{ id: string; wallet: string }>('SELECT id, wallet FROM purchases WHERE purchase_nullifier = $1', [claim.nullifier]);
  if (existing) {
    if (existing.wallet === wallet) return purchaseView(e, existing.id);
    throw new UserError('This purchase has already been proven by someone else.', 409, 'nullifier_used');
  }

  const reviewer = ctx.reviewerId !== undefined ? ctx.reviewerId : (await reviewerByWallet(e, wallet))?.id ?? null;
  const merchantId = ctx.merchantId ?? (await upsertMerchant(e, claim, category));
  const itemLevel = cat.publish.level === 'item' && claim.tier === 'A' && claim.items.length > 0;
  const itemIds: Hex[] = [];
  if (itemLevel) {
    for (const it of claim.items) itemIds.push(await upsertItem(e, { merchantId, category, name: it.name, variant: it.variant, priceMinor: it.priceMinor ?? null }));
  } else {
    itemIds.push(await upsertItem(e, { merchantId, category, name: merchantLevelItem(category), priceMinor: claim.amountMinor || null }));
  }

  const { proof, ...publicClaim } = claim;
  const proofCid = await e.storage.putEncrypted({ claim: publicClaim, proof: proof ?? null });
  const id = newId('pu');
  try {
    await e.db.query(
      `INSERT INTO purchases (id, purchase_nullifier, reviewer_id, wallet, rail, tier, brand_id, merchant_id, category_id, item_ids, items,
         amount_minor, currency, purchased_on, proof_hash, proof_cid, status, simulated, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        id,
        claim.nullifier,
        reviewer,
        wallet,
        claim.rail,
        claim.tier,
        claim.brandId,
        merchantId,
        category,
        itemIds,
        claim.items.map((it, i) => ({ ...it, itemId: itemLevel ? itemIds[i] : itemIds[0] })),
        claim.amountMinor,
        claim.currency,
        claim.purchasedOn,
        claim.proofHash,
        proofCid,
        claim.status,
        claim.simulated,
        { ...claim.meta, orderRefHash: claim.nullifier },
      ],
    );
  } catch (err) {
    if (/purchases_same_day/.test(String(err))) {
      throw new UserError('You already proved a purchase at this merchant for the same amount today; one meal, one review.', 409, 'same_day');
    }
    throw err;
  }
  if (ctx.proofRequestId) {
    await e.db.query(`UPDATE proof_requests SET status = 'verified', purchase_id = $2, error = NULL, updated_at = now() WHERE id = $1`, [ctx.proofRequestId, id]);
  }
  await e.events.emit('purchase.proven', { purchaseId: id, rail: claim.rail, tier: claim.tier, brand: claim.brandId, merchant: claim.merchant.name, simulated: claim.simulated });
  return purchaseView(e, id);
}

export async function purchaseView(e: Engine, id: string): Promise<PurchaseView> {
  const p = await e.db.maybe<{
    id: string;
    rail: Rail;
    tier: 'A' | 'B';
    brand_id: string;
    category_id: string | null;
    merchant_id: Hex;
    merchant_name: string;
    items: { name: string; quantity?: number; priceMinor?: number; itemId?: Hex }[];
    item_ids: Hex[];
    amount_minor: string;
    currency: string;
    purchased_on: string | Date;
    status: string;
    simulated: boolean;
    reviewed: boolean;
    address: string | null;
    maps_url: string | null;
    google_place_id: string | null;
    payee_name: string | null;
    lat: number | null;
    lng: number | null;
  }>(
    `SELECT p.*, m.name AS merchant_name, m.address, m.maps_url, m.google_place_id, m.payee_name,
            ST_Y(m.geom::geometry) AS lat, ST_X(m.geom::geometry) AS lng,
            EXISTS (SELECT 1 FROM reviews r WHERE r.purchase_id = p.id) AS reviewed
       FROM purchases p JOIN merchants m ON m.id = p.merchant_id WHERE p.id = $1`,
    [id],
  );
  if (!p) throw new UserError('purchase not found', 404);
  const items = p.items.length
    ? p.items.map((it) => ({ itemId: (it.itemId ?? p.item_ids[0]) as Hex, name: it.name, quantity: it.quantity ?? 1, priceMinor: it.priceMinor ?? null }))
    : [{ itemId: p.item_ids[0]!, name: merchantLevelItem(p.category_id ?? 'food'), quantity: 1, priceMinor: null }];
  const purchasedOn = typeof p.purchased_on === 'string' ? p.purchased_on.slice(0, 10) : p.purchased_on.toISOString().slice(0, 10);
  let reviewable: PurchaseView['reviewable'] = { ok: true };
  if (p.reviewed) reviewable = { ok: false, reason: 'already reviewed' };
  else if (p.status === 'cancelled') reviewable = { ok: false, reason: 'purchase cancelled' };
  return {
    id: p.id,
    rail: p.rail,
    tier: p.tier,
    brandId: p.brand_id,
    category: p.category_id,
    merchantId: p.merchant_id,
    merchant: p.merchant_name,
    items,
    amountMinor: Number(p.amount_minor),
    currency: p.currency,
    purchasedOn,
    status: p.status,
    simulated: p.simulated,
    reviewed: p.reviewed,
    reviewable,
    place: {
      address: p.address,
      mapsUrl: p.maps_url,
      lat: p.lat === null ? null : Number(p.lat),
      lng: p.lng === null ? null : Number(p.lng),
      fromGoogle: !!p.google_place_id,
    },
    payeeName: p.payee_name,
  };
}

export async function listPurchases(e: Engine, wallet: string): Promise<PurchaseView[]> {
  const rows = await e.db.query<{ id: string }>('SELECT id FROM purchases WHERE wallet = $1 ORDER BY created_at DESC LIMIT 100', [wallet.toLowerCase()]);
  return Promise.all(rows.map((r) => purchaseView(e, r.id)));
}

export async function proofRequestStatus(e: Engine, id: string, wallet: string) {
  let pr = await e.db.maybe<ReclaimProofRequestRow>('SELECT * FROM proof_requests WHERE id = $1', [id]);
  if (!pr || pr.wallet !== wallet.toLowerCase()) throw new UserError('proof request not found', 404);
  if (pr.status === 'pending' && pr.meta?.delivery === 'fetch') {
    await fetchReclaimProofs(e, pr);
    pr = (await e.db.maybe<ReclaimProofRequestRow>('SELECT * FROM proof_requests WHERE id = $1', [id])) ?? pr;
  }
  return {
    id: pr.id,
    rail: pr.rail,
    status: pr.status,
    purchase: pr.purchase_id ? await purchaseView(e, pr.purchase_id) : null,
    error: pr.status === 'failed' ? pr.error : null,
  };
}

export function walletAddress(w: string): Address {
  return getAddress(w);
}
