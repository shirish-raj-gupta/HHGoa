import { anchorCanWait } from './passing';
import {
  PAID_REVIEW_DISCLOSURE,
  RAIL_INFO,
  RAIL_NUMBER,
  ReviewDocument,
  StructuredReview,
  TIER_NUMBER,
  cidOfBytes,
  decodeReview,
  embedText,
  encodeReview,
  newId,
  proofHashOf,
  reviewTextProblems,
  toPgVector,
  toPurchaseDay,
  typedDataFromJson,
  typedDataToJson,
  weekOf,
  type Rail,
} from '@receipts/core';
import { getCategory } from '@receipts/categories';
import { getAddress, verifyMessage, type Address, type Hex } from 'viem';
import { verifyTypedSignature } from './sig';
import { UserError, receiptUrl, type Engine } from './context';
import { requireHuman, type ReviewerRow } from './identity';
import { scheduleFollowups } from './followups';
import { purchaseView, type PurchaseView } from './proofs';
import { structureTranscript, type StructureResult } from './structure';
import { VoiceUnavailable, transcribe } from './voice';

// The review flow: draft -> voice or text -> structured card -> finalize (CID + typed data) -> the reviewer signs
// -> the relayer submits attestByDelegation and pays gas -> receipt page. A review exists only after the proof
// verified, the author is a registered human, and the reviewer signed the final card.

interface DraftRow {
  id: string;
  purchase_id: string;
  wallet: string;
  reviewer_id: string;
  item_id: Hex | null;
  audio_id: string | null;
  transcript: string | null;
  language: string | null;
  structured: (StructureResult & { review: StructuredReview }) | null;
  document: ReviewDocument | null;
  content_cid: string | null;
  typed_data: { kind: 'eas'; json: string; request: unknown; deadline: string } | { kind: 'message'; message: string } | null;
  status: string;
}

export interface ReviewCard {
  draftId: string;
  status: string;
  purchase: PurchaseView;
  transcript: string | null;
  rating: number | null;
  item: { itemId: Hex; name: string } | null;
  itemChoices: { itemId: Hex; name: string }[];
  aspects: Record<string, number>;
  claims: string[];
  summary_en: string | null;
  language: string | null;
  warnings: string[];
  generatedBy: 'llm' | 'rules' | null;
  prompt: { en: string; hi: string };
}

async function loadDraft(e: Engine, wallet: string, draftId: string): Promise<DraftRow> {
  const d = await e.db.maybe<DraftRow>('SELECT * FROM review_drafts WHERE id = $1', [draftId]);
  if (!d || d.wallet !== wallet.toLowerCase()) throw new UserError('draft not found', 404);
  return d;
}

async function card(e: Engine, d: DraftRow): Promise<ReviewCard> {
  const purchase = await purchaseView(e, d.purchase_id);
  const cat = getCategory(purchase.category ?? 'food');
  const s = d.structured;
  const chosen = d.item_id ?? s?.itemId ?? null;
  const item = chosen ? purchase.items.find((i) => i.itemId === chosen) ?? null : null;
  return {
    draftId: d.id,
    status: d.status,
    purchase,
    transcript: d.transcript,
    rating: s?.review.rating ?? null,
    item: item ? { itemId: item.itemId, name: item.name } : null,
    itemChoices: purchase.items.map((i) => ({ itemId: i.itemId, name: i.name })),
    aspects: s?.review.aspects ?? {},
    claims: s?.review.claims ?? [],
    summary_en: s?.review.summary_en ?? null,
    language: s?.review.language ?? d.language,
    warnings: s?.warnings ?? [],
    generatedBy: s?.generatedBy ?? null,
    prompt: cat.prompt,
  };
}

