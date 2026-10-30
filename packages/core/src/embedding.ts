import { normalizeName } from './text';

/**
 * Local embeddings for item names and review text: hashed character trigrams plus word unigrams, L2-normalised.
 * Deterministic, free and good at "veg dum biryani" ~ "veg biryani". Stored in pgvector as vector(256).
 */
export const EMBEDDING_DIM = 256;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function embedText(text: string, dim: number = EMBEDDING_DIM): number[] {
  const v = new Float64Array(dim);
  const norm = normalizeName(text);
  if (!norm) return Array.from(v);
  for (const word of norm.split(' ')) {
    const wh = fnv1a(`w:${word}`);
    v[wh % dim]! += (wh & 0x80000000 ? -1 : 1) * 2;
    const padded = ` ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) {
      const g = padded.slice(i, i + 3);
      const h = fnv1a(`g:${g}`);
      v[h % dim]! += h & 0x80000000 ? -1 : 1;
    }
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => Math.round((x / n) * 1e6) / 1e6);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** pgvector literal: "[0.1,0.2,...]" */
export function toPgVector(v: readonly number[]): string {
  return `[${v.join(',')}]`;
}
