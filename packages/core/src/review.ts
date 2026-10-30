import { z } from 'zod';
import { RAILS } from './rails';
import { findPii } from './pii';

export const Diet = z.enum(['veg', 'non_veg', 'vegan', 'egg']);

/** What the LLM must produce from a voice note. Aspect scores run from -1 to 1; null when not mentioned. */
export const StructuredReview = z.object({
  rating: z.number().int().min(1).max(5),
  item: z.string().max(200).nullable(),
  aspects: z.record(z.string(), z.number().min(-1).max(1)),
  claims: z.array(z.string().min(3).max(160)).max(6),
  diet: Diet.nullable(),
  language: z.string().min(2).max(16),
  summary_en: z.string().min(3).max(280),
  /** Accusations about a named person (landlords, staff). Held for human review instead of published. */
  personal_allegation: z.boolean().default(false),
});
export type StructuredReview = z.infer<typeof StructuredReview>;

/** The review JSON pinned to IPFS. Its CID goes on-chain in the ReviewV1 attestation. */
export const ReviewDocument = z.object({
  schema: z.literal('receipts.review.v1'),
  category: z.string(),
  itemId: z.string(),
  item: z.string(),
  merchantId: z.string(),
  merchant: z.string(),
  brand: z.string(),
  rating: z.number().int().min(1).max(5),
  aspects: z.record(z.string(), z.number().min(-1).max(1)),
  claims: z.array(z.string()),
  diet: Diet.nullable(),
  language: z.string(),
  summary_en: z.string(),
  transcript: z.string().nullable(),
  rail: z.enum(RAILS),
  tier: z.enum(['A', 'B']),
  /** Coarse date: a day, or the Monday of the week for small merchants. Never the exact time. */
  purchased: z.string(),
  reviewerId: z.string(),
  simulated: z.boolean(),
});
export type ReviewDocument = z.infer<typeof ReviewDocument>;

export const FollowUpDocument = z.object({
  schema: z.literal('receipts.followup.v1'),
  reviewUid: z.string(),
  dayOffset: z.number().int().nonnegative(),
  kind: z.string(),
  stillGood: z.boolean(),
  newRating: z.number().int().min(0).max(5),
  note: z.string().max(500).nullable(),
  simulated: z.boolean(),
});
export type FollowUpDocument = z.infer<typeof FollowUpDocument>;

export const ReplyDocument = z.object({
  schema: z.literal('receipts.reply.v1'),
  reviewUid: z.string(),
  merchantId: z.string(),
  merchant: z.string(),
  text: z.string().min(1).max(1000),
});
export type ReplyDocument = z.infer<typeof ReplyDocument>;

/** Publish-time text check: no phone numbers, emails, UPI IDs or (for travel) booking references. */
export function reviewTextProblems(doc: Pick<ReviewDocument, 'claims' | 'summary_en' | 'transcript'>, opts: { bookingRefs?: boolean; secrets?: string[] } = {}): string[] {
  const texts = [...doc.claims, doc.summary_en, doc.transcript ?? ''];
  const problems: string[] = [];
  for (const t of texts) for (const m of findPii(t, opts)) problems.push(`${m.kind}: ${m.value}`);
  return problems;
}
