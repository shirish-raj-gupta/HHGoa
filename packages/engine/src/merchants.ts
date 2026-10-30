import { promises as dns } from 'node:dns';
import {
  MERCHANT_CLAIM_METHOD,
  ReplyDocument,
  cosine,
  embedText,
  encodeMerchant,
  encodeReceiptQr,
  encodeReply,
  findPii,
  merchantIdFor,
  merchantReceiptTypedData,
  newId,
  typedDataFromJson,
  typedDataToJson,
  type MerchantClaimMethod,
  type MerchantReceipt,
} from '@receipts/core';
import { getAddress, keccak256, toBytes, verifyMessage, verifyTypedData, type Address, type Hex } from 'viem';
import { verifyTypedSignature } from './sig';
import { UserError, type Engine } from './context';
import { cityBox, cityFor, resolveNear } from './cities';
import { anchorCanWait } from './passing';
import { categoryForPlaceType, placeDetails, searchPlaces } from './google';
import { createPaymentLink, isTestMode, paymentLinkPayment, verifyRazorpayWebhook } from './razorpay';

const keccak256Hex = (s: string): Hex => keccak256(toBytes(s));

// The merchant dashboard: claim a listing, reply in public, learn what reviewers and agents say, issue signed
// receipts. Nothing here can delete, hide, edit or re-rank a review, and billing never reaches ranking.

interface Account {
  id: string;
  merchant_id: string;
  wallet: string;
  claim_method: string;
  plan: string;
  receipt_signer: string | null;
  eas_uid: string | null;
}

export async function accountsFor(e: Engine, wallet: string) {
  return e.db.query<Account & { name: string; city_id: string | null; score: number | null; verified_reviews: number }>(
    `SELECT a.*, m.name, m.city_id, m.score, m.verified_reviews FROM merchant_accounts a JOIN merchants m ON m.id = a.merchant_id WHERE a.wallet = $1`,
    [wallet.toLowerCase()],
  );
}

async function ownAccount(e: Engine, wallet: string, merchantId: string): Promise<Account> {
  const a = await e.db.maybe<Account>('SELECT * FROM merchant_accounts WHERE merchant_id = $1 AND wallet = $2', [merchantId, wallet.toLowerCase()]);
  if (!a) throw new UserError('You have not claimed this listing.', 403, 'not_owner');
  return a;
}

export async function searchListings(e: Engine, q: string, cityId?: string | null, near?: string | null) {
  // A typed city matches a city we know by name; otherwise search every city.
  if (!cityId && near?.trim()) cityId = (await e.db.maybe<{ id: string }>('SELECT id FROM cities WHERE lower(name) = lower($1) LIMIT 1', [near.trim()]))?.id ?? null;
  return e.db.query(
    `SELECT id, name, city_id, category_id, upi_vpa IS NOT NULL AS has_upi, claimed_by IS NOT NULL AS claimed, verified_reviews, simulated
       FROM merchants WHERE name ILIKE $1 AND ($2::text IS NULL OR city_id = $2) AND ($3::boolean OR NOT simulated)
      ORDER BY verified_reviews DESC, name LIMIT 25`,
    [`%${q.replace(/[%_]/g, '')}%`, cityId ?? null, e.env.DEMO_MODE],
  );
}

// Listings from Google Maps --------------------------------------------------------------------------------

/** Google Maps places for a business search in a city (configured, known, or typed: any city in India), each with
 *  the Receipts listing it already is, if any. */
export async function searchGoogle(e: Engine, q: string, where: { cityId?: string | null; near?: string | null } = {}) {
  if (q.trim().length < 2) return [];
  const box = (await cityBox(e, where.cityId)) ?? (where.near ? ((await resolveNear(e, where.near))?.box ?? null) : null);
  const places = await searchPlaces(e, { query: q, box, max: 8 });
  const listed = places.length
    ? await e.db.query<{ id: string; google_place_id: string; claimed_by: string | null }>(
        'SELECT id, google_place_id, claimed_by FROM merchants WHERE google_place_id = ANY($1::text[]) AND NOT simulated',
        [places.map((p) => p.placeId)],
      )
    : [];
  const byPlace = new Map(listed.map((l) => [l.google_place_id, l]));
  return places.map((place) => ({ place, listingId: byPlace.get(place.placeId)?.id ?? null, claimed: !!byPlace.get(place.placeId)?.claimed_by }));
}