export async function createDraft(e: Engine, wallet: string, input: { purchaseId: string; itemId?: Hex }): Promise<ReviewCard> {
  const reviewer = await requireHuman(e, wallet);
  const purchase = await purchaseView(e, input.purchaseId);
  const owner = await e.db.one<{ wallet: string; reviewer_id: string | null }>('SELECT wallet, reviewer_id FROM purchases WHERE id = $1', [input.purchaseId]);
  if (owner.wallet !== wallet.toLowerCase()) throw new UserError('This purchase was proven by another wallet.', 403, 'not_owner');
  if (!purchase.reviewable.ok) throw new UserError(`This purchase can't be reviewed: ${purchase.reviewable.reason}.`, 409, 'not_reviewable');
  if (!owner.reviewer_id) await e.db.query('UPDATE purchases SET reviewer_id = $2 WHERE id = $1', [input.purchaseId, reviewer.id]);
  if (input.itemId && !purchase.items.some((i) => i.itemId === input.itemId)) throw new UserError('That item is not in this purchase.', 422, 'item_not_in_purchase');
  const existing = await e.db.maybe<DraftRow>(`SELECT * FROM review_drafts WHERE purchase_id = $1 AND status <> 'published' ORDER BY created_at DESC LIMIT 1`, [input.purchaseId]);
  if (existing) return card(e, existing);
  const id = newId('dr');
  const d = await e.db.one<DraftRow>(
    `INSERT INTO review_drafts (id, purchase_id, wallet, reviewer_id, item_id, status) VALUES ($1, $2, $3, $4, $5, 'open') RETURNING *`,
    [id, input.purchaseId, wallet.toLowerCase(), reviewer.id, input.itemId ?? null],
  );
  return card(e, d);
}

async function structureDraft(e: Engine, d: DraftRow, transcript: string, languageHint: string | null): Promise<ReviewCard> {
  const purchase = await purchaseView(e, d.purchase_id);
  const result = await structureTranscript(e, {
    transcript,
    category: purchase.category ?? 'food',
    merchant: purchase.merchant,
    items: purchase.items.map((i) => ({ itemId: i.itemId, name: i.name })),
    tier: purchase.tier,
    languageHint,
  });
  const updated = await e.db.one<DraftRow>(
    `UPDATE review_drafts SET transcript = $2, language = $3, structured = $4, item_id = COALESCE(item_id, $5), status = 'structured', updated_at = now()
      WHERE id = $1 RETURNING *`,
    [d.id, transcript, result.review.language, result, result.itemId],
  );
  return card(e, updated);
}

/** A 15-second voice note: stored encrypted (deleted after 7 days), transcribed, structured. */
export async function addVoice(e: Engine, wallet: string, draftId: string, input: { audio: Uint8Array; mime: string; languageHint?: string | null }): Promise<ReviewCard> {
  const d = await loadDraft(e, wallet, draftId);
  if (d.status === 'published') throw new UserError('already published', 409);
  if (input.audio.byteLength > 2_000_000) throw new UserError('Voice notes are capped at 15 seconds.', 413, 'too_long');
  const audioId = newId('au');
  await e.db.query(
    `INSERT INTO audio_objects (id, wallet, mime, byte_length, ciphertext, delete_after) VALUES ($1, $2, $3, $4, $5, now() + interval '7 days')`,
    [audioId, wallet.toLowerCase(), input.mime, input.audio.byteLength, e.storage.encryptBytes(input.audio)],
  );
  await e.db.query('UPDATE review_drafts SET audio_id = $2 WHERE id = $1', [d.id, audioId]);
  const purchase = await purchaseView(e, d.purchase_id);
  try {
    const t = await transcribe(e.env, input.audio, {
      mime: input.mime,
      languageHint: input.languageHint,
      keyterms: [purchase.merchant, ...purchase.items.map((i) => i.name)],
    });
    if (!t.text) throw new UserError('Could not hear anything in that note. Try again a little closer to the mic.', 422, 'empty_audio');
    return structureDraft(e, d, t.text, t.language);
  } catch (err) {
    if (err instanceof VoiceUnavailable) throw new UserError(err.message, 400, 'voice_unavailable');
    throw err;
  }
}

/** The text fallback (typed, or dictated with a voice keyboard such as Wispr Flow). */
export async function addText(e: Engine, wallet: string, draftId: string, input: { text: string; language?: string | null }): Promise<ReviewCard> {
  const d = await loadDraft(e, wallet, draftId);
  if (d.status === 'published') throw new UserError('already published', 409);
  const text = input.text.trim();
  if (text.length < 8) throw new UserError('Say a little more about it.', 422, 'too_short');
  return structureDraft(e, d, text.slice(0, 2000), input.language ?? null);
}

export async function getDraft(e: Engine, wallet: string, draftId: string): Promise<ReviewCard> {
  return card(e, await loadDraft(e, wallet, draftId));
}

function publishedDate(purchasedOn: string, granularity: 'day' | 'week'): string {
  return granularity === 'week' ? weekOf(purchasedOn) : purchasedOn;
}

