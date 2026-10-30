import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { PAID_REVIEW_DISCLOSURE, SPLITS, baseToUsdc, bps, dailyCapBaseUnits, newId, splitByWeight } from '@receipts/core';
import { toBigInt } from '@receipts/db';
import { getAddress, type Address, type Hex } from 'viem';
import { verifyTypedSignature } from './sig';
import { UserError, type Engine } from './context';
import { requireHuman } from './identity';
import { createUpiPayout } from './razorpay';

// Reviewers are paid only by citation: 70% of agent and card money, and 30% of commissions, go to the reviews that
// answers cited, by weight. A daily epoch posts a cumulative Merkle root to PayoutDistributor, so nobody loses an
// epoch, and the relayer claims for reviewers so an empty wallet still gets paid. Rupees go out over UPI instead.
// Pay never depends on a review's rating, and never on sales.

// Ledger statuses: accrued (not in an epoch yet), settled (inside a posted USDC root), paid_inr (paid over UPI),
// capped (over the daily anti-farming cap, not paid), simulated (labelled demo reviewers, never paid).

export async function accrueAnswer(e: Engine, answerId: string): Promise<bigint> {
  const a = await e.db.maybe<{ price_usdc: string; payment_method: string; accrued: boolean; payment_tx: string | null }>(
    'SELECT price_usdc::text, payment_method, accrued, payment_tx FROM answers WHERE id = $1',
    [answerId],
  );
  if (!a || a.accrued) return 0n;
  const price = toBigInt(a.price_usdc);
  if (price === 0n || a.payment_method === 'free') {
    await e.db.query('UPDATE answers SET accrued = true WHERE id = $1', [answerId]);
    return 0n;
  }
  const split = a.payment_method === 'credits' ? SPLITS.card : SPLITS.agent;
  const pool = bps(price, split.reviewers);
  const cited = await e.db.query<{ reviewer_id: string; weight: number; simulated: boolean; level: number }>(
    `SELECT r.reviewer_id, sum(c.weight)::float8 AS weight, bool_or(rv.simulated) AS simulated, max(rv.level) AS level
       FROM citations c JOIN reviews r ON r.id = c.review_id JOIN reviewers rv ON rv.id = r.reviewer_id
      WHERE c.answer_id = $1 GROUP BY r.reviewer_id`,
    [answerId],
  );
  const parts = splitByWeight(pool, cited);
  let paid = 0n;
  await e.db.tx(async (t) => {
    for (const p of parts) {
      if (p.amount <= 0n) continue;
      if (p.simulated) {
        await t.query(`INSERT INTO ledger (id, reviewer_id, source, answer_id, amount, status) VALUES ($1, $2, $3, $4, $5, 'simulated')`, [
          newId('lg'),
          p.reviewer_id,
          a.payment_method === 'credits' ? 'card' : 'x402',
          answerId,
          p.amount,
        ]);
        continue;
      }
      const today = await t.one<{ sum: string | null }>(
        `SELECT sum(amount)::text AS sum FROM ledger WHERE reviewer_id = $1 AND day = CURRENT_DATE AND status IN ('accrued', 'settled', 'paid_inr')`,
        [p.reviewer_id],
      );
      const room = dailyCapBaseUnits(p.level) - toBigInt(today.sum ?? '0');
      const within = room > 0n ? (p.amount < room ? p.amount : room) : 0n;
      const over = p.amount - within;
      if (within > 0n) {
        await t.query(`INSERT INTO ledger (id, reviewer_id, source, answer_id, amount) VALUES ($1, $2, $3, $4, $5)`, [
          newId('lg'),
          p.reviewer_id,
          a.payment_method === 'credits' ? 'card' : 'x402',
          answerId,
          within,
        ]);
        paid += within;
      }
      if (over > 0n) {
        await t.query(`INSERT INTO ledger (id, reviewer_id, source, answer_id, amount, status) VALUES ($1, $2, $3, $4, $5, 'capped')`, [
          newId('lg'),
          p.reviewer_id,
          a.payment_method === 'credits' ? 'card' : 'x402',
          answerId,
          over,
        ]);
      }
    }
    await t.query('UPDATE answers SET accrued = true WHERE id = $1', [answerId]);
  });
  if (paid > 0n) await e.events.emit('ledger.accrued', { answerId, reviewers: parts.length, usdc: baseToUsdc(paid) });
  return paid;
}

/** Worker: accrue paid answers (x402 once settled, card credits immediately). */
export async function accrueTick(e: Engine): Promise<number> {
  const rows = await e.db.query<{ id: string }>(
    `SELECT id FROM answers WHERE NOT accrued AND (payment_method IN ('credits', 'free') OR payment_tx IS NOT NULL) ORDER BY created_at LIMIT 500`,
  );
  for (const r of rows) await accrueAnswer(e, r.id);
  return rows.length;
}