/** The listing for a Google place: the one already on Receipts, or a new one made from Google's details, so a
 *  business can claim itself before its first verified review. */
export async function listingFromGoogle(e: Engine, placeId: string) {
  const place = await placeDetails(e, placeId);
  const cityId = await cityFor(e, place.lat, place.lng);
  const existing = await e.db.maybe<{ id: string }>('SELECT id FROM merchants WHERE google_place_id = $1 AND NOT simulated LIMIT 1', [place.placeId]);
  const id = existing?.id ?? merchantIdFor({ brandId: 'local', cityId, externalId: `google:${place.placeId}`, name: place.name });
  if (!existing) {
    await e.db.query(
      `INSERT INTO merchants (id, brand_id, city_id, category_id, name, address, geom, source, google_place_id, maps_url, google_synced_at)
       VALUES ($1, 'local', $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($7::float8, $6::float8), 4326)::geography, 'google', $8, $9, now())
       ON CONFLICT (id) DO NOTHING`,
      [id, cityId, categoryForPlaceType(place.primaryType), place.name, place.address, place.lat, place.lng, place.placeId, place.mapsUrl],
    );
  }
  return e.db.one(
    `SELECT id, name, city_id, category_id, upi_vpa IS NOT NULL AS has_upi, claimed_by IS NOT NULL AS claimed, verified_reviews, simulated FROM merchants WHERE id = $1`,
    [id],
  );
}
// Claiming ----------------------------------------------------------------------------------------------------

export async function startClaim(e: Engine, wallet: string, input: { merchantId: string; method: MerchantClaimMethod; domain?: string; gstin?: string }) {
  const merchant = await e.db.maybe<{ id: string; name: string; claimed_by: string | null; upi_vpa: string | null }>('SELECT id, name, claimed_by, upi_vpa FROM merchants WHERE id = $1', [input.merchantId]);
  if (!merchant) throw new UserError('listing not found', 404);
  if (merchant.claimed_by) throw new UserError('This listing is already claimed.', 409, 'claimed');
  const id = newId('mc');
  const challenge = input.method === 'domain' ? `receipts-verify=${newId('dns', 20).slice(4)}` : `RCPT-${id.slice(3, 9).toUpperCase()}`;
  let payUrl: string | null = null;
  let paymentLinkId: string | null = null;
  if (input.method === 'upi' && e.env.RAZORPAYX_KEY_ID && e.env.RAZORPAYX_KEY_SECRET) {
    try {
      const link = await createPaymentLink(e.env, {
        amountPaise: 100,
        description: `Receipts listing check ${challenge}`,
        referenceId: id,
        notes: { claim: id, merchant: merchant.id },
        callbackUrl: `${e.urls.merchant}/claim/${id}`,
      });
      payUrl = link.shortUrl;
      paymentLinkId = link.id;
    } catch (err) {
      e.log.warn('Razorpay payment link unavailable; the ₹1 check will need an admin approval', err);
    }
  }
  await e.db.query(`INSERT INTO merchant_claims (id, merchant_id, wallet, method, challenge, evidence) VALUES ($1, $2, $3, $4, $5, $6)`, [
    id,
    merchant.id,
    wallet.toLowerCase(),
    input.method,
    challenge,
    { domain: input.domain ?? null, gstin: input.gstin ?? null, payUrl, paymentLinkId },
  ]);
  const instructions: Record<MerchantClaimMethod, string> = {
    upi: payUrl
      ? `Pay ₹1 from the UPI ID your customers pay (${merchant.upi_vpa ?? 'your business UPI'}) using this link. The payer name must match the listing.${isTestMode(e.env) ? ' Razorpay is in test mode here, so no money moves: pay with the Razorpay test card 4100 2800 0000 1007 (any future expiry, any CVV) and any 4 to 10 digit OTP.' : ''}`
      : e.env.RAZORPAY_CLAIM_VPA
        ? `Pay ₹1 to ${e.env.RAZORPAY_CLAIM_VPA} with the note ${challenge} from the UPI ID your customers pay. A person at Receipts will review the payment and your ownership evidence.`
        : 'Automatic UPI ownership checks are not available here. Your claim is pending manual review by Receipts; no payment is required. A subscription payment does not verify business ownership.',
    domain: `Add a DNS TXT record on ${input.domain ?? 'your domain'} with the value ${challenge}, then press verify.`,
    gst: `We will match GSTIN ${input.gstin ?? ''} to "${merchant.name}".`,
    partner_portal: 'Prove your Swiggy or Zomato partner dashboard with Reclaim from the dashboard on your phone.',
  };
  return { claimId: id, method: input.method, challenge, payUrl, instructions: instructions[input.method] };
}