/** Build the final review JSON and what the reviewer signs. The reviewer may change the stars, the item and drop claims. */
export async function finalizeDraft(
  e: Engine,
  wallet: string,
  draftId: string,
  edits: { rating?: number; itemId?: Hex; claims?: string[] } = {},
): Promise<{ draftId: string; document: ReviewDocument; contentCid: string; signing: { kind: 'eas'; typedData: string } | { kind: 'message'; message: string } }> {
  const d = await loadDraft(e, wallet, draftId);
  if (!d.structured) throw new UserError('Record or type the review first.', 409, 'not_structured');
  if (d.status === 'published') throw new UserError('already published', 409);
  const reviewer = await requireHuman(e, wallet);
  const purchase = await purchaseView(e, d.purchase_id);
  const cat = getCategory(purchase.category ?? 'food');
  const s = d.structured;

  const rating = edits.rating !== undefined ? Math.round(edits.rating) : s.review.rating;
  if (rating < 1 || rating > 5) throw new UserError('Rating must be 1 to 5.', 422);
  const itemId = edits.itemId ?? d.item_id ?? s.itemId;
  const item = purchase.items.find((i) => i.itemId === itemId);
  if (!item) {
    throw new UserError(
      s.itemMatch === 'not_in_order' ? `"${s.review.item}" is not in the proven order. Pick an item from it or re-record.` : 'Pick the item you are reviewing.',
      422,
      'item_not_in_purchase',
    );
  }
  const claims = edits.claims ? edits.claims.filter((c) => s.review.claims.includes(c)) : s.review.claims;

  const doc = ReviewDocument.parse({
    schema: 'receipts.review.v1',
    category: purchase.category ?? 'food',
    itemId: item.itemId,
    item: item.name,
    merchantId: purchase.merchantId,
    merchant: purchase.merchant,
    brand: purchase.brandId,
    rating,
    aspects: s.review.aspects,
    claims,
    diet: s.review.diet,
    language: s.review.language,
    summary_en: s.review.summary_en,
    transcript: d.transcript,
    rail: purchase.rail,
    tier: purchase.tier,
    purchased: publishedDate(purchase.purchasedOn, cat.publish.date_granularity),
    reviewerId: reviewer.id,
    simulated: purchase.simulated,
  });
  const problems = reviewTextProblems(doc, { bookingRefs: cat.publish.redact_booking_refs });
  if (problems.length) throw new UserError(`Remove personal details before publishing (${problems.join('; ')}).`, 422, 'pii');

  const { cid } = await e.storage.putJson(doc);
  const p = await e.db.one<{ purchase_nullifier: Hex; proof_hash: Hex }>('SELECT purchase_nullifier, proof_hash FROM purchases WHERE id = $1', [purchase.id]);
  let signing: { kind: 'eas'; typedData: string } | { kind: 'message'; message: string };
  let stored: DraftRow['typed_data'];
  if (e.chain.enabled) {
    const data = encodeReview({
      itemId: item.itemId,
      rating,
      purchaseNullifier: p.purchase_nullifier,
      reviewerId: reviewer.id,
      proofHash: p.proof_hash,
      contentCID: cid,
      purchaseDay: toPurchaseDay(purchase.purchasedOn),
      rail: RAIL_NUMBER[purchase.rail],
      tier: TIER_NUMBER[purchase.tier],
      brand: purchase.brandId,
    });
    // Seven days to land on-chain: if the relayer is out of gas or Base does not answer, the anchor-pending job retries.
    const { typedData, request, deadline } = await e.chain.delegationTypedData('review', data, { attester: getAddress(wallet), ttlSeconds: 7 * 86_400 });
    const json = typedDataToJson(typedData);
    stored = { kind: 'eas', json, request: JSON.parse(JSON.stringify(request, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))), deadline: deadline.toString() };
    signing = { kind: 'eas', typedData: json };
  } else {
    const message = `Receipts review ${cid}\nI paid for this and wrote this review.`;
    stored = { kind: 'message', message };
    signing = { kind: 'message', message };
  }
  await e.db.query(`UPDATE review_drafts SET document = $2, content_cid = $3, typed_data = $4, item_id = $5, status = 'ready', updated_at = now() WHERE id = $1`, [
    d.id,
    doc,
    cid,
    stored,
    item.itemId,
  ]);
  return { draftId: d.id, document: doc, contentCid: cid, signing };
}

