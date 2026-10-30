import { FollowUpDocument, encodeFollowUp, followUpWindowDays, typedDataFromJson, typedDataToJson } from '@receipts/core';
import { getCategory } from '@receipts/categories';
import { getAddress, verifyMessage, type Address, type Hex } from 'viem';
import { verifyTypedSignature } from './sig';
import { UserError, type Engine } from './context';
import { sendFollowupNudge } from './notify';

// Every review gets the check-ins its category defines, each stored as a new attestation linked to the original
// (never an edit). The share still positive becomes a durability score. Rows live in a table so they survive
// restarts; the worker picks due rows every minute.

const DAY = 86_400_000;

export async function scheduleFollowups(e: Engine, reviewId: string): Promise<number> {
  const r = await e.db.one<{ id: string; category_id: string; created_at: Date; simulated: boolean; purchase_id: string }>(
    'SELECT id, category_id, created_at, simulated, purchase_id FROM reviews WHERE id = $1',
    [reviewId],
  );
  const p = await e.db.one<{ meta: Record<string, unknown> }>('SELECT meta FROM purchases WHERE id = $1', [r.purchase_id]);
  const cat = getCategory(r.category_id);
  const created = new Date(r.created_at).getTime();
  let n = 0;
  for (const spec of cat.followups) {
    const days = /^(\d+)d$/.exec(spec)?.[1];
    let due: number;
    let offset: number | null = null;
    if (days) {
      offset = Number(days);
      due = created + offset * DAY;
    } else if (spec === 'trip_end') {
      const travel = typeof p.meta.travelDate === 'string' ? Date.parse(`${p.meta.travelDate}T18:00:00Z`) : NaN;
      due = Number.isFinite(travel) && travel > created ? travel + DAY / 2 : created + 2 * DAY;
    } else if (spec === 'move_out') {
      due = created + 180 * DAY;
    } else if (spec === 'return_window') {
      due = created + 10 * DAY;
    } else {
      due = created + 30 * DAY;
    }
    const windowEnd = offset !== null ? created + followUpWindowDays(offset)[1] * DAY : due + 14 * DAY;
    await e.db.query(
      `INSERT INTO followups (id, review_id, kind, day_offset, due_at, window_end, status, simulated)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', $7) ON CONFLICT (id) DO NOTHING`,
      [`fu_${reviewId.slice(2)}_${spec}`, reviewId, spec, offset, new Date(due), new Date(windowEnd), r.simulated],
    );
    n++;
  }
  return n;
}

export async function inbox(e: Engine, wallet: string) {
  return e.db.query(
    `SELECT f.id, f.kind, f.due_at, f.window_end, f.status, r.id AS review_id, r.eas_uid, r.rating, r.category_id,
            i.canonical_name AS item, m.name AS merchant
       FROM followups f JOIN reviews r ON r.id = f.review_id JOIN reviewers rv ON rv.id = r.reviewer_id
       JOIN items i ON i.id = r.item_id JOIN merchants m ON m.id = r.merchant_id
      WHERE rv.wallet = $1 AND f.status IN ('scheduled', 'notified') AND f.due_at <= now() + interval '1 hour'
        AND (f.window_end IS NULL OR f.window_end > now())
      ORDER BY f.due_at`,
    [wallet.toLowerCase()],
  );
}

async function loadOwned(e: Engine, wallet: string, followupId: string) {
  const f = await e.db.maybe<{
    id: string;
    kind: string;
    day_offset: number | null;
    status: string;
    signing: { kind: 'eas'; json: string; request: Record<string, string | boolean>; deadline: string; doc: FollowUpDocument; cid: string } | { kind: 'message'; message: string; doc: FollowUpDocument; cid: string } | null;
    review_id: string;
    eas_uid: Hex | null;
    review_created: Date;
    wallet: string;
    simulated: boolean;
  }>(
    `SELECT f.id, f.kind, f.day_offset, f.status, f.signing, f.simulated, r.id AS review_id, r.eas_uid, r.created_at AS review_created, rv.wallet
       FROM followups f JOIN reviews r ON r.id = f.review_id JOIN reviewers rv ON rv.id = r.reviewer_id WHERE f.id = $1`,
    [followupId],
  );
  if (!f || f.wallet !== wallet.toLowerCase()) throw new UserError('check-in not found', 404);
  if (f.status === 'answered') throw new UserError('already answered', 409);
  return f;
}