export async function checkClaim(e: Engine, wallet: string, claimId: string) {
  const c = await e.db.maybe<{ id: string; merchant_id: string; wallet: string; method: MerchantClaimMethod; challenge: string; status: string; evidence: Record<string, unknown> }>(
    'SELECT * FROM merchant_claims WHERE id = $1',
    [claimId],
  );
  if (!c || c.wallet !== wallet.toLowerCase()) throw new UserError('claim not found', 404);
  if (c.status === 'verified') return { claimId, status: 'verified' };
  const merchant = await e.db.one<{ name: string; upi_vpa: string | null }>('SELECT name, upi_vpa FROM merchants WHERE id = $1', [c.merchant_id]);
  let ok = false;
  let evidence: Record<string, unknown> = {};
  if (c.method === 'domain') {
    const domain = String(c.evidence.domain ?? '');
    const records = await dns.resolveTxt(domain).catch(() => [] as string[][]);
    ok = records.some((r) => r.join('').trim() === c.challenge);
    evidence = { domain };
  } else if (c.method === 'upi') {
    // Razorpay's webhook cannot reach a server on localhost, so ask Razorpay whether the ₹1 link was paid.
    if (c.evidence.paid !== true) {
      const paid = await paymentLinkPayment(e.env, { id: (c.evidence.paymentLinkId as string | undefined) ?? null, referenceId: c.id });
      if (paid.paid) {
        c.evidence = { ...c.evidence, paid: true, payerVpa: paid.payerVpa };
        await e.db.query(`UPDATE merchant_claims SET evidence = evidence || $2::jsonb WHERE id = $1`, [c.id, JSON.stringify({ paid: true, payerVpa: paid.payerVpa })]);
      }
    }
    ok = c.evidence.paid === true && (!merchant.upi_vpa || c.evidence.payerVpa === merchant.upi_vpa || nameMatches(String(c.evidence.payerName ?? ''), merchant.name));
    evidence = { payerVpa: c.evidence.payerVpa, payerName: c.evidence.payerName };
  } else if (c.method === 'gst') {
    if (!e.env.GST_API_URL) throw new UserError('GST verification is not configured on this server.', 400, 'not_configured');
    const res = await fetch(`${e.env.GST_API_URL.replace(/\/$/, '')}/${encodeURIComponent(String(c.evidence.gstin))}`, {
      headers: e.env.GST_API_KEY ? { authorization: `Bearer ${e.env.GST_API_KEY}` } : {},
    });
    const data = (await res.json().catch(() => ({}))) as { legalName?: string; tradeName?: string; lgnm?: string; tradeNam?: string; status?: string; sts?: string };
    const names = [data.legalName, data.tradeName, data.lgnm, data.tradeNam].filter(Boolean) as string[];
    ok = names.some((n) => nameMatches(n, merchant.name)) && !/cancel/i.test(String(data.status ?? data.sts ?? ''));
    evidence = { gstin: c.evidence.gstin, names };
  }
  if (!ok) return { claimId, status: 'pending' };
  return completeClaim(e, c, evidence);
}

