import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { keccak256, toBytes, type Hex } from 'viem';
import { merchantIdFor, merchantReceiptTypedData, newId, typedDataFromJson, type MerchantReceipt } from '@receipts/core';
import { createEngine, demo, followups, identity, merchants, payouts, proofs, query, reviews, shop, trust, type Engine } from '../src';

// The core loop, end to end, on PGlite + an in-memory chain with EAS and every Receipts contract deployed:
// unique humans -> a merchant claims its listing -> signed QR receipts (rail 5) -> voice/text review -> EAS
// attestation by delegation -> verify -> merchant reply on-chain -> trust scores -> a paid answer with citations
// -> ledger -> epoch root -> gasless USDC claim -> next-day follow-up -> shop-through test conversion -> the attack.

let e: Engine & { close(): Promise<void> };
const merchantKey = privateKeyToAccount(generatePrivateKey());
const people: PrivateKeyAccount[] = Array.from({ length: 4 }, () => privateKeyToAccount(generatePrivateKey()));
let merchantId: Hex;
const reviewUids: string[] = [];

async function signEas(account: PrivateKeyAccount, json: string): Promise<Hex> {
  return account.signTypedData(typedDataFromJson(json) as never);
}

beforeAll(async () => {
  e = await createEngine({
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'pglite:memory',
      CHAIN: 'local',
      LLM_PROVIDER: 'offline',
      X402_MODE: 'off',
      DEMO_MODE: 'true',
      ALLOW_SIMULATED_PROOFS: 'true',
      ALLOW_MOCK_IDENTITY: 'true',
      SESSION_SECRET: 'test-secret',
    },
    log: { info: () => {}, warn: () => {}, error: console.error, child() { return this; } },
  });
  merchantId = merchantIdFor({ brandId: 'local', cityId: 'goa', externalId: 'osm:node/test-cafe', name: 'Harbour Test Café' });
  await e.db.query(
    `INSERT INTO merchants (id, brand_id, city_id, category_id, name, geom, source, osm_id)
     VALUES ($1, 'local', 'goa', 'food', 'Harbour Test Café', ST_SetSRID(ST_MakePoint(73.7560, 15.5445), 4326)::geography, 'osm', 'node/test-cafe')`,
    [merchantId],
  );
});

afterAll(async () => {
  await e?.close();
});

