import { PLANTED_RESTAURANT, SANDBOX_PAGES } from '@receipts/agent/sandbox';
import { Card, Tag } from '@receipts/react';

export const metadata = { title: 'The sandbox · Receipts' };

// Full disclosure of what the left-hand agent searched: ten local pages, never published. Four are planted SEO
// pages for a fictional restaurant; the rest are generic and name no business.

export default function SandboxPage() {
  const pages = [...SANDBOX_PAGES].sort((a, b) => Number(b.planted) - Number(a.planted));
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">The web the left agent searched</h1>
        <p className="text-muted">
          A local copy with {SANDBOX_PAGES.length} pages, served only to the demo agent. {SANDBOX_PAGES.filter((p) => p.planted).length} were written to push “{PLANTED_RESTAURANT}”, a
          restaurant that does not exist. Nothing here is published on the internet.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {pages.map((p) => (
          <Card key={p.slug} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {p.planted ? <Tag tone="bad">planted</Tag> : <Tag>generic</Tag>}
              <span className="font-mono text-xs text-muted">
                {p.site} · {p.published}
              </span>
            </div>
            <div className="font-semibold">{p.title}</div>
            <p className="text-sm text-muted">{p.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