function nameMatches(a: string, b: string): boolean {
  return cosine(embedText(a), embedText(b)) >= 0.6;
}

/** Razorpay calls this when the ₹1 payment link is paid; the payer VPA and name are the evidence. */
export async function handleRazorpayWebhook(e: Engine, rawBody: string, signature: string | undefined) {
  if (!verifyRazorpayWebhook(rawBody, signature, e.env.RAZORPAY_WEBHOOK_SECRET)) throw new UserError('bad signature', 401);
  const event = JSON.parse(rawBody) as {
    event: string;
    payload?: { payment_link?: { entity?: { reference_id?: string } }; payment?: { entity?: { vpa?: string; notes?: Record<string, string>; email?: string; contact?: string } } };
  };
  if (event.event !== 'payment_link.paid') return { ignored: event.event };
  const claimId = event.payload?.payment_link?.entity?.reference_id;
  const payment = event.payload?.payment?.entity;
  if (!claimId) return { ignored: 'no reference' };
  await e.db.query(`UPDATE merchant_claims SET evidence = evidence || $2::jsonb WHERE id = $1`, [claimId, JSON.stringify({ paid: true, payerVpa: payment?.vpa?.toLowerCase() ?? null })]);
  await e.events.emit('merchant.claim_paid', { claimId });
  return { claimId };
}

/** Demo / support: a human approves a claim (logged). */
export async function approveClaim(e: Engine, claimId: string, by: string) {
  const c = await e.db.maybe<{ id: string; merchant_id: string; wallet: string; method: MerchantClaimMethod; challenge: string }>('SELECT * FROM merchant_claims WHERE id = $1', [claimId]);
  if (!c) throw new UserError('claim not found', 404);
  return completeClaim(e, c, { approvedBy: by });
}

async function completeClaim(e: Engine, c: { id: string; merchant_id: string; wallet: string; method: MerchantClaimMethod; challenge: string }, evidence: Record<string, unknown>) {
  const evidenceHash = keccak256(toBytes(JSON.stringify({ claim: c.id, method: c.method, challenge: c.challenge, ...evidence })));
  let easUid: Hex | null = null;
  if (e.chain.canOperate) {
    // A claim stands without its attestation: if the operator is out of gas or Base does not answer, it completes
    // off-chain (no "on-chain" tag) rather than leaving the business waiting. A revert still fails.
    try {
      const res = await e.chain.attestAsOperator('merchant', encodeMerchant({ merchantId: c.merchant_id as Hex, claimMethod: MERCHANT_CLAIM_METHOD[c.method], evidenceHash }), {
        recipient: getAddress(c.wallet),
      });
      easUid = res.uid;
    } catch (err) {
      if (!anchorCanWait(err)) throw err;
      e.log.warn('claim attestation skipped', err instanceof Error ? err.message.split('\n')[0] : String(err));
    }
  }
  const accountId = newId('ma');
  await e.db.tx(async (t) => {
    await t.query(
      `INSERT INTO merchant_accounts (id, merchant_id, wallet, claim_method, evidence_hash, eas_uid, receipt_signer) VALUES ($1, $2, $3, $4, $5, $6, $3)
       ON CONFLICT (merchant_id) DO NOTHING`,
      [accountId, c.merchant_id, c.wallet, c.method, evidenceHash, easUid],
    );
    await t.query('UPDATE merchants SET claimed_by = $2 WHERE id = $1', [c.merchant_id, accountId]);
    await t.query(`UPDATE merchant_claims SET status = 'verified', evidence = evidence || $2::jsonb WHERE id = $1`, [c.id, JSON.stringify(evidence)]);
  });
  await e.events.emit('merchant.claimed', { merchantId: c.merchant_id, method: c.method, easUid });
  return { claimId: c.id, status: 'verified', accountId, easUid, easUrl: e.chain.easUrl(easUid) };
}

