'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Anchor, ArrowRight, Flag, PauseCircle, Store } from 'lucide-react';
import type { AdminOverview } from '@receipts/client';
import { Button, Card, errorText, Notice, PageTitle, Skeleton, Tag } from '@receipts/react';
import { useAdmin } from '@/lib/admin';

const JOBS: { label: string; run: (a: ReturnType<typeof useAdmin>['client']['admin']) => Promise<unknown> }[] = [
  { label: 'Anchor waiting reviews now', run: (a) => a.anchorNow() },
  { label: 'Rerun the trust engine', run: (a) => a.trust() },
  { label: 'Sync the trust graph', run: (a) => a.graphSync() },
  { label: 'Build the payout epoch', run: (a) => a.epoch() },
];

export default function Overview() {
  const { client } = useAdmin();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(() => {
    client.admin.overview().then(setData).catch((e) => setError(errorText(e)));
  }, [client]);
  useEffect(load, [load]);

  const run = async (job: (typeof JOBS)[number]) => {
    setBusy(job.label);
    setResult(null);
    try {
      setResult(`${job.label}: ${JSON.stringify(await job.run(client.admin)).slice(0, 300)}`);
      load();
    } catch (e) {
      setResult(`${job.label}: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      <PageTitle eyebrow="Operators" title="What needs a person" sub="Claims, held reviews and trust flags wait here. Nothing in this console can edit, re-rank or hide a review." />
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {!data ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Queue href="/claims" n={data.queues.claims} label="business claims to decide" icon={<Store />} block="bg-block-sky" />
            <Queue href="/moderation" n={data.queues.held} label="reviews held for a person" icon={<PauseCircle />} block="bg-block-sun" />
            <Queue href="/moderation" n={data.queues.flags} label="open trust flags" icon={<Flag />} block="bg-block-pink" />
            <Queue href="/" n={data.queues.anchors} label="reviews waiting to anchor on Base" icon={<Anchor />} block="bg-block-violet" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="space-y-3">
              <h2 className="font-display text-lg font-bold">This server</h2>
              <div className="flex flex-wrap gap-1.5">
                <Tag tone={data.chain.anchoring ? 'good' : 'warn'}>{data.chain.anchoring ? `anchoring on ${data.chain.mode}` : `not anchoring (${data.chain.mode})`}</Tag>
                <Tag tone={data.keys.reclaim ? 'good' : 'warn'}>Reclaim {data.keys.reclaim ? 'on' : 'off'}</Tag>
                <Tag tone={data.keys.google ? 'good' : 'warn'}>Google Maps {data.keys.google ? 'on' : 'off'}</Tag>
                <Tag>model: {data.keys.llm}</Tag>
                <Tag tone={data.keys.adminToken ? 'good' : 'warn'}>{data.keys.adminToken ? 'admin token set' : 'no admin token'}</Tag>
              </div>
              <p className="text-sm text-muted">
                {data.totals.reviews} verified reviews · {data.totals.businesses} claimed businesses · {data.totals.providers} Reclaim providers
              </p>
            </Card>
            <Card className="space-y-3">
              <h2 className="font-display text-lg font-bold">Run a job now</h2>
              <p className="text-sm text-muted">They also run on their own schedule; this is for when you cannot wait.</p>
              <div className="flex flex-wrap gap-2">
                {JOBS.map((j) => (
                  <Button key={j.label} tone="secondary" busy={busy === j.label} disabled={!!busy} onClick={() => void run(j)}>
                    {j.label}
                  </Button>
                ))}
              </div>
              {result ? <p className="font-mono text-xs break-all text-muted">{result}</p> : null}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Queue({ href, n, label, icon, block }: { href: string; n: number; label: string; icon: ReactNode; block: string }) {
  return (
    <Link href={href} className={`group flex flex-col gap-3 rounded-[28px] p-5 text-block-ink shadow-clay-block transition-transform duration-200 ease-squish hover:-translate-y-0.5 ${block}`}>
      <span className="grid size-11 place-items-center rounded-full bg-block-bubble shadow-clay-sm [&_svg]:size-5" aria-hidden>
        {icon}
      </span>
      <span className="font-display text-4xl font-extrabold tabular-nums">{n}</span>
      <span className="flex items-center justify-between gap-2 text-sm text-block-ink/85">
        {label}
        <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