function publishAt(cat: ReturnType<typeof getCategory>, purchase: PurchaseView, meta: Record<string, unknown>, demo: boolean): Date {
  const now = Date.now();
  switch (cat.publish.delay) {
    case 'random_0_24h':
      return new Date(demo ? now : now + Math.floor(Math.random() * 24 * 3_600_000));
    case 'after_travel_date': {
      const travel = typeof meta.travelDate === 'string' ? Date.parse(`${meta.travelDate}T23:59:59Z`) : NaN;
      return new Date(Number.isFinite(travel) && travel > now ? travel : now);
    }
    case 'until_move_out_or_90d':
      return new Date(demo ? now : now + 90 * 86_400_000);
    default:
      return new Date(now);
  }
}

export interface PublishResult {
  reviewId: string;
  uid: Hex | null;
  txHash: Hex | null;
  receiptUrl: string;
  anchored: boolean;
  /** Published, and the signed attestation waits for the anchor-pending job. */
  anchorPending: boolean;
  status: string;
  explorerTx: string | null;
}

/** Verify the signature, re-run every check, attest through the relayer, and store the review. */
export async function publishDraft(e: Engine, wallet: string, draftId: string, input: { signature: Hex }): Promise<PublishResult> {
  const d = await loadDraft(e, wallet, draftId);
  if (d.status === 'published') throw new UserError('already published', 409);
  if (d.status !== 'ready' || !d.document || !d.content_cid || !d.typed_data) throw new UserError('Finalize the card before signing.', 409, 'not_ready');
  const reviewer: ReviewerRow = await requireHuman(e, wallet);
  const purchase = await purchaseView(e, d.purchase_id);
  const cat = getCategory(purchase.category ?? 'food');
  const p = await e.db.one<{ wallet: string; purchase_nullifier: Hex; status: string; meta: Record<string, unknown> }>(
    'SELECT wallet, purchase_nullifier, status, meta FROM purchases WHERE id = $1',
    [purchase.id],
  );

  // 1. The proof verified on its rail and is bound to this wallet.
  if (p.wallet !== wallet.toLowerCase()) throw new UserError('The proof is bound to a different wallet.', 403, 'wallet_mismatch');
  // 2. The wallet belongs to a registered human (requireHuman above; the resolver checks it on-chain too).
  // 3. The purchase nullifier has never been used.
  if (await e.db.maybe('SELECT 1 FROM reviews WHERE purchase_id = $1', [purchase.id])) throw new UserError('This purchase is already reviewed.', 409, 'nullifier_used');
  if (p.status === 'cancelled') throw new UserError('This purchase was cancelled.', 409, 'cancelled');
  // 4. Recent enough for its category.
  const ageDays = (Date.now() - Date.parse(`${purchase.purchasedOn}T00:00:00Z`)) / 86_400_000;
  if (ageDays > cat.recency_days && !purchase.simulated) throw new UserError('This purchase is too old to review.', 422, 'too_old');
  // 5. The item is in the proven purchase (checked at finalize; re-check the stored document).
  const doc = d.document;
  if (!purchase.items.some((i) => i.itemId === doc.itemId)) throw new UserError('Item is not in the proven purchase.', 422, 'item_not_in_purchase');
  // 6. Schema and no phone numbers or email addresses.
  const recomputed = await cidOfBytes(new TextEncoder().encode((await e.storage.get(d.content_cid))!.bytes.toString('utf8')));
  if (recomputed !== d.content_cid) throw new UserError('Review content changed after finalizing.', 409, 'content_changed');
  if (reviewTextProblems(doc).length) throw new UserError('Remove personal details before publishing.', 422, 'pii');

  let uid: Hex | null = null;
  let txHash: Hex | null = null;
  let anchor: PendingAnchor | null = null;
  const attester = getAddress(wallet);
  if (d.typed_data.kind === 'eas') {
    const td = typedDataFromJson(d.typed_data.json);
    const ok = await verifyTypedSignature(attester, td, input.signature);
    if (!ok) throw new UserError('The signature does not match this wallet and card.', 401, 'bad_signature');
    const pending: PendingAnchor = { request: d.typed_data.request as Record<string, string | boolean>, attester, deadline: d.typed_data.deadline, signature: input.signature, attempts: 0 };
    try {
      const res = await submitAnchor(e, pending);
      uid = res.uid;
      txHash = res.txHash;
    } catch (err) {
      // The review is valid without the chain: publish it, keep the signed attestation and anchor it later. A revert
      // (the resolver refused it) is not passing, so that still fails the publish.
      if (!anchorCanWait(err)) throw err;
      e.log.warn('anchoring deferred', err instanceof Error ? err.message.split('\n')[0] : String(err));
      anchor = { ...pending, attempts: 1, lastError: err instanceof Error ? err.message.split('\n')[0]!.slice(0, 200) : String(err) };
    }
  } else {
    const ok = await verifyMessage({ address: attester, message: d.typed_data.message, signature: input.signature });
    if (!ok) throw new UserError('The signature does not match this wallet.', 401, 'bad_signature');
  }

  const held = doc.claims.some((c) => /\b(fake|counterfeit|duplicate|first copy)\b/i.test(c)) && cat.moderation.fake_product_claims === 'hold_for_review';
  const allegation = d.structured?.review.personal_allegation && cat.moderation.personal_allegations === 'hold_for_review';
  const status = held || allegation ? 'held' : 'active';
  const reviewId = newId('r');
  await e.db.tx(async (t) => {
    if (status === 'active') {
      await t.query(`UPDATE reviews SET status = 'superseded' WHERE reviewer_id = $1 AND item_id = $2 AND status = 'active'`, [reviewer.id, doc.itemId]);
    }
    await t.query(
      `INSERT INTO reviews (id, eas_uid, chain_id, tx_hash, reviewer_id, purchase_id, item_id, merchant_id, category_id, rating, aspects, claims,
         summary_en, diet, language, content_cid, rail, tier, status, publish_at, embedding, simulated, anchor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::vector, $22, $23)`,
      [
        reviewId,
        uid,
        uid ? e.chain.chainId : null,
        txHash,
        reviewer.id,
        purchase.id,
        doc.itemId,
        purchase.merchantId,
        doc.category,
        doc.rating,
        doc.aspects,
        JSON.stringify(doc.claims),
        doc.summary_en,
        doc.diet,
        doc.language,
        d.content_cid,
        purchase.rail,
        purchase.tier,
        status,
        publishAt(cat, purchase, p.meta, e.env.DEMO_MODE),
        toPgVector(embedText(`${doc.claims.join('. ')} ${doc.summary_en}`)),
        purchase.simulated,
        anchor,
      ],
    );
    await t.query(`UPDATE review_drafts SET status = 'published', updated_at = now() WHERE id = $1`, [d.id]);
  });

  e.storage.pin(d.content_cid).catch(() => undefined);
  await scheduleFollowups(e, reviewId);
  if (uid) void mintCredentialIfFirst(e, reviewer);
  await e.events.emit('review.published', {
    reviewId,
    uid,
    txHash,
    rating: doc.rating,
    item: doc.item,
    merchant: doc.merchant,
    category: doc.category,
    rail: purchase.rail,
    status,
    simulated: purchase.simulated,
  });
  return { reviewId, uid, txHash, receiptUrl: receiptUrl(e, uid ?? reviewId), anchored: !!uid, anchorPending: !!anchor, status, explorerTx: e.chain.explorerTx(txHash) };
}

