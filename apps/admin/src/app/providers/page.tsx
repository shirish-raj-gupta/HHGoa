'use client';

import { BRANDS, RECLAIM_PROVIDERS } from '@receipts/brands';
import { Card, ExternalLink, Mono, PageTitle, Tag } from '@receipts/react';

// Which brand proves purchases through which Reclaim provider, and how sure we are. Every community provider stays
// "testing" until a real order has gone through it on two phones; then flip its rail to "live" in
// packages/brands/src/brands.ts. RECLAIM_PROVIDER_<BRAND> on the API overrides a default.

export default function Providers() {
  const pageRails = BRANDS.flatMap((b) => b.rails.filter((r) => r.rail === 'order_page' || r.rail === 'payment_proof').map((r) => ({ brand: b, rail: r })));
  return (
    <div className="space-y-6">
      <PageTitle
        eyebrow="Proof rails"
        title="Reclaim providers"
        sub={`${RECLAIM_PROVIDERS.length} providers from Reclaim's directory are built in. A brand without one can still be proven by its order email or a payment.`}
      />
      <div className="grid gap-3 md:grid-cols-2">
        {pageRails.map(({ brand, rail }) => {
          const p = RECLAIM_PROVIDERS.find((x) => x.brandId === brand.id && x.rail === rail.rail);
          return (
            <Card key={`${brand.id}-${rail.rail}`} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-bold">{brand.name}</span>
                <Tag>{rail.rail === 'order_page' ? 'order page' : 'payment proof'}</Tag>
                <Tag tone={rail.status === 'live' ? 'good' : rail.status === 'testing' ? 'warn' : 'neutral'}>{rail.status}</Tag>
              </div>
              {p ? (
                <>
                  <p className="text-sm">Proves {p.proves}.</p>
                  {p.alsoShares ? <p className="text-xs text-warn">Also shares {p.alsoShares}.</p> : null}
                  <p className="text-xs text-muted">
                    {p.verified ? 'Verified by Reclaim' : 'Community provider'}: {p.name} · checked {p.checked}
                  </p>
                  <Mono>
                    <ExternalLink href={`https://dev.reclaimprotocol.org/provider/details/${p.id}`}>{p.id}</ExternalLink>
                  </Mono>
                </>
              ) : (
                <p className="text-sm text-muted">
                  No provider in Reclaim&apos;s directory proves an order here. Build one in the Reclaim devtool, then set{' '}
                  <Mono>{rail.providerEnv ?? `RECLAIM_PROVIDER_${brand.id.toUpperCase()}`}</Mono> on the API.
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