/** The reviewer share of confirmed commissions joins the pool and is paid by citation, never by sale. */
async function distributeCommissionPool(e: Engine): Promise<bigint> {
  const conv = await e.db.query<{ id: string; commission_minor: string; currency: string }>(
    `SELECT id, commission_minor::text, currency FROM affiliate_conversions WHERE status = 'confirmed' AND NOT pool_accrued AND NOT test AND commission_minor > 0`,
  );
  if (!conv.length) return 0n;
  const fx = e.env.FX_INR_PER_USD;
  const poolUsdc = conv.reduce((s, c) => {
    const reviewerShare = bps(toBigInt(c.commission_minor), SPLITS.commission.reviewers);
    // paise -> USDC base units (6 decimals): paise / 100 / fx * 1e6
    return s + (c.currency === 'INR' ? (reviewerShare * 10_000n) / BigInt(Math.round(fx)) : reviewerShare * 10_000n);
  }, 0n);
  const shares = await e.db.query<{ reviewer_id: string; weight: number }>(
    `SELECT l.reviewer_id, sum(l.amount)::float8 AS weight FROM ledger l WHERE l.status = 'accrued' AND l.source IN ('x402', 'card') GROUP BY l.reviewer_id`,
  );
  if (!shares.length) return 0n;
  const parts = splitByWeight(poolUsdc, shares);
  await e.db.tx(async (t) => {
    for (const p of parts) {
      if (p.amount > 0n) await t.query(`INSERT INTO ledger (id, reviewer_id, source, amount) VALUES ($1, $2, 'commission', $3)`, [newId('lg'), p.reviewer_id, p.amount]);
    }
    await t.query('UPDATE affiliate_conversions SET pool_accrued = true WHERE id = ANY($1)', [conv.map((c) => c.id)]);
  });
  return poolUsdc;
}

export interface EpochResult {
  epochId: string | null;
  number: number | null;
  root: Hex | null;
  reviewers: number;
  newUsdc: string;
  totalCumulative: string;
  txHash: Hex | null;
  posted: boolean;
  reason?: string;
}

/** Build (and post) the next epoch: cumulative balances for every reviewer paid in USDC. */
export async function buildEpoch(e: Engine, opts: { post?: boolean } = {}): Promise<EpochResult> {
  await accrueTick(e);
  await distributeCommissionPool(e);
  const rows = await e.db.query<{ reviewer_id: string; wallet: string; kind: string | null; address: string | null; cumulative: string; fresh: string }>(
    `SELECT rv.id AS reviewer_id, rv.wallet, pm.kind, pm.address,
            sum(l.amount) FILTER (WHERE l.status IN ('accrued', 'settled'))::text AS cumulative,
            COALESCE(sum(l.amount) FILTER (WHERE l.status = 'accrued'), 0)::text AS fresh
       FROM ledger l JOIN reviewers rv ON rv.id = l.reviewer_id LEFT JOIN payout_methods pm ON pm.reviewer_id = rv.id
      WHERE NOT rv.simulated AND COALESCE(pm.kind, 'usdc') = 'usdc'
      GROUP BY rv.id, rv.wallet, pm.kind, pm.address`,
  );
  const leaves = rows.filter((r) => toBigInt(r.cumulative) > 0n).map((r) => [getAddress(r.wallet), toBigInt(r.cumulative).toString()] as [string, string]);
  const fresh = rows.reduce((s, r) => s + toBigInt(r.fresh), 0n);
  if (!leaves.length || fresh === 0n) {
    return { epochId: null, number: null, root: null, reviewers: 0, newUsdc: '0', totalCumulative: '0', txHash: null, posted: false, reason: 'nothing new to settle' };
  }
  const tree = StandardMerkleTree.of(leaves, ['address', 'uint256']);
  const total = leaves.reduce((s, [, v]) => s + BigInt(v), 0n);
  const last = await e.db.maybe<{ number: number }>('SELECT max(number) AS number FROM epochs');
  const onChainEpoch = e.chain.canOperate ? Number((await e.chain.distributorState()).epoch) : 0;
  const number = Math.max(Number(last?.number ?? 0), onChainEpoch) + 1;
  const epochId = newId('ep');
  await e.db.query(
    `INSERT INTO epochs (id, number, merkle_root, total_usdc, total_cumulative, tree, chain_id, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'built')`,
    [epochId, number, tree.root, fresh, total, tree.dump(), e.chain.chainId || null],
  );
  let txHash: Hex | null = null;
  let posted = false;
  if ((opts.post ?? true) && e.chain.canOperate) {
    try {
      await e.chain.fundDistributor(total);
      txHash = await e.chain.postRoot(tree.root as Hex, BigInt(number), total);
      posted = true;
      await e.db.tx(async (t) => {
        await t.query(`UPDATE epochs SET status = 'posted', tx_hash = $2, posted_at = now() WHERE id = $1`, [epochId, txHash]);
        await t.query(
          `UPDATE ledger SET status = 'settled', epoch_id = $1 WHERE status = 'accrued' AND reviewer_id IN (
             SELECT rv.id FROM reviewers rv LEFT JOIN payout_methods pm ON pm.reviewer_id = rv.id WHERE NOT rv.simulated AND COALESCE(pm.kind, 'usdc') = 'usdc')`,
          [epochId],
        );
      });
    } catch (err) {
      await e.db.query(`UPDATE epochs SET status = 'failed', error = $2 WHERE id = $1`, [epochId, err instanceof Error ? err.message : String(err)]);
      throw new UserError(`Could not post the payout root: ${err instanceof Error ? err.message : err}`, 400, 'post_failed');
    }
  }
  await e.events.emit('epoch.posted', { epoch: number, root: tree.root, reviewers: leaves.length, newUsdc: baseToUsdc(fresh), txHash, posted });
  return { epochId, number, root: tree.root as Hex, reviewers: leaves.length, newUsdc: baseToUsdc(fresh), totalCumulative: baseToUsdc(total), txHash, posted };
}