// Anchoring later -------------------------------------------------------------------------------------------------

interface PendingAnchor {
  request: Record<string, string | boolean>;
  attester: Address;
  deadline: string;
  signature: Hex;
  attempts: number;
  lastError?: string;
}

function submitAnchor(e: Engine, a: PendingAnchor) {
  const req = a.request;
  return e.chain.submitDelegated({
    schema: 'review',
    request: {
      schema: req.schema as Hex,
      recipient: req.recipient as Address,
      expirationTime: BigInt(req.expirationTime as string),
      revocable: req.revocable as boolean,
      refUID: req.refUID as Hex,
      data: req.data as Hex,
      value: BigInt(req.value as string),
    },
    attester: a.attester,
    deadline: BigInt(a.deadline),
    signature: a.signature,
  });
}

/** The anchor-pending job: submit signed attestations that could not land at publish time, until their deadline. */
export async function anchorPending(e: Engine): Promise<{ anchored: number; waiting: number; expired: number }> {
  const rows = await e.db.query<{ id: string; anchor: PendingAnchor }>(`SELECT id, anchor FROM reviews WHERE eas_uid IS NULL AND anchor IS NOT NULL ORDER BY created_at LIMIT 10`);
  let anchored = 0;
  let expired = 0;
  for (const r of rows) {
    if (Number(r.anchor.deadline) * 1000 < Date.now()) {
      await e.db.query(`UPDATE reviews SET anchor = NULL WHERE id = $1`, [r.id]);
      e.log.warn(`review ${r.id}: its signed attestation expired before it could be anchored`);
      expired++;
      continue;
    }
    try {
      const res = await submitAnchor(e, r.anchor);
      await e.db.query(`UPDATE reviews SET eas_uid = $2, chain_id = $3, tx_hash = $4, anchor = NULL WHERE id = $1`, [r.id, res.uid, e.chain.chainId, res.txHash]);
      anchored++;
    } catch (err) {
      const lastError = err instanceof Error ? err.message.split('\n')[0]!.slice(0, 200) : String(err);
      if (!anchorCanWait(err)) {
        await e.db.query(`UPDATE reviews SET anchor = NULL WHERE id = $1`, [r.id]);
        e.log.warn(`review ${r.id}: anchoring refused`, lastError);
      } else {
        await e.db.query(`UPDATE reviews SET anchor = $2 WHERE id = $1`, [r.id, { ...r.anchor, attempts: r.anchor.attempts + 1, lastError }]);
      }
    }
  }
  return { anchored, waiting: rows.length - anchored - expired, expired };
}

