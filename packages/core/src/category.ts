import { z } from 'zod';
import { RAILS } from './rails';

/**
 * Every category reuses the same pipeline; only four things change: which rails prove it, which aspects the LLM
 * extracts, when to ask again, and a few category rules. Adding a category is a YAML file, not new code.
 */
export const FollowupSpec = z
  .string()
  .regex(/^(\d+d|trip_end|move_out|return_window|renewal)$/, 'e.g. 1d, 30d, trip_end, move_out, return_window, renewal');

export const CategoryConfig = z.object({
  category: z.string().regex(/^[a-z_]+$/),
  name: z.string(),
  /** Rails that prove a purchase in this category. */
  rails: z.array(z.enum(RAILS)).min(1),
  aspects: z.array(z.string().regex(/^[a-z_]+$/)).min(1),
  followups: z.array(FollowupSpec).default([]),
  /** What a reviewed "item" is called: dish, product, stay, service, building, plan, api. */
  item_noun: z.string().default('item'),
  /** Oldest purchase that can still be reviewed. */
  recency_days: z.number().int().positive().default(30),
  decay_half_life_days: z.number().positive().default(90),
  min_receipts_to_rank: z.number().int().positive().default(3),
  /** Landlords: at least N payments spanning M months. */
  min_proof: z.object({ payments: z.number().int().positive(), span_months: z.number().int().positive() }).optional(),
  publish: z
    .object({
      level: z.enum(['item', 'merchant', 'building']).default('item'),
      delay: z.enum(['none', 'random_0_24h', 'after_travel_date', 'until_move_out_or_90d']).default('none'),
      date_granularity: z.enum(['day', 'week']).default('day'),
      redact_booking_refs: z.boolean().default(false),
    })
    .default({ level: 'item', delay: 'none', date_granularity: 'day', redact_booking_refs: false }),
  moderation: z
    .object({
      personal_allegations: z.enum(['allow', 'hold_for_review']).default('allow'),
      fake_product_claims: z.enum(['allow', 'hold_for_review']).default('allow'),
    })
    .default({ personal_allegations: 'allow', fake_product_claims: 'allow' }),
  /** Item-level claims need the item in a tier A proof, else they count at half weight. */
  item_must_be_in_proof: z.boolean().default(true),
  /** Rate the store and the platform separately (groceries). */
  rate_platform_separately: z.boolean().default(false),
  /** Also write ERC-8004 feedback (agents and APIs). */
  erc8004: z.boolean().default(false),
  rules: z.array(z.string()).default([]),
  prompt: z.object({ en: z.string(), hi: z.string() }),
  /** Words that route a free-text question to this category. */
  keywords: z.array(z.string()).default([]),
});
export type CategoryConfig = z.infer<typeof CategoryConfig>;

export interface FollowupPlan {
  kind: string;
  /** Days after the review when the check-in is due; null when it waits for an event date. */
  dayOffset: number | null;
  event?: 'trip_end' | 'move_out' | 'return_window' | 'renewal';
}

export function parseFollowups(specs: string[]): FollowupPlan[] {
  return specs.map((s) => {
    const m = /^(\d+)d$/.exec(s);
    if (m) return { kind: s, dayOffset: Number(m[1]) };
    return { kind: s, dayOffset: null, event: s as FollowupPlan['event'] };
  });
}

/**
 * The resolver's window for a follow-up at `dayOffset` days: [D - max(1, D/6), D + max(2, D/3)] days.
 * 30 -> 25..40, 1 -> 0..3, 90 -> 75..120. Must match ReceiptsResolver.followUpWindow.
 */
export function followUpWindowDays(dayOffset: number): [number, number] {
  const lower = Math.max(0, dayOffset - Math.max(1, Math.floor(dayOffset / 6)));
  const upper = dayOffset + Math.max(2, Math.floor(dayOffset / 3));
  return [lower, upper];
}
