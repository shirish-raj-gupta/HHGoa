import { Card, LinkButton, PageTitle } from '@receipts/react';

// Dodo Payments returns here after checkout; the plan changes when its webhook arrives, usually within seconds.

export default async function Billing({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  return (
    <div>
      <PageTitle eyebrow="Plan" title="Billing" />
      <Card className="space-y-3">
        <p className="text-sm">{checkout === 'done' ? 'Thanks. Your plan updates as soon as the payment is confirmed.' : 'Manage your plan from a listing’s dashboard.'}</p>
        <LinkButton href="/">Back to your listings</LinkButton>
      </Card>
    </div>
  );
}