async function mintCredentialIfFirst(e: Engine, reviewer: ReviewerRow): Promise<void> {
  try {
    const existing = await e.db.maybe('SELECT 1 FROM credentials WHERE reviewer_id = $1', [reviewer.id]);
    if (existing || !e.chain.canOperate) return;
    const tx = await e.chain.mintReputation(getAddress(reviewer.wallet));
    await e.db.query(`INSERT INTO credentials (reviewer_id, level, tx_hash) VALUES ($1, 1, $2) ON CONFLICT DO NOTHING`, [reviewer.id, tx]);
    await e.db.query(`UPDATE reviewers SET level = GREATEST(level, 1) WHERE id = $1`, [reviewer.id]);
    await e.events.emit('reputation.minted', { reviewerId: reviewer.id, tx });
  } catch (err) {
    e.log.warn('reputation mint failed', err);
  }
}

// Receipt pages -----------------------------------------------------------------------------------------------

export async function findReview(e: Engine, idOrUid: string) {
  return e.db.maybe<{
    id: string;
    eas_uid: Hex | null;
    chain_id: number | null;
    tx_hash: Hex | null;
    reviewer_id: Hex;
    purchase_id: string;
    item_id: Hex;
    merchant_id: Hex;
    category_id: string;
    rating: number;
    aspects: Record<string, number>;
    claims: string[];
    summary_en: string | null;
    diet: string | null;
    language: string | null;
    content_cid: string;
    rail: Rail;
    tier: 'A' | 'B';
    status: string;
    publish_at: Date;
    trust_weight: number;
    simulated: boolean;
    hidden_reason: string | null;
    created_at: Date;
  }>('SELECT * FROM reviews WHERE id = $1 OR eas_uid = $1', [idOrUid]);
}

