import { normalizeName, parseFollowups, type CategoryConfig, type Rail } from '@receipts/core';
import { CATEGORY_CONFIGS } from './configs.generated';

export { CATEGORY_CONFIGS };

const BY_ID = new Map(CATEGORY_CONFIGS.map((c) => [c.category, c]));

export function getCategory(id: string): CategoryConfig {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`unknown category ${id}`);
  return c;
}

export function findCategory(id: string | null | undefined): CategoryConfig | null {
  return (id && BY_ID.get(id)) || null;
}

export function categoriesForRail(rail: Rail): CategoryConfig[] {
  return CATEGORY_CONFIGS.filter((c) => c.rails.includes(rail));
}

/** Route a free-text question or item name to a category by keywords. Longest keyword wins. */
export function guessCategory(text: string): CategoryConfig | null {
  const t = ` ${normalizeName(text)} `;
  let best: { c: CategoryConfig; len: number } | null = null;
  for (const c of CATEGORY_CONFIGS) {
    for (const k of c.keywords) {
      const nk = normalizeName(k);
      if (nk && t.includes(` ${nk} `) && (!best || nk.length > best.len)) best = { c, len: nk.length };
    }
  }
  return best?.c ?? null;
}

export function followupPlan(c: CategoryConfig) {
  return parseFollowups(c.followups);
}

/**
 * JSON schema the LLM must fill when turning a transcript into a structured review. Kept to the subset every
 * provider's structured-output mode accepts; ranges are enforced afterwards with zod.
 */
export function reviewJsonSchema(c: CategoryConfig) {
  const aspectProps = Object.fromEntries(
    c.aspects.map((a) => [
      a,
      {
        anyOf: [{ type: 'number' }, { type: 'null' }],
        description: `-1 (very bad) to 1 (very good); null if the reviewer did not mention ${a.replace(/_/g, ' ')}`,
      },
    ]),
  );
  return {
    type: 'object',
    additionalProperties: false,
    required: ['rating', 'item', 'aspects', 'claims', 'diet', 'language', 'summary_en', 'personal_allegation'],
    properties: {
      rating: { type: 'integer', description: 'Overall stars, 1 to 5, as the reviewer expressed it' },
      item: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description: `The ${c.item_noun} reviewed, copied from the proven purchase items when possible; null if only the merchant is reviewed`,
      },
      aspects: { type: 'object', additionalProperties: false, required: c.aspects, properties: aspectProps },
      claims: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to 6 short factual claims in English, each under 15 words, only things the reviewer actually said',
      },
      diet: {
        anyOf: [{ type: 'string', enum: ['veg', 'non_veg', 'vegan', 'egg'] }, { type: 'null' }],
        description: 'Only for food',
      },
      language: { type: 'string', description: 'BCP-47 code of the spoken language, e.g. hi-IN or en-IN' },
      summary_en: { type: 'string', description: 'One-sentence English summary, under 25 words' },
      personal_allegation: {
        type: 'boolean',
        description: 'True if the review accuses a named or identifiable person of wrongdoing',
      },
    },
  } as const;
}