/** Build the one-tap answer (still good? new rating? optional note) that the original reviewer signs. */
export async function prepareFollowup(e: Engine, wallet: string, followupId: string, input: { stillGood: boolean; newRating?: number; note?: string }) {
  const f = await loadOwned(e, wallet, followupId);
  const elapsedDays = (Date.now() - new Date(f.review_created).getTime()) / DAY;
  const dayOffset = f.day_offset ?? Math.max(0, Math.floor(elapsedDays));
  const [lower, upper] = followUpWindowDays(dayOffset);
  if (elapsedDays < lower || elapsedDays > upper) {
    throw new UserError(`This check-in opens on day ${lower} and closes on day ${upper}; it is day ${Math.floor(elapsedDays)}.`, 409, 'outside_window');
  }
  const newRating = input.newRating ? Math.max(1, Math.min(5, Math.round(input.newRating))) : 0;
  const doc = FollowUpDocument.parse({
    schema: 'receipts.followup.v1',
    reviewUid: f.eas_uid ?? f.review_id,
    dayOffset,
    kind: f.kind,
    stillGood: input.stillGood,
    newRating,
    note: input.note?.trim().slice(0, 500) || null,
    simulated: f.simulated,
  });
  const { cid } = await e.storage.putJson(doc);
  if (f.eas_uid && e.chain.enabled) {
    const data = encodeFollowUp({ dayOffset, stillGood: input.stillGood, newRating, contentCID: cid });
    const { typedData, request, deadline } = await e.chain.delegationTypedData('followUp', data, { attester: getAddress(wallet), refUID: f.eas_uid });
    const json = typedDataToJson(typedData);
    const signing = { kind: 'eas' as const, json, request: JSON.parse(JSON.stringify(request, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))), deadline: deadline.toString(), doc, cid };
    await e.db.query('UPDATE followups SET signing = $2 WHERE id = $1', [f.id, signing]);
    return { followupId: f.id, signing: { kind: 'eas' as const, typedData: json } };
  }
  const message = `Receipts check-in ${cid}\nStill good: ${input.stillGood ? 'yes' : 'no'}`;
  await e.db.query('UPDATE followups SET signing = $2 WHERE id = $1', [f.id, { kind: 'message', message, doc, cid }]);
  return { followupId: f.id, signing: { kind: 'message' as const, message } };
}

export async function answerFollowup(e: Engine, wallet: string, followupId: string, input: { signature: Hex }) {
  const f = await loadOwned(e, wallet, followupId);
  if (!f.signing) throw new UserError('Prepare the answer first.', 409, 'not_prepared');
  const attester = getAddress(wallet);
  let uid: Hex | null = null;
  let txHash: Hex | null = null;
  if (f.signing.kind === 'eas') {
    const td = typedDataFromJson(f.signing.json);
    if (!(await verifyTypedSignature(attester, td, input.signature))) throw new UserError('Signature does not match.', 401, 'bad_signature');
    const req = f.signing.request;
    const res = await e.chain.submitDelegated({
      schema: 'followUp',
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
      deadline: BigInt(f.signing.deadline),
      signature: input.signature,
    });
    uid = res.uid;
    txHash = res.txHash;
  } else if (!(await verifyMessage({ address: attester, message: f.signing.message, signature: input.signature }))) {
    throw new UserError('Signature does not match.', 401, 'bad_signature');
  }
  const doc = f.signing.doc;
  await e.db.query(
    `UPDATE followups SET status = 'answered', still_good = $2, new_rating = $3, note = $4, content_cid = $5, eas_uid = $6, tx_hash = $7, answered_at = now(), signing = NULL WHERE id = $1`,
    [f.id, doc.stillGood, doc.newRating || null, doc.note, f.signing.cid, uid, txHash],
  );
  e.storage.pin(f.signing.cid).catch(() => undefined);
  await e.events.emit('followup.answered', { followupId: f.id, reviewId: f.review_id, stillGood: doc.stillGood, kind: f.kind, uid, txHash });
  return { followupId: f.id, uid, txHash, explorerTx: e.chain.explorerTx(txHash) };
}

/**
 * Demo only: answer a check-in whose window a four-day event cannot reach (day 30, day 90). Stored off-chain,
 * marked simulated, and labelled as fast-forwarded wherever it is shown.
 */
export async function fastForwardAnswer(e: Engine, followupId: string, input: { stillGood: boolean; newRating?: number }) {
  if (!e.env.DEMO_MODE) throw new UserError('Fast-forward is only available in demo mode.', 403);
  await e.db.query(
    `UPDATE followups SET status = 'answered', still_good = $2, new_rating = $3, note = 'fast-forwarded for the demo', answered_at = now(), simulated = true
      WHERE id = $1 AND status <> 'answered'`,
    [followupId, input.stillGood, input.newRating ?? null],
  );
  await e.events.emit('followup.fast_forwarded', { followupId, stillGood: input.stillGood });
}

/** Worker: nudge reviewers whose check-ins are due, then expire the ones whose window closed. */
export async function followupTick(e: Engine): Promise<{ notified: number; expired: number }> {
  const due = await e.db.query<{ id: string; kind: string; reviewer_id: string; item: string; merchant: string }>(
    `SELECT f.id, f.kind, r.reviewer_id, i.canonical_name AS item, m.name AS merchant
       FROM followups f JOIN reviews r ON r.id = f.review_id JOIN items i ON i.id = r.item_id JOIN merchants m ON m.id = r.merchant_id
      WHERE f.status = 'scheduled' AND f.due_at <= now() AND NOT f.simulated LIMIT 200`,
  );
  for (const f of due) {
    await sendFollowupNudge(e, f.reviewer_id, { followupId: f.id, item: f.item, merchant: f.merchant, kind: f.kind }).catch((err) => e.log.warn('nudge failed', err));
    await e.db.query(`UPDATE followups SET status = 'notified', notified_at = now() WHERE id = $1`, [f.id]);
  }
  const expired = await e.db.query(`UPDATE followups SET status = 'expired' WHERE status IN ('scheduled', 'notified') AND window_end < now() RETURNING id`);
  return { notified: due.length, expired: expired.length };
}