async function latestTree(e: Engine) {
  const ep = await e.db.maybe<{ id: string; number: number; tree: ReturnType<StandardMerkleTree<[string, string]>['dump']>; merkle_root: Hex; tx_hash: Hex | null }>(
    `SELECT id, number, tree, merkle_root, tx_hash FROM epochs WHERE status = 'posted' ORDER BY number DESC LIMIT 1`,
  );
  return ep ? { ...ep, tree: StandardMerkleTree.load(ep.tree) } : null;
}

export async function claimInfo(e: Engine, wallet: string) {
  const ep = await latestTree(e);
  const w = getAddress(wallet);
  if (!ep) return { epoch: null, cumulative: '0', claimed: '0', claimable: '0', proof: [] as Hex[] };
  for (const [i, v] of ep.tree.entries()) {
    if (getAddress(v[0]) !== w) continue;
    const cumulative = BigInt(v[1]);
    const claimed = e.chain.canOperate || e.chain.enabled ? await e.chain.claimedOf(w) : 0n;
    return {
      epoch: ep.number,
      root: ep.merkle_root,
      cumulative: baseToUsdc(cumulative),
      cumulativeBase: cumulative.toString(),
      claimed: baseToUsdc(claimed),
      claimable: baseToUsdc(cumulative > claimed ? cumulative - claimed : 0n),
      proof: ep.tree.getProof(i) as Hex[],
      distributor: e.chain.deployment?.payoutDistributor ?? null,
      chainId: e.chain.chainId,
    };
  }
  return { epoch: ep.number, cumulative: '0', claimed: '0', claimable: '0', proof: [] as Hex[] };
}

/** Typed data for a gasless claim to a wallet the reviewer chooses (e.g. Cake Wallet). */
export async function claimToTypedData(e: Engine, wallet: string, to: string) {
  const info = await claimInfo(e, wallet);
  if (!('cumulativeBase' in info) || info.claimable === '0') throw new UserError('Nothing to claim yet.', 409, 'nothing_to_claim');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const td = e.chain.claimToTypedData(getAddress(wallet), BigInt(info.cumulativeBase!), getAddress(to), deadline);
  return { typedData: JSON.stringify(td, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), deadline: deadline.toString() };
}