describe('the core loop', () => {
  it('registers unique humans in the personhood registry', async () => {
    for (const p of people) {
      const r = await identity.mockHuman(e, p.address);
      expect(await e.chain.reviewerIdOf(p.address)).toBe(r.id);
    }
    await expect(identity.registerHuman(e, { nullifier: keccak256(toBytes(`receipts-mock-human|${people[0]!.address.toLowerCase()}`)), idType: 'mock', wallet: merchantKey.address })).resolves.toMatchObject({ rebound: true });
    // move the binding back so the rest of the test uses the first wallet
    await identity.registerHuman(e, { nullifier: keccak256(toBytes(`receipts-mock-human|${people[0]!.address.toLowerCase()}`)), idType: 'mock', wallet: people[0]!.address });
  });

  it('a merchant claims its listing (MerchantV1 attested on-chain)', async () => {
    const claim = await merchants.startClaim(e, merchantKey.address, { merchantId, method: 'upi' });
    const done = await merchants.approveClaim(e, claim.claimId, 'test');
    expect(done.status).toBe('verified');
    expect(done.easUid).toMatch(/^0x/);
  });

  it('reviewers prove purchases with signed QR receipts and publish reviews through the relayer', async () => {
    for (const [i, p] of people.entries()) {
      const base: Omit<MerchantReceipt, 'signature'> = {
        merchantId,
        receiptId: keccak256(toBytes(`receipt-${i}`)),
        amountMinor: 9000 + i * 500,
        currency: 'INR',
        items: [{ name: 'Filter Coffee', qty: 1, priceMinor: 9000 + i * 500 }],
        issuedAt: Math.floor(Date.now() / 1000) - 600,
      };
      const signature = await merchantKey.signTypedData(merchantReceiptTypedData(base));
      const { qr } = await merchants.recordReceipt(e, merchantKey.address, { ...base, signature });
      // The QR carries a short code (dense QRs do not scan off a screen); claiming still checks the signature.
      expect(qr).toMatch(/\/scan\?c=mr_[a-z0-9]+$/i);
      if (i === 0) {
        await expect(proofs.submitMerchantReceipt(e, p.address, { qr: 'https://example.com/scan?r=not-a-receipt' })).rejects.toMatchObject({ status: 400, code: 'bad_qr' });
      }
      const purchase = await proofs.submitMerchantReceipt(e, p.address, { qr });
      expect(purchase.tier).toBe('A');
      expect(purchase.simulated).toBe(false);

      const draft = await reviews.createDraft(e, p.address, { purchaseId: purchase.id });
      const card = await reviews.addText(e, p.address, draft.draftId, {
        text: i === 3 ? 'The filter coffee was weak and cold. 2 stars.' : 'Strong filter coffee, served hot. Great place to work for an hour. 5 stars.',
      });
      expect(card.item?.name).toBe('Filter Coffee');
      const fin = await reviews.finalizeDraft(e, p.address, draft.draftId);
      expect(fin.signing.kind).toBe('eas');
      const sig = await signEas(p, (fin.signing as { typedData: string }).typedData);
      const pub = await reviews.publishDraft(e, p.address, draft.draftId, { signature: sig });
      expect(pub.anchored).toBe(true);
      reviewUids.push(pub.uid!);
    }
  });

  it('one purchase, one review', async () => {
    const mine = await proofs.listPurchases(e, people[0]!.address);
    await expect(reviews.createDraft(e, people[0]!.address, { purchaseId: mine[0]!.id })).rejects.toThrow(/already reviewed/);
  });

  it('anyone can verify a receipt', async () => {
    const v = await reviews.verifyReceipt(e, reviewUids[0]!);
    expect(v.allPass).toBe(true);
    expect(v.checks.map((c) => c.check)).toEqual(expect.arrayContaining(['proof', 'wallet binding', 'attestation', 'author', 'unique human', 'one purchase, one review']));
    const r = await reviews.getReceipt(e, reviewUids[0]!);
    expect(r.rating).toBe(5);
    expect(r.purchase.railLabel).toBe('Merchant receipt');
  });

  it('the merchant replies in public, on-chain', async () => {
    const prepared = await merchants.prepareReply(e, merchantKey.address, { reviewId: reviewUids[3]!, text: 'Sorry about that. We have fixed the decoction.' });
    const sig = await signEas(merchantKey, (prepared.signing as { typedData: string }).typedData);
    const res = await merchants.publishReply(e, merchantKey.address, prepared.replyId, { signature: sig });
    expect(res.uid).toMatch(/^0x/);
  });

  it('answers a question with cited receipts, accrues 70% by citation, settles an epoch and pays a gasless claim', async () => {
    await trust.runTrust(e);
    const answer = await query.answerQuestion(
      e,
      { query: 'best filter coffee near Calangute', includeSimulated: false },
      { method: 'credits', amountBase: 5000n, tool: 'search_receipts' },
    );
    expect(answer.options[0]?.merchant).toBe('Harbour Test Café');
    expect(answer.options[0]?.claims.length).toBeGreaterThan(0);
    expect(answer.options[0]!.claims[0]!.receipts[0]).toContain('/r/');
    expect(answer.paid_to_reviewers_usdc).toBe('0.0035');

    await payouts.accrueAnswer(e, answer.answer_id);
    const ledger = await e.db.one<{ total: string }>(`SELECT sum(amount)::text AS total FROM ledger WHERE answer_id = $1 AND status = 'accrued'`, [answer.answer_id]);
    expect(ledger.total).toBe('3500');

    const epoch = await payouts.buildEpoch(e, { post: true });
    expect(epoch.posted).toBe(true);
    const cited = await e.db.one<{ wallet: string }>(
      `SELECT rv.wallet FROM ledger l JOIN reviewers rv ON rv.id = l.reviewer_id WHERE l.answer_id = $1 ORDER BY l.amount DESC LIMIT 1`,
      [answer.answer_id],
    );
    const info = await payouts.claimInfo(e, cited.wallet);
    expect(Number(info.claimable)).toBeGreaterThan(0);
    const claim = await payouts.relayClaim(e, cited.wallet);
    expect(claim.tx).toMatch(/^0x/);
    expect(await e.chain.usdcBalance(cited.wallet as Hex)).toBe(BigInt(info.cumulativeBase!));
  });

  it('the next-day follow-up is answered by the original reviewer, on-chain', async () => {
    const inbox = await followups.inbox(e, people[1]!.address);
    expect(inbox.length).toBe(0); // due tomorrow
    const fu = await e.db.one<{ id: string }>(`SELECT f.id FROM followups f JOIN reviews r ON r.id = f.review_id WHERE r.eas_uid = $1 AND f.kind = '1d'`, [reviewUids[1]]);
    const prepared = await followups.prepareFollowup(e, people[1]!.address, fu.id, { stillGood: true });
    const sig = await signEas(people[1]!, (prepared.signing as { typedData: string }).typedData);
    const res = await followups.answerFollowup(e, people[1]!.address, fu.id, { signature: sig });
    expect(res.uid).toMatch(/^0x/);
  });

  it('shop-through: a click and the network test conversion create a pending, then confirmed, purchase', async () => {
    const item = await e.db.one<{ id: string }>(`SELECT i.id FROM items i JOIN merchants m ON m.id = i.merchant_id WHERE i.category_id = 'products' LIMIT 1`);
    const click = await shop.clickOut(e, item.id, { wallet: people[2]!.address });
    expect(click.test).toBe(true);
    const pending = await shop.testConversion(e, click.clickId, { amountInr: 1199 });
    expect(pending.status).toBe('pending');
    const confirmed = await shop.testConversion(e, click.clickId, { amountInr: 1199, status: 'confirmed' });
    expect(confirmed.purchaseId).toBe(pending.purchaseId);
  });

  it('the attack: five planted accounts cannot move the bad place, and the ring is flagged', async () => {
    const res = await demo.runAttack(e);
    expect(res.flags.map((f) => f.signal)).toEqual(expect.arrayContaining(['review_ring', 'shared_funder']));
    const trustMove = res.after.score! - res.before.score!;
    const naiveMove = res.naiveAverage.after! - res.naiveAverage.before!;
    expect(trustMove).toBeLessThan(0.25);
    expect(naiveMove).toBeGreaterThan(4 * trustMove);
    expect(res.caseFile?.recommendation).toBe('confirm');
    const top = await query.answerQuestion(e, { query: 'best veg biryani under ₹400 near Calangute' }, { method: 'free', amountBase: 0n });
    expect(top.options.map((o) => o.merchant)).not.toContain('Golden Sands Grill (demo)');
    await demo.resetAttack(e);
  });

  // The two guarantees the spec makes about money (A22 tests 9 and 10).

  it('rankings are identical with every affiliate table emptied: ranking never reads commission data', async () => {
    const ask = async () => {
      const a = await query.answerQuestion(e, { query: 'best veg biryani under ₹400 near Calangute' }, { method: 'free', amountBase: 0n });
      return a.options.map((o) => [o.item_id, o.score, o.verified_reviews]);
    };
    const before = await ask();
    expect(before.length).toBeGreaterThan(0);
    await e.db.query('DELETE FROM affiliate_conversions');
    await e.db.query('DELETE FROM affiliate_clicks');
    await trust.runTrust(e, { onChainLevels: false });
    expect(await ask()).toEqual(before);
  });

  it('pay is identical for the lowest and the highest rating when the citations are equal', async () => {
    const pick = (order: 'ASC' | 'DESC') =>
      e.db.one<{ id: string; reviewer_id: string; rating: number }>(
        `SELECT r.id, r.reviewer_id, r.rating FROM reviews r WHERE r.status = 'active' ORDER BY r.rating ${order}, r.id LIMIT 1`,
      );
    const low = await pick('ASC');
    const high = await e.db.one<{ id: string; reviewer_id: string; rating: number }>(
      `SELECT r.id, r.reviewer_id, r.rating FROM reviews r WHERE r.status = 'active' AND r.reviewer_id <> $1 ORDER BY r.rating DESC, r.id LIMIT 1`,
      [low.reviewer_id],
    );
    expect(high.rating).toBeGreaterThan(low.rating);
    const answerId = newId('an');
    await e.db.query(`INSERT INTO answers (id, tool, query, response, price_usdc, payment_method) VALUES ($1, 'search_receipts', 'equal pay check', '{}', 5000, 'credits')`, [answerId]);
    await e.db.query('INSERT INTO citations (answer_id, review_id, weight) VALUES ($1, $2, 0.5), ($1, $3, 0.5)', [answerId, low.id, high.id]);
    await payouts.accrueAnswer(e, answerId);
    const paid = await e.db.query<{ reviewer_id: string; amount: string }>('SELECT reviewer_id, sum(amount)::text AS amount FROM ledger WHERE answer_id = $1 GROUP BY reviewer_id', [answerId]);
    const amountOf = (reviewerId: string) => paid.find((p) => p.reviewer_id === reviewerId)?.amount;
    expect(amountOf(low.reviewer_id)).toBeDefined();
    expect(amountOf(low.reviewer_id)).toBe(amountOf(high.reviewer_id));
  });
});
