'use client';

import type { ReactNode } from 'react';
import { Button, Card, Notice, Spinner, useSession, useWallet } from '@receipts/react';

/** The dashboard works for a signed-in business wallet; this is the sign-in step. */
export function RequireMerchant({ children }: { children: ReactNode }) {
  const { ready, wallet, privyAvailable, privyFramed, privyPending, connectDevice, connectPrivy } = useWallet();
  const { status, error, signIn } = useSession();
  if (ready && !wallet) {
    return (
      <Card className="space-y-3">
        <p className="font-semibold">Sign in to Receipts</p>
        <p className="text-sm text-muted">
          One account for reviewing and for your business: signing in here signs you in on the reviewer site too. This wallet signs your public replies
          and your customers’ receipts.
        </p>
        <div className="flex flex-wrap gap-2">
          {privyAvailable ? (
            <Button onClick={connectPrivy} busy={privyPending}>
              Sign in with email
            </Button>
          ) : null}
          <Button tone={privyAvailable ? 'secondary' : 'primary'} onClick={connectDevice}>
            Use a wallet on this device
          </Button>
          {privyFramed ? <p className="w-full text-xs text-muted">Email sign-in needs a normal browser tab: this page is open inside another app's frame.</p> : null}
        </div>
      </Card>
    );
  }
  if (status === 'error') {
    return (
      <Card className="space-y-3">
        <Notice tone="bad">{error}</Notice>
        <Button tone="secondary" onClick={() => void signIn()}>
          Try again
        </Button>
      </Card>
    );
  }
  // Only a finished sign-in shows the dashboard: right after a wallet connects the session has not started signing
  // in yet, and the dashboard's first calls would go out without a token.
  if (status !== 'signed-in') {
    return (
      <Card className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Signing in…
      </Card>
    );
  }
  return <>{children}</>;
}