/** The relayer submits the claim and pays gas; funds go to the reviewer (or the wallet they signed for). */
export async function relayClaim(e: Engine, wallet: string, opts: { to?: string; deadline?: string; signature?: Hex } = {}) {
  const reviewer = await requireHuman(e, wallet);
  const info = await claimInfo(e, wallet);
  if (!('cumulativeBase' in info) || info.claimable === '0') throw new UserError('Nothing to claim yet.', 409, 'nothing_to_claim');
  const account = getAddress(wallet);
  const cumulative = BigInt(info.cumulativeBase!);
  let tx: Hex;
  if (opts.to && getAddress(opts.to) !== account) {
    if (!opts.signature || !opts.deadline) throw new UserError('Sign the claim to send it to another wallet.', 400, 'signature_required');
    const td = e.chain.claimToTypedData(account, cumulative, getAddress(opts.to), BigInt(opts.deadline));
    if (!(await verifyTypedSignature(account, td, opts.signature))) throw new UserError('Signature does not match.', 401, 'bad_signature');
    tx = await e.chain.relayClaimTo(account, cumulative, info.proof, getAddress(opts.to), BigInt(opts.deadline), opts.signature);
  } else {
    tx = await e.chain.relayClaim(account, cumulative, info.proof);
  }
  await e.db.query(
    `INSERT INTO payouts (id, reviewer_id, kind, amount_usdc, destination, tx_hash, status) VALUES ($1, $2, 'usdc_claim', $3, $4, $5, 'paid')`,
    [newId('po'), reviewer.id, BigInt(Math.round(Number(info.claimable) * 1e6)), (opts.to ?? account).toLowerCase(), tx],
  );
  await e.events.emit('payout.claimed', { reviewerId: reviewer.id, usdc: info.claimable, to: opts.to ?? account, tx });
  return { tx, explorerTx: e.chain.explorerTx(tx), amount: info.claimable, to: opts.to ?? account };
}

export async function setPayoutMethod(e: Engine, wallet: string, input: { kind: 'usdc' | 'upi'; address: string }) {
  const reviewer = await requireHuman(e, wallet);
  if (input.kind === 'upi' && !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(input.address)) throw new UserError('That does not look like a UPI ID.', 422, 'bad_upi');
  if (input.kind === 'usdc') getAddress(input.address);
  await e.db.query(
    `INSERT INTO payout_methods (reviewer_id, kind, address, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (reviewer_id) DO UPDATE SET kind = EXCLUDED.kind, address = EXCLUDED.address, updated_at = now(), verified_at = NULL`,
    [reviewer.id, input.kind, input.kind === 'upi' ? input.address.toLowerCase() : getAddress(input.address)],
  );
  return { kind: input.kind, address: input.address };
}

/** Rupees to a UPI ID through RazorpayX (test mode at the event). */
/** Rupee payouts need RazorpayX switched on for the account, and its account number in RAZORPAYX_ACCOUNT_NUMBER. */
const INR_OFF = 'Rupee payouts are not switched on here yet: Razorpay has to enable RazorpayX for this account first. Your earnings are safe; claim them in USDC meanwhile.';
function inrPayoutsOn(e: Engine): boolean {
  return !!(e.env.RAZORPAYX_KEY_ID && e.env.RAZORPAYX_KEY_SECRET && e.env.RAZORPAYX_ACCOUNT_NUMBER);
}

export async function withdrawInr(e: Engine, wallet: string) {
  const reviewer = await requireHuman(e, wallet);
  const method = await e.db.maybe<{ kind: string; address: string }>('SELECT kind, address FROM payout_methods WHERE reviewer_id = $1', [reviewer.id]);
  if (method?.kind !== 'upi') throw new UserError('Set a UPI ID as your payout method first.', 409, 'no_upi');
  if (!inrPayoutsOn(e)) throw new UserError(INR_OFF, 400, 'payouts_off');
  await accrueTick(e);
  const rows = await e.db.query<{ id: string; amount: string }>(`SELECT id, amount::text FROM ledger WHERE reviewer_id = $1 AND status = 'accrued'`, [reviewer.id]);
  const usdc = rows.reduce((s, r) => s + toBigInt(r.amount), 0n);
  const paise = Number((usdc * BigInt(Math.round(e.env.FX_INR_PER_USD * 100))) / 1_000_000n);
  if (paise < 100) throw new UserError(`Razorpay sends payouts of ₹1 or more; you have ₹${(paise / 100).toFixed(2)} so far.`, 409, 'too_small');
  const payoutId = newId('po');
  const res = await createUpiPayout(e.env, {
    amountPaise: paise,
    vpa: method.address,
    name: 'Receipts reviewer',
    referenceId: payoutId,
    narration: 'Receipts earnings',
    notes: { reviewer: reviewer.id.slice(0, 40) },
  });
  await e.db.tx(async (t) => {
    await t.query(`UPDATE ledger SET status = 'paid_inr' WHERE id = ANY($1)`, [rows.map((r) => r.id)]);
    await t.query(
      `INSERT INTO payouts (id, reviewer_id, kind, amount_usdc, amount_paise, fx_rate, destination, provider_ref, status, test_mode)
       VALUES ($1, $2, 'inr_upi', $3, $4, $5, $6, $7, $8, $9)`,
      [payoutId, reviewer.id, usdc, paise, e.env.FX_INR_PER_USD, method.address, res.id, res.status, res.testMode],
    );
  });
  await e.events.emit('payout.inr', { reviewerId: reviewer.id, rupees: paise / 100, upi: method.address.replace(/^(.{2}).*(@.*)$/, '$1***$2'), testMode: res.testMode });
  return { payoutId, providerRef: res.id, status: res.status, rupees: paise / 100, testMode: res.testMode };
}

