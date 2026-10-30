import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { keccak256, toBytes } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { defaultReclaimProvider, getBrand } from '@receipts/brands';
import { merchantReceiptTypedData, purchaseNullifier, upiNullifier } from '@receipts/core';
import {
  becknSigningString,
  extractEmailFields,
  ondcOrderClaim,
  orderPageClaim,
  parseAmountMinor,
  parseDate,
  parseItems,
  parsePostback,
  paymentProofClaim,
  simulatedClaim,
  verifyBecknSignature,
  verifyForwardedEmail,
  verifyMerchantReceipt,
} from '../src';

const wallet = '0x1111111111111111111111111111111111111111';

describe('parsing helpers', () => {
  it('reads amounts, dates and item lists in the formats brands use', () => {
    expect(parseAmountMinor('₹ 1,412.50')).toBe(141250);
    expect(parseAmountMinor('Rs.412')).toBe(41200);
    expect(parseDate('26 Oct 2026, 8:15 PM')).toBe('2026-10-26');
    expect(parseDate('2026-10-29T10:00:00Z')).toBe('2026-10-29');
    expect(parseDate(1761500000)).toBe('2025-10-26');
    expect(parseItems('2 x Veg Dum Biryani | Raita', '₹340|₹40')).toEqual([
      { name: 'Veg Dum Biryani', quantity: 2, priceMinor: 34000 },
      { name: 'Raita', quantity: 1, priceMinor: 4000 },
    ]);
    expect(parseItems('[{"name":"Masala Dosa","qty":1,"price":"140"}]')[0]).toMatchObject({ name: 'Masala Dosa', priceMinor: 14000 });
  });
});