export async function getReceipt(e: Engine, idOrUid: string) {
  const r = await findReview(e, idOrUid);
  if (!r) throw new UserError('receipt not found', 404);
  if (r.status === 'held') throw new UserError('This review is waiting for human moderation.', 404, 'held');
  const [item, merchant, purchase, reviewer, followups, replies] = await Promise.all([
    e.db.one<{ canonical_name: string; score: number | null; verified_reviews: number }>('SELECT canonical_name, score, verified_reviews FROM items WHERE id = $1', [r.item_id]),
    e.db.one<{ id: string; name: string; city_id: string | null; claimed_by: string | null; simulated: boolean; address: string | null; maps_url: string | null; google_place_id: string | null; lat: number | null; lng: number | null }>(
      `SELECT id, name, city_id, claimed_by, simulated, address, maps_url, google_place_id, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng FROM merchants WHERE id = $1`,
      [r.merchant_id],
    ),
    e.db.one<{ brand_id: string; purchased_on: string | Date; proof_hash: string; status: string; meta: Record<string, unknown>; created_at: Date }>(
      'SELECT brand_id, purchased_on, proof_hash, status, meta, created_at FROM purchases WHERE id = $1',
      [r.purchase_id],
    ),
    e.db.one<{ id: string; level: number; reliability: number; id_type: string; simulated: boolean; created_at: Date }>(
      'SELECT id, level, reliability, id_type, simulated, created_at FROM reviewers WHERE id = $1',
      [r.reviewer_id],
    ),
    e.db.query<{ kind: string; status: string; still_good: boolean | null; new_rating: number | null; answered_at: Date | null; due_at: Date; simulated: boolean; eas_uid: string | null; note: string | null }>(
      'SELECT kind, status, still_good, new_rating, answered_at, due_at, simulated, eas_uid, note FROM followups WHERE review_id = $1 ORDER BY due_at',
      [r.id],
    ),
    e.db.query<{ text: string; eas_uid: string | null; created_at: Date; merchant_name: string }>(
      `SELECT mr.text, mr.eas_uid, mr.created_at, m.name AS merchant_name FROM merchant_replies mr JOIN merchants m ON m.id = mr.merchant_id
        WHERE mr.review_id = $1 AND mr.merchant_id = $2 ORDER BY mr.created_at`,
      [r.id, r.merchant_id],
    ),
  ]);
  const doc = await e.storage.getJson<ReviewDocument>(r.content_cid);
  const cat = getCategory(r.category_id);
  const purchasedOn = typeof purchase.purchased_on === 'string' ? purchase.purchased_on.slice(0, 10) : purchase.purchased_on.toISOString().slice(0, 10);
  return {
    id: r.id,
    uid: r.eas_uid,
    url: receiptUrl(e, r.eas_uid ?? r.id),
    anchored: !!r.eas_uid,
    chainId: r.chain_id,
    txHash: r.tx_hash,
    explorerTx: e.chain.explorerTx(r.tx_hash),
    easUrl: e.chain.easUrl(r.eas_uid),
    contentCid: r.content_cid,
    status: r.status,
    simulated: r.simulated,
    rating: r.rating,
    category: { id: r.category_id, name: cat.name },
    item: { id: r.item_id, name: item.canonical_name, score: item.score, verifiedReviews: item.verified_reviews },
    merchant: {
      id: merchant.id,
      name: merchant.name,
      city: merchant.city_id,
      claimed: !!merchant.claimed_by,
      simulated: merchant.simulated,
      place: {
        address: merchant.address,
        mapsUrl: merchant.maps_url,
        lat: merchant.lat === null ? null : Number(merchant.lat),
        lng: merchant.lng === null ? null : Number(merchant.lng),
        fromGoogle: !!merchant.google_place_id,
      },
    },
    aspects: r.aspects,
    claims: r.hidden_reason ? [] : r.claims,
    summary_en: r.hidden_reason ? null : r.summary_en,
    transcript: r.hidden_reason ? null : doc?.transcript ?? null,
    language: r.language,
    diet: r.diet,
    hidden: r.hidden_reason,
    purchase: {
      rail: r.rail,
      railLabel: RAIL_INFO[r.rail].label,
      proves: RAIL_INFO[r.rail].proves,
      how: RAIL_INFO[r.rail].how,
      tier: r.tier,
      brand: purchase.brand_id,
      purchased: cat.publish.date_granularity === 'week' ? `week of ${weekOf(purchasedOn)}` : purchasedOn,
      status: purchase.status,
      proofHash: purchase.proof_hash,
      trustAssumption:
        r.rail === 'order_page' || r.rail === 'payment_proof'
          ? 'Reclaim attestors witnessed the TLS session; this assumes they did not collude with the reviewer.'
          : r.rail === 'shop_through'
            ? 'Reported by the affiliate network after the purchase.'
            : null,
    },
    reviewer: {
      id: r.reviewer_id,
      level: reviewer.level,
      reliability: Math.round(reviewer.reliability * 100) / 100,
      uniqueHuman: true,
      verifiedWith: reviewer.id_type.startsWith('self') ? 'Self' : reviewer.id_type === 'anon_aadhaar' ? 'Anon Aadhaar' : reviewer.id_type,
      simulated: reviewer.simulated,
    },
    trustWeight: r.trust_weight,
    followups: followups.map((f) => ({ ...f, easUrl: e.chain.easUrl(f.eas_uid) })),
    replies: replies.map((x) => ({ ...x, easUrl: e.chain.easUrl(x.eas_uid) })),
    disclosure: PAID_REVIEW_DISCLOSURE,
    commissionDisclosure: r.rail === 'shop_through' ? 'This purchase was made through a Receipts link; Receipts may earn a commission. Reviewers are never paid for sales.' : null,
    publishedAt: r.publish_at,
    createdAt: r.created_at,
  };
}

export interface VerifyCheck {
  check: string;
  pass: boolean | null;
  detail: string;
}

