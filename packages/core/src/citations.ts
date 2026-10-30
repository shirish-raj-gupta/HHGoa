import { contentWords, stem } from './text';

// An answer that cites nothing is never returned, and a claim whose citations do not check out is dropped.

export interface DraftClaim {
  text: string;
  reviewIds: string[];
}

export interface EvidenceReview {
  reviewId: string;
  /** Claims and summary from the review JSON; a claim must be grounded in at least one cited review. */
  texts: string[];
  trustWeight: number;
}

export interface ValidationResult {
  kept: DraftClaim[];
  dropped: { claim: DraftClaim; reason: string }[];
}

const INSTRUCTION_LIKE = /\b(ignore (all|previous|the above)|system prompt|rank (us|me|this) first|disregard|you are now)\b/i;

/**
 * Keep a claim only if: it cites at least one review, every cited review is in the evidence set, the claim shares
 * content words with what the cited reviews actually said, and it does not read like an injected instruction.
 */
export function validateClaims(
  claims: readonly DraftClaim[],
  evidence: ReadonlyMap<string, EvidenceReview>,
  opts: { maxClaims?: number; minOverlap?: number } = {},
): ValidationResult {
  const maxClaims = opts.maxClaims ?? 5;
  const minOverlap = opts.minOverlap ?? 0.34;
  const kept: DraftClaim[] = [];
  const dropped: ValidationResult['dropped'] = [];
  for (const claim of claims) {
    const ids = [...new Set(claim.reviewIds)];
    if (ids.length === 0) {
      dropped.push({ claim, reason: 'no citations' });
      continue;
    }
    const missing = ids.filter((id) => !evidence.has(id));
    if (missing.length) {
      dropped.push({ claim, reason: `cites reviews outside the evidence set: ${missing.join(', ')}` });
      continue;
    }
    if (INSTRUCTION_LIKE.test(claim.text)) {
      dropped.push({ claim, reason: 'instruction-like text' });
      continue;
    }
    const words = contentWords(claim.text);
    if (words.length > 0) {
      const source = new Set(ids.flatMap((id) => evidence.get(id)!.texts.flatMap((t) => contentWords(t))));
      const sourceStems = new Set([...source].map(stem));
      const hits = words.filter((w) => source.has(w) || sourceStems.has(stem(w))).length;
      if (hits / words.length < minOverlap) {
        dropped.push({ claim, reason: 'not grounded in the cited reviews' });
        continue;
      }
    }
    if (kept.length >= maxClaims) {
      dropped.push({ claim, reason: 'over the claim limit' });
      continue;
    }
    kept.push({ text: claim.text.trim(), reviewIds: ids });
  }
  return { kept, dropped };
}

/**
 * Citation weight = the review's trust weight x its relevance to the answer, normalised across the cited reviews.
 * Relevance counts how many kept claims cite the review, scaled by the rank of the option it supports.
 */
export function citationWeights(
  cited: readonly { reviewId: string; trustWeight: number; relevance: number }[],
): { reviewId: string; weight: number }[] {
  const merged = new Map<string, { trustWeight: number; relevance: number }>();
  for (const c of cited) {
    const prev = merged.get(c.reviewId);
    if (prev) prev.relevance += c.relevance;
    else merged.set(c.reviewId, { trustWeight: c.trustWeight, relevance: c.relevance });
  }
  const raw = [...merged].map(([reviewId, v]) => ({ reviewId, w: Math.max(0, v.trustWeight) * Math.max(0, v.relevance) }));
  const total = raw.reduce((s, r) => s + r.w, 0);
  if (total <= 0) return raw.map((r) => ({ reviewId: r.reviewId, weight: raw.length ? 1 / raw.length : 0 }));
  return raw.map((r) => ({ reviewId: r.reviewId, weight: r.w / total })).sort((a, b) => b.weight - a.weight);
}
