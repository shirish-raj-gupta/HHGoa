import { Card, PageTitle, Tag } from '@receipts/react';
import { TestCheckout } from './test-checkout';

// Where "Buy via Receipts" lands while a brand has no approved affiliate campaign (DEMO_MODE only): the network's
// test conversion flow, labelled as such. In production the click goes to the brand's store through the network.

export const metadata = { title: 'Test checkout' };

export default async function ShopTest({ searchParams }: { searchParams: Promise<{ click?: string; item?: string }> }) {
  const { click, item } = await searchParams;
  return (
    <div className="space-y-4">
      <PageTitle eyebrow="Simulated store" title="Test checkout" sub="This stands in for the brand’s store while its affiliate campaign is pending." />
      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{item ?? 'Item'}</span>
          <Tag tone="warn">test network</Tag>
        </div>
        <p className="text-sm text-muted">
          Bought through a Receipts link, a purchase reports back by itself (a postback from the affiliate network), so you can review it with a tier B proof. Receipts may earn
          a commission; 50% of it comes back to you as cashback once the brand confirms the order. Reviewers are never paid for sales.
        </p>
        {click ? <TestCheckout clickId={click} /> : <p className="text-sm text-bad">Missing click ID.</p>}
      </Card>
    </div>
  );
}
