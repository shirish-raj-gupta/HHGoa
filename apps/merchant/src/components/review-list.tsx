'use client';

import { useState } from 'react';
import type { Insights } from '@receipts/client';
import { Button, Card, errorText, ExternalLink, inputCls, Notice, SimulatedTag, Stars, Tag, useSession } from '@receipts/react';
import { WEB_URL } from '@/lib/env';

type Review = Insights['reviews'][number];

/** Reviews with a public reply box. There is no edit, hide or delete: a merchant can answer, or report unlawful content. */
export function ReviewList({ merchantId, reviews, rails }: { merchantId: string; reviews: Review[]; rails: Record<string, { label: string }> | undefined }) {
  if (reviews.length === 0) return <Card className="text-sm text-muted">No published reviews yet. Signed receipts are the fastest way to get your first ones.</Card>;
  return (
    <div className="space-y-3">
      {reviews.map((r) => (
        <ReviewRow key={r.id} merchantId={merchantId} review={r} railLabel={rails?.[r.rail]?.label ?? r.rail} />
      ))}
    </div>
  );
}

function ReviewRow({ merchantId, review, railLabel }: { merchantId: string; review: Review; railLabel: string }) {
  const { client, wallet } = useSession();
  const [text, setText] = useState('');
  const [reply, setReply] = useState<string | null>(review.reply);
  const [link, setLink] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const send = async () => {
    if (!wallet) return;
    setBusy('reply');
    setMsg(null);
    try {
      const r = await client.merchants.signAndReply(merchantId, review.id, text.trim(), wallet.signer);
      setReply(text.trim());
      setLink(r.easUrl);
      setOpen(false);
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const report = async (reason: 'unlawful' | 'personal_data') => {
    setBusy(reason);
    setMsg(null);
    try {
      const r = await client.merchants.flag(review.id, reason);
      setMsg({ tone: 'good', text: r.note });
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Stars value={review.rating} size="text-sm" />
        <span className="font-semibold">{review.item}</span>
        <Tag>{railLabel}</Tag>
        <SimulatedTag show={review.simulated} />
        <a href={`${WEB_URL}/r/${review.eas_uid ?? review.id}`} target="_blank" rel="noreferrer" className="link ml-auto text-xs font-medium">
          receipt ↗
        </a>
      </div>
      {review.claims.length ? (
        <ul className="space-y-0.5 text-sm">
          {review.claims.map((c) => (
            <li key={c}>“{c}”</li>
          ))}
        </ul>
      ) : null}
      {review.summary_en ? <p className="text-sm text-muted">{review.summary_en}</p> : null}
      {reply ? (
        <div className="rounded-xl bg-sunken p-3 text-sm">
          <div className="text-xs font-semibold text-muted">Your public reply</div>
          <p>{reply}</p>
          {link ? <ExternalLink href={link}>attestation</ExternalLink> : null}
        </div>
      ) : open ? (
        <div className="space-y-2">
          <textarea className={`${inputCls} min-h-20`} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Thank them, or say what you changed. Replies are public and signed by your wallet." />
          <div className="flex gap-2">
            <Button busy={busy === 'reply'} disabled={text.trim().length < 2} onClick={() => void send()}>
              Sign and post reply
            </Button>
            <Button tone="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button tone="secondary" onClick={() => setOpen(true)}>
            Reply in public
          </Button>
          <details className="text-xs">
            <summary className="cursor-pointer py-3 text-muted">Report</summary>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button tone="ghost" busy={busy === 'unlawful'} onClick={() => void report('unlawful')}>
                Unlawful content
              </Button>
              <Button tone="ghost" busy={busy === 'personal_data'} onClick={() => void report('personal_data')}>
                Contains personal data
              </Button>
            </div>
          </details>
        </div>
      )}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Card>
  );
}
