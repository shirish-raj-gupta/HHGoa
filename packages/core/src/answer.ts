import { z } from 'zod';

/** What the query engine parses a question into. */
export const QueryFilters = z.object({
  category: z.string().nullable().default(null),
  /** dish, product, room type or service the asker wants */
  item: z.string().nullable().default(null),
  diet: z.enum(['veg', 'non_veg', 'vegan', 'egg']).nullable().default(null),
  /** price actually paid, from proofs */
  maxPriceInr: z.number().positive().nullable().default(null),
  place: z.string().nullable().default(null),
  lat: z.number().nullable().default(null),
  lng: z.number().nullable().default(null),
  radiusKm: z.number().positive().max(100).default(5),
  cityId: z.string().nullable().default(null),
  /** free-text qualities: "quiet", "for remote work", "durable" */
  qualities: z.array(z.string()).default([]),
  sort: z.enum(['best', 'cheapest', 'durable']).default('best'),
});
export type QueryFilters = z.infer<typeof QueryFilters>;

export const AnswerClaim = z.object({
  text: z.string(),
  receipts: z.array(z.string()),
  review_ids: z.array(z.string()),
});

export const AnswerOption = z.object({
  item: z.string(),
  item_id: z.string(),
  merchant: z.string(),
  merchant_id: z.string(),
  category: z.string(),
  score: z.number(),
  verified_reviews: z.number().int(),
  still_good_next_day: z.number().nullable(),
  durability: z.number().nullable(),
  price_paid_inr: z.object({ min: z.number(), max: z.number() }).nullable(),
  distance_km: z.number().nullable(),
  claims: z.array(AnswerClaim),
  buy_link: z.string().nullable(),
  few_receipts: z.boolean(),
});
export type AnswerOption = z.infer<typeof AnswerOption>;

export const Answer = z.object({
  answer_id: z.string(),
  query: z.string(),
  filters: QueryFilters,
  summary: z.string(),
  options: z.array(AnswerOption),
  not_enough_receipts: z.boolean(),
  payment: z
    .object({ amount_usdc: z.string(), network: z.string(), tx: z.string().nullable(), method: z.enum(['x402', 'credits', 'free']) })
    .nullable(),
  paid_to_reviewers_usdc: z.string(),
  disclosure: z.string(),
  generated_by: z.enum(['llm', 'extractive', 'cache']),
});
export type Answer = z.infer<typeof Answer>;

/** The build spec's disclosure, word for word (A0 rule 11): on every receipt page, payout screen and buy link. */
export const PAID_REVIEW_DISCLOSURE =
  'Reviewers are paid when AI agents use their reviews, whatever the rating. Receipts may earn a commission on purchases made through its links.';
