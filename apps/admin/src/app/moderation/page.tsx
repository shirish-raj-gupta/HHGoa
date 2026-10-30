'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminHeldReview } from '@receipts/client';
import { Button, Card, EmptyState, errorText, Mono, Notice, PageTitle, SimulatedTag, Skeleton, Stars, Tag } from '@receipts/react';
import { useAdmin } from '@/lib/admin';

// Held reviews (category rules hold fake-product claims and personal allegations for a person) and trust flags
// (review rings and other patterns the trust engine raises). A held review can be released or left held; a flag is
// confirmed or cleared. Nothing here edits, re-ranks or hides a review.

type FlagRow = { id: string; signal: string; status: string; merchant_id: string | null; reviewer_ids: string[]; penalty: number | null; simulated: boolean; created_at: string; case_file: unknown };

export default function Moderation() {
  const { client } = useAdmin();
  const [held, setHeld] = useState<AdminHeldReview[] | null>(null);
  const [flags, setFlags] = useState<FlagRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    client.admin.heldReviews().then(setHeld).catch((e) => setError(errorText(e)));
    client.admin.flags().then((f) => setFlags(f as unknown as FlagRow[])).catch((e) => setError(errorText(e)));
  }, [client]);
  useEffect(load, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const open = flags?.filter((f) => f.status === 'open') ?? null;

  return (
    <div className="space-y-10">
      <PageTitle eyebrow="Operators" title="Moderation" sub="Held reviews wait for a person. Trust flags are patterns the trust engine raised; confirm one only when the case file shows it." />
      {error ? <Notice tone="bad">{error}</Notice> : null}

      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">Held reviews</h2>
        {held === null ? <Skeleton className="h-24" /> : null}
        {held?.length === 0 ? <EmptyState title="Nothing held">No review is waiting for a person.</EmptyState> : null}
        {held?.map((r) => (
          <Card key={r.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Stars value={r.rating} size="text-sm" />
              <span className="font-semibold">{r.item}</span>
              <span className="text-sm text-muted">at {r.merchant}</span>
              <SimulatedTag show={r.simulated} />
              <Button tone="secondary" className="ml-auto" busy={busy === r.id} disabled={!!busy} onClick={() => void act(r.id, () => client.admin.releaseReview(r.id))}>
                Release
              </Button>
            </div>
            <ul className="space-y-1 text-sm">
              {r.claims.map((c) => (
                <li key={c} className="font-serif text-base italic">
                  “{c}”
                </li>
              ))}
            </ul>
            {r.summary_en ? <p className="text-sm text-muted">{r.summary_en}</p> : null}
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">Open trust flags</h2>
        {open === null ? <Skeleton className="h-24" /> : null}
        {open?.length === 0 ? <EmptyState title="No open flags">The trust engine has nothing waiting.</EmptyState> : null}
        {open?.map((f) => (
          <Card key={f.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="warn">{f.signal.replace(/_/g, ' ')}</Tag>
              <Tag>{f.reviewer_ids.length} reviewers</Tag>
              {f.penalty !== null ? <Tag>penalty {Number(f.penalty).toFixed(2)}</Tag> : null}
              <SimulatedTag show={f.simulated} />
              <span className="ml-auto flex flex-wrap gap-2">
                <Button tone="secondary" busy={busy === `i-${f.id}`} disabled={!!busy} onClick={() => void act(`i-${f.id}`, () => client.admin.investigate(f.id))}>
                  Investigate
                </Button>
                <Button tone="danger" busy={busy === `c-${f.id}`} disabled={!!busy} onClick={() => void act(`c-${f.id}`, () => client.admin.decide(f.id, 'confirm', 'admin'))}>
                  Confirm
                </Button>
                <Button tone="ghost" busy={busy === `x-${f.id}`} disabled={!!busy} onClick={() => void act(`x-${f.id}`, () => client.admin.decide(f.id, 'clear', 'admin'))}>
                  Clear
                </Button>
              </span>
            </div>
            {f.case_file ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted">Case file</summary>
                <Mono className="mt-2 block">{JSON.stringify(f.case_file, null, 1).slice(0, 4000)}</Mono>
              </details>
            ) : null}
          </Card>
        ))}
      </section>
    </div>
  );
}