describe('rail 1 and 3 claims from Reclaim parameters', () => {
  it('an order page proof becomes a tier A claim whose nullifier is brand + order ID', () => {
    const claim = orderPageClaim(
      { params: { orderId: '168452936512', restaurantName: 'Saudade Kitchen', items: 'Veg Dum Biryani', itemPrices: '320', total: '₹ 352' }, timestampS: 1761500000 },
      { brandId: 'swiggy', wallet, providerId: 'p1', proof: { x: 1 }, category: 'food' },
    );
    expect(claim.tier).toBe('A');
    expect(claim.nullifier).toBe(purchaseNullifier('swiggy', '168452936512'));
    expect(claim.items[0]!.name).toBe('Veg Dum Biryani');
    expect(claim.amountMinor).toBe(35200);
  });

  it('a latest-order proof without an order ID is keyed by the wallet and what was ordered', () => {
    // The fields of the community provider "Swiggy Last Order Details" (8aac5893-...).
    const params = {
      restaurant_name: 'Saudade Kitchen',
      order_delivery_status: 'delivered',
      net_total: '352',
      order_items: '[{"name":"Veg Dum Biryani","quantity":"2","total":"320"}]',
    };
    const ctx = { brandId: 'swiggy', wallet, providerId: 'p1', proof: {}, category: 'food' };
    const claim = orderPageClaim({ params, timestampS: 1761500000 }, ctx);
    expect(claim).toMatchObject({ tier: 'A', amountMinor: 35200, merchant: { name: 'Saudade Kitchen' } });
    expect(claim.items[0]).toMatchObject({ name: 'Veg Dum Biryani', quantity: 2 });
    expect(claim.orderRef).toMatch(/^latest:0x[0-9a-f]{64}$/);
    expect(orderPageClaim({ params, timestampS: 1 }, ctx).nullifier).toBe(claim.nullifier);
    const other = orderPageClaim({ params, timestampS: 1 }, { ...ctx, wallet: '0x2222222222222222222222222222222222222222' });
    expect(other.nullifier).not.toBe(claim.nullifier);
  });

  it('an order page proof without items is tier B, and a cancelled order is refused', () => {
    // The newest order from the community provider "Blinkit Last 3 Orders" (675fa687-...).
    const claim = orderPageClaim(
      { params: { order1_id: '1458291736', order1_amount: '₹1,234', order1_date: '26 Oct 2026, 8:15 PM', order1_status: 'DELIVERED', order1_cart: '991' }, timestampS: 1 },
      { brandId: 'blinkit', wallet, providerId: 'p2', proof: {} },
    );
    expect(claim).toMatchObject({ tier: 'B', orderRef: '1458291736', amountMinor: 123400, purchasedOn: '2026-10-26', items: [] });
    expect(() =>
      orderPageClaim({ params: { orderId: '77', restaurantName: 'X', order_delivery_status: 'cancelled' }, timestampS: 1 }, { brandId: 'swiggy', wallet, providerId: 'p1', proof: {} }),
    ).toThrow(/cancelled/);
  });

  it('reads each community provider through its field map', () => {
    // Values shaped like what each provider's config extracts (packages/brands/src/reclaim.ts).
    const proveWith = (brandId: string, params: Record<string, string>) => {
      const provider = defaultReclaimProvider(brandId, 'order_page')!;
      return orderPageClaim(
        { params, timestampS: 1761500000 },
        { brandId, wallet, providerId: provider.id, proof: {}, fields: provider.fields, merchantFallback: getBrand(brandId).name },
      );
    };
    const jiomart = proveWith('jiomart', { product_name: 'Aashirvaad Atta 5 kg', order_amount: '289.00', purchased_date: '27 Oct 2026', email: 'x@example.com' });
    expect(jiomart).toMatchObject({ tier: 'A', amountMinor: 28900, purchasedOn: '2026-10-27', merchant: { name: 'JioMart' } });
    expect(jiomart.items[0]!.name).toBe('Aashirvaad Atta 5 kg');

    const paytm = proveWith('paytm', { order_id: '27384910233', order_name: 'Recharge of Jio Mobile 9876543210', amount: '299', status: 'SUCCESS', dateString: '2026-10-25' });
    expect(paytm).toMatchObject({ tier: 'A', orderRef: '27384910233', amountMinor: 29900 });
    expect(paytm.items[0]!.name).toBe('Recharge of Jio Mobile ••••');
    expect(() => proveWith('paytm', { order_id: '1', order_name: 'Bill', amount: '10', status: 'FAILED' })).toThrow(/failed/);

    expect(proveWith('nike', { order_id: 'C01234567890', item: 'Nike Pegasus 41', date: '2026-10-20T10:00:00Z' })).toMatchObject({
      tier: 'A',
      orderRef: 'C01234567890',
      purchasedOn: '2026-10-20',
      merchant: { name: 'Nike' },
    });
    expect(proveWith('kfc', { itemName: 'Zinger Burger', itemPrice: '219.05', Date: '1761400000000' })).toMatchObject({
      tier: 'A',
      purchasedOn: '2025-10-25',
      items: [{ name: 'Zinger Burger', quantity: 1, priceMinor: 21905 }],
    });
    expect(proveWith('amazon', { order_id_1: '408-1234567-1234567' })).toMatchObject({ tier: 'B', orderRef: '408-1234567-1234567', merchant: { name: 'Amazon India' } });
    expect(proveWith('instamart', { order_id: '187654321098', amount: '412' })).toMatchObject({ tier: 'B', orderRef: '187654321098', amountMinor: 41200 });
  });

  it('a UPI payment proof is tier B and keyed by the UPI reference', () => {
    const claim = paymentProofClaim(
      { params: { utr: '4123 5566 7788', payeeName: 'Tidewater Cafe', payeeVpa: 'tidewater@okicici', amount: '230', txnTime: '2026-10-29' }, timestampS: 1 },
      { brandId: 'local', wallet, providerId: 'upi', proof: {} },
    );
    expect(claim.tier).toBe('B');
    expect(claim.nullifier).toBe(upiNullifier('412355667788'));
    expect(claim.merchant.upiVpa).toBe('tidewater@okicici');
  });
});

