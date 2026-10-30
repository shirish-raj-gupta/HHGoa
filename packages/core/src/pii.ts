// Review text must never carry phone numbers, email addresses, UPI IDs or booking references.

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'upi', re: /\b[A-Za-z0-9.\-_]{2,}@(?:ok)?(?:axis|hdfc|icici|sbi|ybl|ibl|paytm|upi|apl|axl|kotak|okhdfcbank|okicici|oksbi|okaxis|yesbank|fbl|idfcbank|pz|jupiteraxis|freecharge|airtel|abfspay)\b/gi },
  // Indian mobile numbers with optional +91 / 0 prefix, and generic 10+ digit runs with separators.
  { kind: 'phone', re: /(?:\+?91[\s-]?|\b0)?[6-9]\d{4}[\s-]?\d{5}\b/g },
  { kind: 'phone', re: /\+\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/g },
];

/** Travel categories additionally strip PNR-like references (10-digit rail PNRs, 6-character airline PNRs). */
const BOOKING_PATTERNS: RegExp[] = [/\bPNR[:\s#-]*[A-Z0-9]{5,10}\b/gi, /\b\d{10}\b/g, /\b(?=[A-Z0-9]{6}\b)(?=[A-Z]*\d)(?=\d*[A-Z])[A-Z0-9]{6}\b/g];

export interface PiiMatch {
  kind: string;
  value: string;
}

export function findPii(text: string, opts: { bookingRefs?: boolean; secrets?: string[] } = {}): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const { kind, re } of PATTERNS) {
    for (const m of text.matchAll(re)) out.push({ kind, value: m[0] });
  }
  if (opts.bookingRefs) {
    for (const re of BOOKING_PATTERNS) for (const m of text.matchAll(re)) out.push({ kind: 'booking_ref', value: m[0] });
  }
  for (const s of opts.secrets ?? []) {
    if (s && s.length >= 4 && text.includes(s)) out.push({ kind: 'order_ref', value: s });
  }
  return out;
}

export function redactPii(text: string, opts: { bookingRefs?: boolean; secrets?: string[] } = {}): string {
  let out = text;
  for (const m of findPii(text, opts)) out = out.split(m.value).join('[removed]');
  return out;
}