export async function earnings(e: Engine, wallet: string) {
  const reviewer = await requireHuman(e, wallet);
  const sums = await e.db.query<{ status: string; total: string }>('SELECT status, sum(amount)::text AS total FROM ledger WHERE reviewer_id = $1 GROUP BY status', [reviewer.id]);
  const by = Object.fromEntries(sums.map((s) => [s.status, baseToUsdc(toBigInt(s.total))]));
  const today = await e.db.one<{ sum: string | null }>(`SELECT sum(amount)::text AS sum FROM ledger WHERE reviewer_id = $1 AND day = CURRENT_DATE AND status <> 'capped'`, [reviewer.id]);
  const recent = await e.db.query(
    `SELECT l.amount::text AS amount_base, l.source, l.status, l.created_at, a.query, i.canonical_name AS item, m.name AS merchant
       FROM ledger l LEFT JOIN answers a ON a.id = l.answer_id
       LEFT JOIN LATERAL (SELECT r.item_id, r.merchant_id FROM citations c JOIN reviews r ON r.id = c.review_id WHERE c.answer_id = a.id AND r.reviewer_id = l.reviewer_id LIMIT 1) cr ON true
       LEFT JOIN items i ON i.id = cr.item_id LEFT JOIN merchants m ON m.id = cr.merchant_id
      WHERE l.reviewer_id = $1 ORDER BY l.created_at DESC LIMIT 30`,
    [reviewer.id],
  );
  const method = await e.db.maybe('SELECT kind, address FROM payout_methods WHERE reviewer_id = $1', [reviewer.id]);
  const accruedBase = await e.db.one<{ sum: string | null }>(`SELECT sum(amount)::text AS sum FROM ledger WHERE reviewer_id = $1 AND status = 'accrued'`, [reviewer.id]);
  const payouts = await e.db.query('SELECT kind, amount_usdc::text, amount_paise::text, destination, tx_hash, status, test_mode, created_at FROM payouts WHERE reviewer_id = $1 ORDER BY created_at DESC LIMIT 20', [
    reviewer.id,
  ]);
  return {
    reviewerId: reviewer.id,
    level: reviewer.level,
    totals: { accrued: by.accrued ?? '0', settled: by.settled ?? '0', paidInr: by.paid_inr ?? '0', capped: by.capped ?? '0' },
    today: baseToUsdc(toBigInt(today.sum ?? '0')),
    dailyCap: baseToUsdc(dailyCapBaseUnits(reviewer.level)),
    claim: await claimInfo(e, wallet),
    payoutMethod: method,
    // Rupees: whether RazorpayX payouts are on here, and what a withdrawal would send now (Razorpay's minimum is ₹1).
    inr: { on: inrPayoutsOn(e), paise: Number((toBigInt(accruedBase.sum ?? '0') * BigInt(Math.round(e.env.FX_INR_PER_USD * 100))) / 1_000_000n), minimumPaise: 100 },
    recent: recent.map((r: Record<string, unknown>) => ({ ...r, amount: baseToUsdc(toBigInt(r.amount_base as string)) })),
    payouts,
    disclosure: PAID_REVIEW_DISCLOSURE,
  };
}

export async function leaderboard(e: Engine, limit = 20) {
  const rows = await e.db.query<{ reviewer_id: string; level: number; simulated: boolean; total: string; reviews: string; wallet: string }>(
    `SELECT rv.id AS reviewer_id, rv.level, rv.simulated, rv.wallet, COALESCE(sum(l.amount) FILTER (WHERE l.status IN ('accrued', 'settled', 'paid_inr', 'simulated')), 0)::text AS total,
            (SELECT count(*)::text FROM reviews r WHERE r.reviewer_id = rv.id AND r.status = 'active') AS reviews
       FROM reviewers rv LEFT JOIN ledger l ON l.reviewer_id = rv.id GROUP BY rv.id ORDER BY sum(l.amount) DESC NULLS LAST LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    reviewer: `${r.wallet.slice(0, 6)}…${r.wallet.slice(-4)}`,
    reviewerId: r.reviewer_id,
    level: r.level,
    reviews: Number(r.reviews),
    earnedUsdc: baseToUsdc(toBigInt(r.total)),
    simulated: r.simulated,
  }));
}

export function shortAddress(a: Address): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
