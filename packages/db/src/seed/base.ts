import { BRANDS, resolveRailConfig } from '@receipts/brands';
import { CATEGORY_CONFIGS } from '@receipts/categories';
import { CITIES } from '@receipts/core';
import type { Db } from '../client';

/** Cities, categories and the brand registry. Safe to re-run: everything is an upsert. */
export async function seedBase(db: Db, env: Record<string, string | undefined> = process.env): Promise<void> {
  for (const c of CITIES) {
    await db.query(
      `INSERT INTO cities (id, name, bbox, center, timezone, languages, currency, thresholds, localities, status)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, bbox = EXCLUDED.bbox, center = EXCLUDED.center,
         timezone = EXCLUDED.timezone, languages = EXCLUDED.languages, thresholds = EXCLUDED.thresholds,
         localities = EXCLUDED.localities, status = EXCLUDED.status`,
      [
        c.city,
        c.name,
        c.bbox,
        c.center[0],
        c.center[1],
        c.timezone,
        c.languages,
        c.currency,
        { min_receipts_to_rank: c.min_receipts_to_rank },
        c.localities,
        c.status,
      ],
    );
  }

  for (const c of CATEGORY_CONFIGS) {
    await db.query(
      `INSERT INTO categories (id, name, rails, aspects, followups, rules)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, rails = EXCLUDED.rails, aspects = EXCLUDED.aspects,
         followups = EXCLUDED.followups, rules = EXCLUDED.rules`,
      [c.category, c.name, c.rails, c.aspects, c.followups, c],
    );
  }

  for (const b of BRANDS) {
    await db.query(
      `INSERT INTO brands (id, name, grp, domains, categories, default_rail) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, grp = EXCLUDED.grp, domains = EXCLUDED.domains,
         categories = EXCLUDED.categories, default_rail = EXCLUDED.default_rail`,
      [b.id, b.name, b.group, b.domains, b.categories, b.defaultRail],
    );
    for (const r of b.rails) {
      const { providerId, blueprint } = resolveRailConfig(r, env);
      await db.query(
        `INSERT INTO brand_rails (brand_id, rail, provider_id, blueprint, network, campaign_id, incentive_allowed, deeplink_template, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (brand_id, rail) DO UPDATE SET
           provider_id = COALESCE(EXCLUDED.provider_id, brand_rails.provider_id),
           blueprint = COALESCE(EXCLUDED.blueprint, brand_rails.blueprint),
           network = EXCLUDED.network, campaign_id = COALESCE(EXCLUDED.campaign_id, brand_rails.campaign_id),
           incentive_allowed = COALESCE(EXCLUDED.incentive_allowed, brand_rails.incentive_allowed),
           deeplink_template = EXCLUDED.deeplink_template, notes = EXCLUDED.notes,
           status = CASE WHEN brand_rails.last_tested_at IS NULL THEN EXCLUDED.status ELSE brand_rails.status END`,
        [
          b.id,
          r.rail,
          providerId ?? null,
          blueprint ?? null,
          r.network ?? null,
          r.campaignId ?? null,
          r.incentiveAllowed ?? null,
          r.deeplinkTemplate ?? null,
          r.status,
          r.notes ?? null,
        ],
      );
    }
  }
}
