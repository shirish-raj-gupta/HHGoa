import type { Rail } from '@receipts/core';
import { BRANDS } from './brands';
import type { Brand, BrandRail } from './types';

export * from './types';
export { RECLAIM_PROVIDERS, defaultReclaimProvider, reclaimProvider, type ReclaimField, type ReclaimProvider } from './reclaim';
export { BRANDS };

const BY_ID = new Map(BRANDS.map((b) => [b.id, b]));

export function getBrand(id: string): Brand {
  const b = BY_ID.get(id);
  if (!b) throw new Error(`unknown brand ${id}`);
  return b;
}

export function findBrand(id: string | null | undefined): Brand | null {
  return (id && BY_ID.get(id)) || null;
}

export function brandRail(brand: Brand, rail: Rail): BrandRail | null {
  return brand.rails.find((r) => r.rail === rail) ?? null;
}

/** Resolve a provider ID or blueprint from the registry, falling back to the env var named there. */
/** A rail's provider and blueprint: an env var set during prep wins over the registry default. */
export function resolveRailConfig(br: BrandRail, env: Record<string, string | undefined> = process.env): { providerId?: string; blueprint?: string } {
  return {
    providerId: (br.providerEnv ? env[br.providerEnv] : undefined) || br.providerId,
    blueprint: br.blueprint ?? (br.blueprintEnv ? env[br.blueprintEnv] : undefined),
  };
}

/** Which brand sent this email? Matches the DKIM d= or From domain against each brand's organisational domains. */
export function brandForEmailDomain(domain: string): Brand | null {
  const d = domain.toLowerCase();
  for (const b of BRANDS) {
    const domains = b.email?.dkimDomains ?? b.domains;
    if (domains.some((x) => d === x || d.endsWith(`.${x}`))) return b;
  }
  return null;
}

export function brandsForCategory(category: string): Brand[] {
  return BRANDS.filter((b) => b.categories.includes(category));
}
