import { SANDBOX_PAGES, PLANTED_RESTAURANT, type SandboxPage } from './pages';

export { SANDBOX_PAGES, PLANTED_RESTAURANT, type SandboxPage };

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}₹ ]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * A plain keyword search engine (term frequency, title boost, recency), the kind keyword-stuffed pages win. That is
 * the point: the baseline agent searches an ordinary, gameable web.
 */
export function sandboxSearch(query: string, limit = 6): { slug: string; title: string; site: string; snippet: string; url: string }[] {
  const q = tokens(query);
  const scored = SANDBOX_PAGES.map((p) => {
    const body = tokens(p.body);
    const title = tokens(p.title);
    let score = 0;
    for (const t of q) {
      score += body.filter((w) => w === t).length;
      score += 3 * title.filter((w) => w === t).length;
    }
    score *= 1 + (Date.parse(p.published) - Date.parse('2026-01-01')) / (365 * 86_400_000);
    return { p, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p }) => ({ slug: p.slug, title: p.title, site: p.site, snippet: p.body.slice(0, 180), url: `sandbox://${p.site}/${p.slug}` }));
}

export function sandboxPage(slugOrUrl: string): SandboxPage | null {
  const slug = slugOrUrl.split('/').pop() ?? slugOrUrl;
  return SANDBOX_PAGES.find((p) => p.slug === slug) ?? null;
}