// Replies -----------------------------------------------------------------------------------------------------

export async function prepareReply(e: Engine, wallet: string, input: { reviewId: string; text: string }) {
  const r = await e.db.maybe<{ id: string; eas_uid: Hex | null; merchant_id: string; status: string }>('SELECT id, eas_uid, merchant_id, status FROM reviews WHERE id = $1 OR eas_uid = $1', [
    input.reviewId,
  ]);
  if (!r || r.status !== 'active') throw new UserError('review not found', 404);
  await ownAccount(e, wallet, r.merchant_id);
  const text = input.text.trim();
  if (text.length < 2 || text.length > 1000) throw new UserError('Replies are 2 to 1000 characters.', 422);
  if (findPii(text).length) throw new UserError('Replies are public: remove phone numbers, emails and UPI IDs.', 422, 'pii');
  const today = await e.db.one<{ n: string }>(`SELECT count(*)::text AS n FROM merchant_replies WHERE merchant_id = $1 AND created_at > now() - interval '1 day'`, [r.merchant_id]);
  if (Number(today.n) >= 30) throw new UserError('Reply limit reached for today.', 429, 'rate_limited');
  const merchant = await e.db.one<{ name: string }>('SELECT name FROM merchants WHERE id = $1', [r.merchant_id]);
  const doc = ReplyDocument.parse({ schema: 'receipts.reply.v1', reviewUid: r.eas_uid ?? r.id, merchantId: r.merchant_id, merchant: merchant.name, text });
  const { cid } = await e.storage.putJson(doc);
  const id = newId('rp');
  let signing: { kind: 'eas'; typedData: string } | { kind: 'message'; message: string };
  let stored: Record<string, unknown>;
  if (r.eas_uid && e.chain.enabled) {
    const { typedData, request, deadline } = await e.chain.delegationTypedData('reply', encodeReply(cid), { attester: getAddress(wallet), refUID: r.eas_uid });
    const json = typedDataToJson(typedData);
    signing = { kind: 'eas', typedData: json };
    stored = { kind: 'eas', json, request: JSON.parse(JSON.stringify(request, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))), deadline: deadline.toString() };
  } else {
    const message = `Receipts reply ${cid}`;
    signing = { kind: 'message', message };
    stored = { kind: 'message', message };
  }
  await e.db.query(`INSERT INTO merchant_replies (id, review_id, merchant_id, text, content_cid, status, signing) VALUES ($1, $2, $3, $4, $5, 'pending', $6)`, [
    id,
    r.id,
    r.merchant_id,
    text,
    cid,
    stored,
  ]);
  return { replyId: id, signing };
}

export async function publishReply(e: Engine, wallet: string, replyId: string, input: { signature: Hex }) {
  const reply = await e.db.maybe<{
    id: string;
    review_id: string;
    merchant_id: string;
    status: string;
    content_cid: string;
    signing: { kind: 'eas'; json: string; request: Record<string, string | boolean>; deadline: string } | { kind: 'message'; message: string } | null;
  }>('SELECT * FROM merchant_replies WHERE id = $1', [replyId]);
  if (!reply || reply.status !== 'pending') throw new UserError('reply not found', 404);
  await ownAccount(e, wallet, reply.merchant_id);
  const stored = reply.signing;
  if (!stored) throw new UserError('Prepare the reply again.', 409, 'expired');
  const attester = getAddress(wallet);
  let uid: Hex | null = null;
  let tx: Hex | null = null;
  if (stored.kind === 'eas') {
    const td = typedDataFromJson(stored.json);
    if (!(await verifyTypedSignature(attester, td, input.signature))) throw new UserError('Signature does not match.', 401, 'bad_signature');
    const req = stored.request;
    // A reply stands without its attestation: if the relayer is out of gas or Base does not answer, it is posted
    // unanchored rather than lost. A revert still fails.
    try {
      const res = await e.chain.submitDelegated({
        schema: 'reply',
        request: {
          schema: req.schema as Hex,
          recipient: req.recipient as Address,
          expirationTime: BigInt(req.expirationTime as string),
          revocable: req.revocable as boolean,
          refUID: req.refUID as Hex,
          data: req.data as Hex,
          value: BigInt(req.value as string),
        },
        attester,
        deadline: BigInt(stored.deadline),
        signature: input.signature,
      });
      uid = res.uid;
      tx = res.txHash;
    } catch (err) {
      if (!anchorCanWait(err)) throw err;
      e.log.warn('reply attestation skipped', err instanceof Error ? err.message.split('\n')[0] : String(err));
    }
  } else if (!(await verifyMessage({ address: attester, message: stored.message, signature: input.signature }))) {
    throw new UserError('Signature does not match.', 401, 'bad_signature');
  }
  await e.db.query(`UPDATE merchant_replies SET status = 'published', eas_uid = $2, tx_hash = $3, signing = NULL WHERE id = $1`, [replyId, uid, tx]);
  e.storage.pin(reply.content_cid).catch(() => undefined);
  await e.events.emit('merchant.replied', { replyId, reviewId: reply.review_id, uid, tx });
  return { replyId, uid, txHash: tx, easUrl: e.chain.easUrl(uid), explorerTx: e.chain.explorerTx(tx) };
}