describe('rail 2: order emails', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const resolver = async (name: string, type: string) => {
    if (type === 'TXT' && /^(s1\._domainkey\.(swiggy\.in|gmail\.com))$/.test(name)) return [[`v=DKIM1; k=rsa; p=${spki}`]];
    throw Object.assign(new Error(`ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
  };
  const message = [
    'From: Swiggy <noreply@swiggy.in>',
    'To: buyer@example.com',
    'Subject: Your order from Saudade Kitchen was delivered',
    'Date: Wed, 29 Oct 2026 20:15:00 +0530',
    'Message-ID: <abc@swiggy.in>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Your order from Saudade Kitchen was delivered.',
    'Order No: 168452936512',
    '1 x Veg Dum Biryani ₹ 320',
    'Grand Total: ₹ 352',
    '',
  ].join('\r\n');

  async function sign(domain: string, msg: string) {
    const { dkimSign } = await import('mailauth');
    const out = await dkimSign(msg, { signatureData: [{ signingDomain: domain, selector: 's1', privateKey: pem }] } as never);
    return `${(out as { signatures: string }).signatures}${msg}`;
  }

  it('extracts fields with the brand parser', () => {
    const f = extractEmailFields(getBrand('swiggy').email!, 'Your order from Saudade Kitchen was delivered', message.split('\r\n\r\n')[1]!);
    expect(f).toMatchObject({ orderRef: '168452936512', amountMinor: 35200, merchant: 'Saudade Kitchen' });
  });

  it('accepts an original email signed by the brand', async () => {
    const eml = await sign('swiggy.in', message);
    const { claim, brand } = await verifyForwardedEmail({ eml, wallet, resolver });
    expect(brand.id).toBe('swiggy');
    expect(claim.rail).toBe('order_email');
    expect(claim.nullifier).toBe(purchaseNullifier('swiggy', '168452936512'));
    expect(claim.purchasedOn).toBe('2026-10-29');
  });

  it('rejects an edited email and an inline forward', async () => {
    const eml = await sign('swiggy.in', message);
    await expect(verifyForwardedEmail({ eml: eml.replace('₹ 352', '₹ 52'), wallet, resolver })).rejects.toThrow(/did not verify/);
    const forwarded = await sign('gmail.com', message);
    await expect(verifyForwardedEmail({ eml: forwarded, wallet, resolver })).rejects.toThrow(/inline forward/);
  });
});

describe('rail 4: shop-through postbacks', () => {
  it('checks the shared secret and normalises status', () => {
    const pb = parsePostback({
      network: 'cuelinks',
      params: { subid: 'clk_1', order_id: 'OD123', sale_amount: '1499', commission: '75', status: 'approved', secret: 's3cret' },
      secret: 's3cret',
    });
    expect(pb).toMatchObject({ clickId: 'clk_1', orderId: 'OD123', amountMinor: 149900, commissionMinor: 7500, status: 'confirmed' });
    expect(() => parsePostback({ network: 'cuelinks', params: { subid: 'x', order_id: 'y', secret: 'nope' }, secret: 's3cret' })).toThrow(/did not match/);
  });
});

describe('rail 5: merchant receipts', () => {
  it('verifies the merchant signature and rejects tampering', async () => {
    const merchant = privateKeyToAccount(generatePrivateKey());
    const base = {
      merchantId: keccak256(toBytes('m')),
      receiptId: keccak256(toBytes('r1')),
      amountMinor: 23000,
      currency: 'INR',
      items: [{ name: 'Filter Coffee', qty: 2, priceMinor: 9000 }],
      issuedAt: Math.floor(Date.now() / 1000),
    };
    const signature = await merchant.signTypedData(merchantReceiptTypedData(base));
    const claim = await verifyMerchantReceipt({ receipt: { ...base, signature }, signer: merchant.address, merchantName: 'Tidewater Café', wallet });
    expect(claim.tier).toBe('A');
    await expect(
      verifyMerchantReceipt({ receipt: { ...base, amountMinor: 100, signature }, signer: merchant.address, merchantName: 'x', wallet }),
    ).rejects.toThrow(/not signed/);
  });
});

describe('rail 7: ONDC', () => {
  it('verifies a Beckn signature and accepts completed orders', () => {
    const priv = ed25519.utils.randomSecretKey();
    const pub = Buffer.from(ed25519.getPublicKey(priv)).toString('base64');
    const body = JSON.stringify({
      context: { bpp_id: 'seller.example', action: 'on_status' },
      message: { order: { id: 'ONDC-1', state: 'Completed', provider: { id: 'p1', descriptor: { name: 'Goa Bakery' } }, items: [{ descriptor: { name: 'Bebinca' }, quantity: { count: 1 }, price: { value: '250' } }], quote: { price: { value: '250', currency: 'INR' } }, created_at: '2026-10-29T10:00:00Z' } },
    });
    const created = Math.floor(Date.now() / 1000);
    const expires = created + 300;
    const sig = Buffer.from(ed25519.sign(new TextEncoder().encode(becknSigningString(body, created, expires)), priv)).toString('base64');
    const authorization = `Signature keyId="seller.example|k1|ed25519",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${sig}"`;
    const auth = verifyBecknSignature({ body, authorization, publicKeyBase64: pub });
    const claim = ondcOrderClaim({ body, auth, wallet });
    expect(claim).toMatchObject({ rail: 'network_order', tier: 'A', amountMinor: 25000 });
    expect(() => verifyBecknSignature({ body: body.replace('250', '25'), authorization, publicKeyBase64: pub })).toThrow();
  });
});

describe('dev rail', () => {
  it('is always labelled simulated', () => {
    const c = simulatedClaim({ wallet, brandId: 'swiggy', merchantName: 'X', items: [{ name: 'Y', quantity: 1, priceMinor: 100 }] });
    expect(c.simulated).toBe(true);
  });
});
