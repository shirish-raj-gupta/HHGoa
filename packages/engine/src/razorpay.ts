import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Env } from './config';

// RazorpayX payouts to UPI IDs (reviewer rupee withdrawals, buyer cashback) and Razorpay payment links (the
// merchant's ₹1 UPI ownership check). Use rzp_test_ keys at the event: test mode simulates the money movement.

export class RazorpayUnavailable extends Error {
  constructor(what: string) {
    super(`${what} is not configured (RAZORPAYX_KEY_ID / RAZORPAYX_KEY_SECRET${what === 'RazorpayX payouts' ? ' / RAZORPAYX_ACCOUNT_NUMBER' : ''})`);
  }
}

function auth(env: Env): string {
  return `Basic ${Buffer.from(`${env.RAZORPAYX_KEY_ID}:${env.RAZORPAYX_KEY_SECRET}`).toString('base64')}`;
}

export function isTestMode(env: Env): boolean {
  return !!env.RAZORPAYX_KEY_ID?.startsWith('rzp_test_');
}

export async function createUpiPayout(
  env: Env,
  p: { amountPaise: number; vpa: string; name: string; referenceId: string; narration: string; notes?: Record<string, string> },
): Promise<{ id: string; status: string; testMode: boolean }> {
  if (!env.RAZORPAYX_KEY_ID || !env.RAZORPAYX_KEY_SECRET || !env.RAZORPAYX_ACCOUNT_NUMBER) throw new RazorpayUnavailable('RazorpayX payouts');
  const res = await fetch('https://api.razorpay.com/v1/payouts', {
    method: 'POST',
    headers: { authorization: auth(env), 'content-type': 'application/json', 'X-Payout-Idempotency': randomUUID() },
    body: JSON.stringify({
      account_number: env.RAZORPAYX_ACCOUNT_NUMBER,
      amount: p.amountPaise,
      currency: 'INR',
      mode: 'UPI',
      purpose: 'payout',
      fund_account: {
        account_type: 'vpa',
        vpa: { address: p.vpa },
        contact: { name: p.name.slice(0, 50), type: 'customer', reference_id: p.referenceId.slice(0, 40) },
      },
      queue_if_low_balance: true,
      reference_id: p.referenceId.slice(0, 40),
      narration: p.narration.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30),
      notes: p.notes ?? {},
    }),
  });
  const data = (await res.json()) as { id?: string; status?: string; error?: { description?: string } };
  if (!res.ok || !data.id) throw new Error(`RazorpayX payout failed: ${data.error?.description ?? res.status}`);
  return { id: data.id, status: data.status ?? 'processing', testMode: isTestMode(env) };
}

/**
 * A ₹1 payment link the merchant pays from the UPI ID their customers pay; the webhook tells us who paid. Razorpay
 * refuses UPI payment links in test mode, so test keys get a standard link limited to UPI on the hosted page.
 */
export async function createPaymentLink(
  env: Env,
  p: { amountPaise: number; description: string; referenceId: string; callbackUrl?: string; notes?: Record<string, string> },
): Promise<{ id: string; shortUrl: string }> {
  if (!env.RAZORPAYX_KEY_ID || !env.RAZORPAYX_KEY_SECRET) throw new RazorpayUnavailable('Razorpay payment links');
  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: { authorization: auth(env), 'content-type': 'application/json' },
    body: JSON.stringify({
      amount: p.amountPaise,
      currency: 'INR',
      description: p.description,
      reference_id: p.referenceId,
      // Live: a UPI payment link. Test mode refuses UPI links, and its checkout may offer no UPI at all ("No appropriate
      // payment method found"), so test links take any method Razorpay's test account offers, such as a test card.
      ...(isTestMode(env) ? {} : { upi_link: true }),
      notes: p.notes ?? {},
      ...(p.callbackUrl ? { callback_url: p.callbackUrl, callback_method: 'get' } : {}),
    }),
  });
  const data = (await res.json()) as { id?: string; short_url?: string; error?: { description?: string } };
  if (!res.ok || !data.id) throw new Error(`Razorpay payment link failed: ${data.error?.description ?? res.status}`);
  return { id: data.id, shortUrl: data.short_url ?? '' };
}

export function verifyRazorpayWebhook(rawBody: string, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Whether a payment link was paid, and from which UPI ID. For servers Razorpay's webhook cannot reach (localhost in
 *  development): the claim page asks, rather than waiting for a webhook that never comes. Looks the link up by its ID,
 *  or by its reference (the claim ID) for links made before the ID was kept. */
export async function paymentLinkPayment(env: Env, ref: { id?: string | null; referenceId: string }): Promise<{ paid: boolean; payerVpa: string | null }> {
  if (!env.RAZORPAYX_KEY_ID || !env.RAZORPAYX_KEY_SECRET) return { paid: false, payerVpa: null };
  const headers = { authorization: auth(env) };
  const url = ref.id
    ? `https://api.razorpay.com/v1/payment_links/${encodeURIComponent(ref.id)}`
    : `https://api.razorpay.com/v1/payment_links?reference_id=${encodeURIComponent(ref.referenceId)}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res?.ok) return { paid: false, payerVpa: null };
  type Link = { status?: string; payments?: { payment_id: string; status: string }[] | null };
  const json = (await res.json()) as Link & { payment_links?: Link[] };
  const link = ref.id ? json : json.payment_links?.find((l) => l.status === 'paid') ?? json.payment_links?.[0];
  if (link?.status !== 'paid') return { paid: false, payerVpa: null };
  const paymentId = link.payments?.find((p) => p.status === 'captured')?.payment_id ?? link.payments?.[0]?.payment_id;
  if (!paymentId) return { paid: true, payerVpa: null };
  const pay = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const vpa = pay?.ok ? ((await pay.json()) as { vpa?: string | null }).vpa : null;
  return { paid: true, payerVpa: vpa?.toLowerCase() ?? null };
}