/** "Verify yourself": re-run each check against the chain and the stored content. */
export async function verifyReceipt(e: Engine, idOrUid: string): Promise<{ id: string; uid: string | null; allPass: boolean; checks: VerifyCheck[] }> {
  const r = await findReview(e, idOrUid);
  if (!r) throw new UserError('receipt not found', 404);
  const checks: VerifyCheck[] = [];
  const purchase = await e.db.one<{ purchase_nullifier: Hex; proof_cid: string | null; proof_hash: Hex; wallet: string; simulated: boolean; rail: Rail }>(
    'SELECT purchase_nullifier, proof_cid, proof_hash, wallet, simulated, rail FROM purchases WHERE id = $1',
    [r.purchase_id],
  );
  const reviewer = await e.db.one<{ wallet: string }>('SELECT wallet FROM reviewers WHERE id = $1', [r.reviewer_id]);

  if (purchase.simulated) {
    checks.push({ check: 'proof', pass: null, detail: 'Simulated demo data: there is no real purchase behind this review.' });
  } else if (purchase.proof_cid) {
    const blob = await e.storage.getDecrypted<{ claim: { boundWallet?: string }; proof: unknown }>(purchase.proof_cid).catch(() => null);
    const rehash = blob?.proof ? proofHashOf(blob.proof) : null;
    checks.push({
      check: 'proof',
      pass: rehash === purchase.proof_hash,
      detail: blob
        ? `The ${RAIL_INFO[purchase.rail].label.toLowerCase()} proof is on file (encrypted) and re-hashes to the committed ${purchase.proof_hash.slice(0, 10)}…; auditors can re-verify it on request.`
        : 'Proof blob missing.',
    });
    checks.push({
      check: 'wallet binding',
      pass: !!blob && blob.claim.boundWallet === reviewer.wallet && purchase.wallet === reviewer.wallet,
      detail: 'The proof was bound to the same wallet that signed the review.',
    });
  }

  const content = await e.storage.get(r.content_cid);
  const cid = content ? await cidOfBytes(content.bytes) : null;
  checks.push({ check: 'content', pass: cid === r.content_cid, detail: cid ? `Review JSON re-hashes to ${r.content_cid}.` : 'Review JSON not found.' });

  if (!r.eas_uid) {
    checks.push({ check: 'attestation', pass: null, detail: 'Not anchored on-chain (simulated data, or the server runs without a chain).' });
  } else if (!e.chain.enabled || r.chain_id !== e.chain.chainId) {
    checks.push({ check: 'attestation', pass: null, detail: `Anchored on chain ${r.chain_id}; this server is connected to ${e.chain.chainId || 'no chain'}.` });
  } else {
    const a = await e.chain.getAttestation(r.eas_uid).catch(() => null);
    if (!a) {
      checks.push({ check: 'attestation', pass: false, detail: 'No such attestation on this chain (a local chain restarts with the server).' });
    } else {
      const data = decodeReview(a.data);
      checks.push({ check: 'attestation', pass: a.schema === e.chain.schemaUid('review'), detail: `EAS attestation ${r.eas_uid.slice(0, 10)}… uses the ReviewV1 schema.` });
      checks.push({ check: 'author', pass: a.attester.toLowerCase() === reviewer.wallet, detail: `Attester ${a.attester} is the reviewer's wallet; Receipts only paid the gas.` });
      checks.push({
        check: 'content on-chain',
        pass: data.contentCID === r.content_cid && data.rating === r.rating && data.itemId === r.item_id,
        detail: 'The attestation carries the same rating, item and content CID.',
      });
      const humanId = await e.chain.reviewerIdOf(a.attester).catch(() => null);
      checks.push({ check: 'unique human', pass: humanId === r.reviewer_id, detail: 'PersonhoodRegistry maps the attester to this reviewer ID.' });
      const used = await e.chain.reviewOfNullifier(data.purchaseNullifier).catch(() => null);
      checks.push({
        check: 'one purchase, one review',
        pass: used === r.eas_uid && data.purchaseNullifier === purchase.purchase_nullifier,
        detail: 'The resolver recorded this purchase nullifier against this review only.',
      });
    }
  }
  const decided = checks.filter((c) => c.pass !== null);
  return { id: r.id, uid: r.eas_uid, allPass: decided.length > 0 && decided.every((c) => c.pass), checks };
}

export async function listMyReviews(e: Engine, wallet: string) {
  return e.db.query(
    `SELECT r.id, r.eas_uid, r.rating, r.status, r.created_at, r.simulated, i.canonical_name AS item, m.name AS merchant, r.category_id
       FROM reviews r JOIN reviewers rv ON rv.id = r.reviewer_id JOIN items i ON i.id = r.item_id JOIN merchants m ON m.id = r.merchant_id
      WHERE rv.wallet = $1 ORDER BY r.created_at DESC LIMIT 100`,
    [wallet.toLowerCase()],
  );
}