// Signed receipts (rail 5) ------------------------------------------------------------------------------------

/** The dashboard signs receipts with the merchant wallet in the browser; we check and record them. */
export async function recordReceipt(e: Engine, wallet: string, receipt: MerchantReceipt) {
  const account = await ownAccount(e, wallet, receipt.merchantId);
  const ok = await verifyTypedData({ address: getAddress(account.receipt_signer ?? account.wallet), ...merchantReceiptTypedData(receipt), signature: receipt.signature });
  if (!ok) throw new UserError('Receipt signature does not match the merchant signer.', 401, 'bad_signature');
  const payload = encodeReceiptQr(receipt);
  const hash = keccak256Hex(payload);
  // The QR carries a short code for the stored receipt: the whole signed receipt is about 600 characters, too dense
  // for a camera to read off a screen. Claiming checks the signature exactly as before.
  const row = await e.db.one<{ id: string }>(
    `INSERT INTO merchant_receipts (id, merchant_id, receipt_id, receipt_hash, items, amount_minor, currency, issued_at, signature, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8), $9, $10)
     ON CONFLICT (receipt_hash) DO UPDATE SET payload = COALESCE(merchant_receipts.payload, EXCLUDED.payload) RETURNING id`,
    [newId('mr'), receipt.merchantId, receipt.receiptId, hash, receipt.items, receipt.amountMinor, receipt.currency, receipt.issuedAt, receipt.signature, payload],
  );
  return { qr: `${e.urls.web}/scan?c=${row.id}`, payload };
}

/** The signed receipt behind a bill QR's short code. */
export async function receiptPayload(e: Engine, code: string): Promise<string> {
  const row = await e.db.maybe<{ payload: string | null }>('SELECT payload FROM merchant_receipts WHERE id = $1', [code]);
  if (!row?.payload) throw new UserError('That receipt code is not on Receipts. Scan the QR on your bill again.', 404, 'unknown_receipt');
  return row.payload;
}

// Insights, badge, moderation ---------------------------------------------------------------------------------

