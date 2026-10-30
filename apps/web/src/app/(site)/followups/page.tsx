'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { FollowupItem } from '@receipts/client';
import { RequireHuman } from '@/components/require-human';
import { Button, Card, errorText, ExternalLink, Notice, PageTitle, Tag, useSession } from '@receipts/react';
import { followupLabel } from '@/lib/format';

export default function FollowupsPage() {
  return (
    <div>
      <PageTitle eyebrow="Still good?" title="Check-ins" sub="One tap: is it still good? Later answers are what make a review trustworthy, and they are signed by you like the review." />
      <RequireHuman what="answer check-ins">
        <Inbox />
      </RequireHuman>
    </div>
  );
}

function Inbox() {
  const { client } = useSession();
  const [items, setItems] = useState<FollowupItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setItems(await client.followups.inbox()), [client]);
  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
  }, [load]);

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!items)
    return (
      <div className="space-y-3" aria-busy>
        <div className="skeleton h-28" />
        <div className="skeleton h-28" />
      </div>
    );
  if (items.length === 0) return <Card className="text-sm text-muted">Nothing to answer right now. Check-ins arrive a day, a week or a month after a review, depending on what you bought.</Card>;
  return (
    <div className="space-y-3">
      {items.map((f) => (
        <FollowupCard key={f.id} item={f} />
      ))}
    </div>
  );
}

function FollowupCard({ item }: { item: FollowupItem }) {
  const { client, wallet } = useSession();
  const [stillGood, setStillGood] = useState<boolean | null>(null);
  const [newRating, setNewRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ explorerTx: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (stillGood === null || !wallet) return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.followups.signAndAnswer(item.id, wallet.signer, { stillGood, newRating: newRating ?? undefined });
      setDone({ explorerTx: r.explorerTx });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tag>{followupLabel(item.kind)}</Tag>
        <Link href={`/r/${item.eas_uid ?? item.review_id}`} className="font-semibold hover:underline">
          {item.item}
        </Link>
        <span className="text-sm text-muted">· {item.merchant} · you gave {item.rating}★</span>
      </div>
      {done ? (
        <Notice tone="good">
          Thanks, answered. {done.explorerTx ? <ExternalLink href={done.explorerTx}>On-chain</ExternalLink> : null}
        </Notice>
      ) : (
        <>
          <div className="flex gap-2">
            <Button tone={stillGood === true ? 'primary' : 'secondary'} onClick={() => setStillGood(true)}>
              Still good
            </Button>
            <Button tone={stillGood === false ? 'danger' : 'secondary'} onClick={() => setStillGood(false)}>
              Not anymore
            </Button>
          </div>
          {stillGood !== null ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Change your stars? (optional)</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setNewRating(newRating === n ? null : n)} className={`text-2xl ${newRating !== null && n <= newRating ? 'text-accent' : 'text-line'}`} aria-label={`${n} stars`}>
                  ★
                </button>
              ))}
            </div>
          ) : null}
          <Button busy={busy} disabled={stillGood === null} onClick={() => void submit()}>
            Sign and send
          </Button>
        </>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Card>
  );
}
