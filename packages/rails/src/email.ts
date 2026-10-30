import { brandForEmailDomain, findBrand, type Brand, type EmailParser } from '@receipts/brands';
import type { PurchaseClaim, PurchaseItem } from '@receipts/core';
import { RailError, makeClaim, parseAmountMinor, parseDate, sameWallet } from './claim';

// Rail 2: order and booking emails. Two ways in, both checking the sender's DKIM signature:
//   1. ZK Email: the phone proves the email against a per-sender blueprint; we verify the packed proof.
//   2. The forwarded-as-attachment inbox: the original .eml keeps its signature intact, so we verify DKIM
//      ourselves. An inline forward re-wraps the message and breaks the signature, so it is rejected.

export interface EmailFields {
  orderRef: string;
  amountMinor: number | null;
  merchant: string | null;
  items: PurchaseItem[];
  travelDate: string | null;
}

function firstMatch(text: string, res: RegExp[] | undefined): string | null {
  for (const re of res ?? []) {
    const m = new RegExp(re.source, re.flags.replace('g', '')).exec(text);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

export function extractEmailFields(parser: EmailParser, subject: string, text: string): EmailFields {
  const all = `${subject}\n${text}`;
  const orderRef = firstMatch(all, parser.orderId);
  if (!orderRef) throw new RailError('unparseable', 'could not find an order or booking ID in the email');
  const items: PurchaseItem[] = [];
  for (const re of parser.items ?? []) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(g)) {
      const [a, b, price] = [m[1]!, m[2]!, m[3]];
      const qtyFirst = /^\d+$/.test(a);
      items.push({
        name: (qtyFirst ? b : a).trim(),
        quantity: Number(qtyFirst ? a : b) || 1,
        priceMinor: parseAmountMinor(price) ?? undefined,
      });
    }
    if (items.length) break;
  }
  return {
    orderRef,
    amountMinor: parseAmountMinor(firstMatch(all, parser.total)),
    merchant: firstMatch(all, parser.merchant),
    items,
    travelDate: parseDate(firstMatch(all, parser.travelDate)),
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8377;|&#x20b9;/gi, '₹')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n');
}

function domainOf(address: string | undefined): string | null {
  const d = address?.split('@').pop()?.replace(/>$/, '').trim().toLowerCase();
  return d || null;
}

/** Path 2: verify the DKIM signature of an original order email (.eml) and read its fields. */
export async function verifyForwardedEmail(input: {
  eml: string | Uint8Array;
  wallet: string;
  category?: string;
  cityId?: string;
  /** DNS resolver override (tests); defaults to the system resolver for DKIM key lookups. */
  resolver?: (name: string, rrtype: string) => Promise<unknown>;
}): Promise<{ claim: PurchaseClaim; brand: Brand; signingDomain: string }> {
  const raw = typeof input.eml === 'string' ? Buffer.from(input.eml, 'utf8') : Buffer.from(input.eml);
  const { dkimVerify } = await import('mailauth');
  const result = await dkimVerify(raw, input.resolver ? { resolver: input.resolver as never } : {});
  const fromDomain = domainOf(result.headerFrom[0]);
  const fromBrand = fromDomain ? brandForEmailDomain(fromDomain) : null;
  if (!fromBrand?.email) throw new RailError('unknown_brand', `no email rail for ${fromDomain ?? 'this sender'} yet`);

  const passing = result.results.filter((r) => r.status.result === 'pass' && r.signingDomain);
  const aligned = passing.find((r) => brandForEmailDomain(r.signingDomain!)?.id === fromBrand.id && !r.status.underSized);
  if (!aligned) {
    const forwarded = passing.length > 0;
    throw new RailError(
      'not_verified',
      forwarded
        ? 'This looks like an inline forward, which breaks the brand’s signature. Forward the original email as an attachment, or upload the .eml file.'
        : `The DKIM signature from ${fromBrand.name} did not verify. The email may have been edited, or its signing key was rotated.`,
    );
  }

  const PostalMime = (await import('postal-mime')).default;
  const parsed = await PostalMime.parse(raw);
  const text = parsed.text ?? (parsed.html ? htmlToText(parsed.html) : '');
  const fields = extractEmailFields(fromBrand.email, parsed.subject ?? '', text);
  const purchasedOn = parseDate(parsed.date ?? null) ?? new Date().toISOString().slice(0, 10);

  const claim = makeClaim({
    rail: 'order_email',
    brandId: fromBrand.id,
    category: input.category ?? fromBrand.categories[0],
    merchant: { name: fields.merchant ?? fromBrand.name, cityId: input.cityId },
    items: fields.items,
    amountMinor: fields.amountMinor ?? fields.items.reduce((s, i) => s + (i.priceMinor ?? 0) * i.quantity, 0),
    purchasedOn,
    orderRef: fields.orderRef,
    nullifierSource: fromBrand.id,
    boundWallet: input.wallet,
    proof: {
      kind: 'dkim',
      signingDomain: aligned.signingDomain,
      selector: aligned.selector,
      bodyHash: aligned.bodyHash,
      eml: raw.toString('base64'),
    },
    meta: { emailPath: 'dkim', signingDomain: aligned.signingDomain, travelDate: fields.travelDate },
  });
  return { claim, brand: fromBrand, signingDomain: aligned.signingDomain! };
}

/** Path 1: verify a packed ZK Email proof produced on the reviewer's phone against the brand's blueprint. */
export async function verifyZkEmailProof(input: {
  packedProof: string;
  wallet: string;
  brandId: string;
  blueprintSlug: string;
  category?: string;
  cityId?: string;
}): Promise<PurchaseClaim> {
  const brand = findBrand(input.brandId);
  if (!brand) throw new RailError('unknown_brand', `unknown brand ${input.brandId}`);
  const { initZkEmailSdk } = await import('@zk-email/sdk');
  const sdk = initZkEmailSdk({ logging: { enabled: false } } as never);
  const proof = await sdk.unPackProof(input.packedProof);
  const bp = proof.blueprint.props;
  if (bp.slug && bp.slug !== input.blueprintSlug.split('@')[0] && `${bp.slug}` !== input.blueprintSlug) {
    throw new RailError('not_verified', `proof was made with blueprint ${bp.slug}, expected ${input.blueprintSlug}`);
  }
  const sender = bp.senderDomain?.toLowerCase();
  if (sender && brandForEmailDomain(sender)?.id !== brand.id) throw new RailError('not_verified', `blueprint sender ${sender} is not ${brand.name}`);
  if (!(await proof.verify())) throw new RailError('not_verified', 'ZK Email proof did not verify');

  const { publicData, externalInputs } = proof.getProofData();
  const bound = externalInputs?.address ?? externalInputs?.wallet ?? externalInputs?.ethAddress;
  if (!sameWallet(bound, input.wallet)) throw new RailError('wallet_mismatch', 'the email proof is bound to a different wallet');

  const field = (...names: string[]) => {
    for (const n of names) {
      const v = publicData?.[n];
      if (v && v.length) return v.filter(Boolean).join('').trim();
    }
    return null;
  };
  const orderRef = field('orderId', 'order_id', 'bookingId', 'booking_id', 'pnr', 'tripId');
  if (!orderRef) throw new RailError('unparseable', 'the blueprint did not reveal an order ID');
  const itemsRaw = field('items', 'itemNames', 'dishes', 'product');
  return makeClaim({
    rail: 'order_email',
    brandId: brand.id,
    category: input.category ?? brand.categories[0],
    merchant: { name: field('merchant', 'restaurant', 'store', 'hotel', 'airline') ?? brand.name, cityId: input.cityId },
    items: itemsRaw ? itemsRaw.split(/\s*[|\n]\s*/).filter(Boolean).map((name) => ({ name, quantity: 1 })) : [],
    amountMinor: parseAmountMinor(field('total', 'amount', 'orderTotal')) ?? 0,
    purchasedOn: parseDate(field('date', 'orderDate', 'travelDate')) ?? new Date().toISOString().slice(0, 10),
    orderRef,
    nullifierSource: brand.id,
    boundWallet: input.wallet,
    proof: { kind: 'zkemail', packedProof: input.packedProof, blueprint: input.blueprintSlug },
    meta: { emailPath: 'zkemail', blueprint: input.blueprintSlug, travelDate: parseDate(field('travelDate', 'checkout', 'departure')) },
  });
}