export async function insights(e: Engine, wallet: string, merchantId: string) {
  const account = await ownAccount(e, wallet, merchantId);
  const [merchant, weekly, aspects, rails, questions, flags, reviews, receipts] = await Promise.all([
    e.db.one('SELECT id, name, score, verified_reviews, durability, city_id, address, maps_url FROM merchants WHERE id = $1', [merchantId]),
    e.db.query(
      `SELECT date_trunc('week', created_at)::date AS week, count(*)::int AS reviews, round(avg(rating)::numeric, 2)::float8 AS avg_rating
         FROM reviews WHERE merchant_id = $1 AND status = 'active' GROUP BY 1 ORDER BY 1`,
      [merchantId],
    ),
    e.db.query(
      `SELECT key AS aspect, round(avg(value::float8)::numeric, 2)::float8 AS avg, count(*)::int AS mentions
         FROM reviews r, jsonb_each_text(r.aspects) WHERE r.merchant_id = $1 AND r.status = 'active' GROUP BY key ORDER BY mentions DESC`,
      [merchantId],
    ),
    e.db.query(`SELECT rail, count(*)::int AS reviews FROM reviews WHERE merchant_id = $1 AND status = 'active' GROUP BY rail`, [merchantId]),
    e.db.query(
      `SELECT a.query, a.created_at, a.payment_method FROM answers a WHERE a.response::text LIKE '%' || $1 || '%' ORDER BY a.created_at DESC LIMIT 25`,
      [merchantId],
    ),
    e.db.query(`SELECT id, signal, status, created_at, evidence->'members' AS members FROM flags WHERE merchant_id = $1 OR id IN (
                  SELECT f.id FROM flags f WHERE f.signal = 'review_ring' AND EXISTS (SELECT 1 FROM reviews r WHERE r.merchant_id = $1 AND r.reviewer_id = ANY(f.reviewer_ids)))
                ORDER BY created_at DESC LIMIT 10`, [merchantId]),
    e.db.query(
      `SELECT r.id, r.eas_uid, r.rating, r.claims, r.summary_en, r.created_at, r.rail, r.simulated, i.canonical_name AS item,
              (SELECT text FROM merchant_replies mr WHERE mr.review_id = r.id AND mr.status = 'published' LIMIT 1) AS reply
         FROM reviews r JOIN items i ON i.id = r.item_id WHERE r.merchant_id = $1 AND r.status = 'active' AND r.publish_at <= now()
        ORDER BY r.created_at DESC LIMIT 50`,
      [merchantId],
    ),
    e.db.one(`SELECT count(*)::int AS issued, count(claimed_by)::int AS claimed FROM merchant_receipts WHERE merchant_id = $1`, [merchantId]),
  ]);
  return { account: { plan: account.plan, claimMethod: account.claim_method, easUid: account.eas_uid }, merchant, weekly, aspects, rails, questions, alerts: flags, reviews, receipts };
}

export async function badge(e: Engine, merchantId: string) {
  const m = await e.db.maybe<{ id: string; name: string; score: number | null; verified_reviews: number; claimed_by: string | null; durability: number | null }>(
    'SELECT id, name, score, verified_reviews, claimed_by, durability FROM merchants WHERE id = $1',
    [merchantId],
  );
  if (!m) throw new UserError('merchant not found', 404);
  return {
    merchantId: m.id,
    name: m.name,
    score: m.score === null ? null : Math.round(Number(m.score) * 10) / 10,
    verifiedReviews: m.verified_reviews,
    claimed: !!m.claimed_by,
    durability: m.durability,
    url: `${e.urls.web}/m/${m.id}`,
    label: m.verified_reviews >= 3 ? 'Verified by Receipts' : 'Not enough receipts yet',
  };
}

/** Merchants may flag a review only for unlawful content or personal data; a human decides and it is logged. */
export async function flagReview(e: Engine, wallet: string, input: { reviewId: string; reason: 'unlawful' | 'personal_data'; note?: string }) {
  const r = await e.db.maybe<{ id: string; merchant_id: string }>('SELECT id, merchant_id FROM reviews WHERE id = $1 OR eas_uid = $1', [input.reviewId]);
  if (!r) throw new UserError('review not found', 404);
  await ownAccount(e, wallet, r.merchant_id);
  const id = newId('fl');
  await e.db.query(`INSERT INTO flags (id, signal, merchant_id, evidence, status) VALUES ($1, 'moderation', $2, $3, 'open')`, [
    id,
    r.merchant_id,
    { reviewId: r.id, reason: input.reason, note: input.note?.slice(0, 500) ?? null, by: wallet.toLowerCase() },
  ]);
  return { flagId: id, status: 'open', note: 'A human moderator will look at it. Merchants cannot hide or edit reviews.' };
}
