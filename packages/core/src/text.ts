// Small text and date helpers shared by every package.

const COMBINING = /[̀-ͯ]/g;

/** Lowercase, strip accents and punctuation, collapse whitespace. "Veg Dum-Biryani!" -> "veg dum biryani". */
export function normalizeName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function slugify(input: string): string {
  return normalizeName(input).replace(/ /g, '-').slice(0, 80);
}

export const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from had has have i if in into is it its of on or so that the their them ' +
    'then there these they this to too was we were what when where which who will with you your very really just ' +
    'also not no it’s its was were been being my me our us he she his her than more most some any all each one two ' +
    'near best under over good great nice ok okay place'
  ).split(' '),
);

/** Crude English stem: drop common suffixes, keep at most 5 letters. "portions" and "portion" both -> "porti". */
export function stem(word: string): string {
  const w = word.replace(/(ings?|edly|ed|es|ly|s)$/u, '');
  return (w.length >= 3 ? w : word).slice(0, 5);
}

export function contentWords(text: string): string[] {
  return normalizeName(text)
    .split(' ')
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 (UTC). This coarse day is what goes on-chain as purchaseDay. */
export function toPurchaseDay(date: string | Date): number {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  return Math.floor(d.getTime() / DAY_MS);
}

export function fromPurchaseDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week, used when a small merchant's reviews are published at week granularity. */
export function weekOf(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return isoDate(new Date(d.getTime() - dow * DAY_MS));
}

export function daysBetween(a: Date | string, b: Date | string): number {
  const ta = typeof a === 'string' ? new Date(a).getTime() : a.getTime();
  const tb = typeof b === 'string' ? new Date(b).getTime() : b.getTime();
  return (tb - ta) / DAY_MS;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}
