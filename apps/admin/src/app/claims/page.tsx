'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { shortAddr, type AdminClaim } from '@receipts/client';
import { Button, Card, EmptyState, errorText, ExternalLink, inputCls, Mono, Notice, PageTitle, Skeleton, Tag } from '@receipts/react';
import { useAdmin } from '@/lib/admin';

const STATUSES = [
  ['open', 'Waiting'],
  ['verified', 'Approved'],
  ['failed', 'Rejected'],
] as const;

const METHOD: Record<string, string> = { upi: '₹1 UPI payment', domain: 'DNS record', gst: 'GSTIN', partner_portal: 'Partner dashboard' };

export default function Claims() {
  const { client } = useAdmin();
  const [status, setStatus] = useState<(typeof STATUSES)[number][0]>('open');
  const [rows, setRows] = useState<AdminClaim[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Always the tab that is open: an approval that lands after a switch reloads the new tab, and a list that arrives
  // for a tab already left is dropped.
  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    client.admin
      .claims(status)
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [client, status, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  return (
    <div className="space-y-6">
      <PageTitle
        eyebrow="Businesses"
        title="Claims"
        sub="A claim gives a wallet the right to reply in public and sign receipts for a listing. Approve when the evidence holds: a payment from the listing's UPI, a DNS record, a GSTIN that matches, or a partner dashboard you have seen."
      />
      <div role="tablist" aria-label="Claim status" className="flex gap-1 border-b border-line">
        {STATUSES.map(([s, label]) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={`min-h-11 border-b-2 px-3 text-sm transition-colors ${status === s ? 'border-accent font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {rows === null ? <Skeleton className="h-32" /> : null}
      {rows?.length === 0 ? <EmptyState title="Nothing here">No claims with this status.</EmptyState> : null}
      <div className="space-y-3">
        {rows?.map((c) => (
          <ClaimRow key={c.id} c={c} onDone={reload} />
        ))}
      </div>
    </div>
  );
}

function ClaimRow({ c, onDone }: { c: AdminClaim; onDone(): void }) {
  const { client } = useAdmin();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (kind: 'approve' | 'reject') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'approve') await client.admin.approveClaim(c.id);
      else await client.admin.rejectClaim(c.id, note);
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-display text-lg font-bold">{c.merchant}</div>
          <div className="text-sm text-muted">
            {c.address ?? c.city_id ?? 'no address'}
            {c.maps_url ? (
              <>
                {' · '}
                <ExternalLink href={c.maps_url}>Google Maps</ExternalLink>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Tag>{METHOD[c.method] ?? c.method}</Tag>
            <Tag>wallet {shortAddr(c.wallet)}</Tag>
            <Tag>{new Date(c.created_at).toLocaleString('en-IN')}</Tag>
            {c.claimed && c.status === 'open' ? <Tag tone="warn">listing already claimed by someone</Tag> : null}
          </div>
        </div>
        {c.status === 'open' ? (
          <div className="flex gap-2">
            <Button busy={busy === 'approve'} disabled={!!busy || c.claimed} onClick={() => void act('approve')}>
              <Check className="size-4" aria-hidden />
              Approve
            </Button>
            <Button tone="danger" disabled={!!busy} onClick={() => setRejecting((v) => !v)}>
              <X className="size-4" aria-hidden />
              Reject
            </Button>
          </div>
        ) : null}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Evidence and challenge</summary>
        <Mono className="mt-2 block">{JSON.stringify({ challenge: c.challenge, evidence: c.evidence }, null, 1)}</Mono>
      </details>
      {rejecting ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (the business sees this)" aria-label="Reason for rejecting" />
          <Button tone="danger" busy={busy === 'reject'} onClick={() => void act('reject')}>
            Reject claim
          </Button>
        </div>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Card>
  );
}
