'use client';

import { use, useCallback, useEffect, useState } from 'react';
import type { ClaimStarted } from '@receipts/client';
import { Button, Card, errorText, LinkButton, Mono, Notice, PageTitle, useSession } from '@receipts/react';
import { RequireMerchant } from '@/components/require-merchant';

// Where a claim waits for its evidence. Razorpay sends the merchant back here after the ₹1 payment.

export default function ClaimStatus({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = use(params);
  return (
    <div>
      <PageTitle eyebrow="Claim" title="Verify your listing" />
      <RequireMerchant>
        <Status claimId={claimId} />
      </RequireMerchant>
    </div>
  );
}

function Status({ claimId }: { claimId: string }) {
  const { client } = useSession();
  const [started, setStarted] = useState<(ClaimStarted & { merchant: string; merchantId?: string }) | null>(null);
  const [status, setStatus] = useState<string>('pending');
  const [attested, setAttested] = useState(false);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(`claim.${claimId}`);
      if (saved) setStarted(JSON.parse(saved));
    } catch {
      // the instructions are also on the payment link; checking still works
    }
  }, [claimId]);

  const check = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await client.merchants.checkClaim(claimId);
      setStatus(r.status);
      if (r.status === 'verified') {
        const mine = await client.merchants.mine();
        const id = started?.merchantId ?? (mine.length === 1 ? mine[0]!.merchant_id : null);
        setMerchantId(id && mine.some((a) => a.merchant_id === id) ? id : null);
        setAttested(!!mine.find((a) => a.merchant_id === id)?.eas_uid);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [client, claimId, started]);

  useEffect(() => {
    void check();
  }, [check]);

  if (status === 'verified') {
    return (
      <Card className="space-y-3">
        <p className="text-lg font-semibold">Verified. The listing is yours.</p>
        <p className="text-sm text-muted">
          {attested
            ? 'The claim is recorded as an attestation on Base, so anyone can see who speaks for this business.'
            : 'The claim is recorded on Receipts. It is not on Base: this server is not anchoring right now.'}
        </p>
        <LinkButton href={merchantId ? `/m/${merchantId}` : '/'}>Open the dashboard</LinkButton>
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      {started ? (
        <>
          <p className="font-semibold">{started.merchant}</p>
          <p className="text-sm">{started.instructions}</p>
          {started.payUrl ? (
            <a href={started.payUrl} className="inline-flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-brand-ink shadow-card transition-transform active:scale-[0.97]" target="_blank" rel="noreferrer">
              Pay ₹1
            </a>
          ) : null}
          <div className="text-sm">
            Reference: <Mono>{started.challenge}</Mono>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">Finish the step you started, then check here.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button tone="secondary" busy={busy} onClick={() => void check()}>
          Check now
        </Button>
        <span className="text-sm text-muted">Status: {status}</span>
      </div>
      {started?.method === 'partner_portal' || started?.method === 'gst' ? (
        <p className="text-xs text-muted">If this cannot be checked automatically, a person at Receipts approves it.</p>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Card>
  );
}
