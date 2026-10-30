'use client';

import type { ReactNode } from 'react';
import { Fingerprint } from 'lucide-react';
import { Card, EmptyState, LinkButton, Spinner, useSession } from '@receipts/react';

/** Pages that need a verified human: show the way there instead of an error. */
export function RequireHuman({ children, what = 'review' }: { children: ReactNode; what?: string }) {
  const { status, human } = useSession();
  if (status === 'loading' || status === 'signing-in') {
    return (
      <Card className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Signing in…
      </Card>
    );
  }
  if (status !== 'signed-in' || !human) {
    return (
      <EmptyState icon={<Fingerprint />} title="One human, one voice" action={<LinkButton href="/onboard">Get started</LinkButton>}>
        To {what}, connect a wallet and prove you are one human. It takes a minute and reveals nothing about you.
      </EmptyState>
    );
  }
  return <>{children}</>;
}
