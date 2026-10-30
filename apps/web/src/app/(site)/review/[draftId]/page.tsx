'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, Keyboard, Mic, PenLine, ReceiptText, X } from 'lucide-react';
import { RAIL_TIER } from '@receipts/core';
import { inr, type PublishResult, type ReviewCard } from '@receipts/client';
import { Recorder } from '@/components/recorder';
import { StarPicker } from '@/components/star-picker';
import { Steps } from '@/components/steps';
import { RequireHuman } from '@/components/require-human';
import { AspectTag, Button, Card, EASE_OUT, errorText, ExternalLink, Field, inputCls, LinkButton, Mono, Notice, PageTitle, Signature, SimulatedTag, Skeleton, Tag, useSession } from '@receipts/react';

const LANGUAGES: [string, string][] = [
  ['', 'Detect language'],
  ['en-IN', 'English'],
  ['hi-IN', 'हिन्दी'],
  ['kn-IN', 'ಕನ್ನಡ'],
  ['mr-IN', 'मराठी'],
  ['ta-IN', 'தமிழ்'],
  ['te-IN', 'తెలుగు'],
  ['bn-IN', 'বাংলা'],
  ['ml-IN', 'മലയാളം'],
  ['gu-IN', 'ગુજરાતી'],
  ['pa-IN', 'ਪੰਜਾਬੀ'],
  ['od-IN', 'ଓଡ଼ିଆ'],
];

export default function DraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = use(params);
  return (
    <RequireHuman>
      <Draft draftId={draftId} />
    </RequireHuman>
  );
}

function Draft({ draftId }: { draftId: string }) {
  const { client, config, wallet } = useSession();
  const [card, setCard] = useState<ReviewCard | null>(null);
  const [mode, setMode] = useState<'voice' | 'text'>('voice');
  const [lang, setLang] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'listen' | 'publish' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [claims, setClaims] = useState<string[]>([]);
  const [published, setPublished] = useState<(PublishResult & { contentCid: string }) | null>(null);

  const apply = (c: ReviewCard) => {
    setCard(c);
    setRating(c.rating);
    setItemId(c.item?.itemId ?? c.itemChoices[0]?.itemId ?? null);
    setClaims(c.claims);
  };

  useEffect(() => {
    client.reviews
      .get(draftId)
      .then(apply)
      .catch((e) => setError(errorText(e)));
  }, [client, draftId]);

  useEffect(() => {
    if (config && !config.voice.sarvam) setMode('text');
  }, [config]);

  const listen = async (fn: () => Promise<ReviewCard>) => {
    setBusy('listen');
    setError(null);
    try {
      apply(await fn());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    if (!wallet || !rating) return;
    setBusy('publish');
    setError(null);
    try {
      setPublished(await client.reviews.signAndPublish(draftId, wallet.signer, { rating, itemId: (itemId ?? undefined) as `0x${string}` | undefined, claims }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (published) return <Published result={published} immediate={!!config?.demoMode} />;
  if (!card)
    return error ? (
      <Notice tone="bad">{error}</Notice>
    ) : (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64" />
      </div>
    );

  const p = card.purchase;
  const heard = card.transcript !== null;

  return (
    <div className="space-y-6">
      <Steps steps={['Proven', 'Say it', 'Your card', 'Published']} current={heard ? 2 : 1} />
      <PageTitle eyebrow="Review a proven purchase" title={p.merchant} sub={`${p.items.map((i) => i.name).join(', ')} · ${inr(p.amountMinor)} · ${p.purchasedOn}`} />
      <div className="-mt-5 flex flex-wrap gap-1.5">
        <Tag tone="good">proven: {config?.rails[p.rail]?.label ?? p.rail}</Tag>
        <Tag>{RAIL_TIER[p.rail] === 'A' ? 'item-level proof' : 'payment-level proof'}</Tag>
        <SimulatedTag show={p.simulated} />
      </div>

      <Card className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="font-display text-xl font-bold">{card.prompt.en}</p>
            <p className="text-sm text-muted">{card.prompt.hi}</p>
          </div>
          <div className="flex rounded-xl bg-sunken p-1 text-sm" role="tablist" aria-label="How to review">
            {(['voice', 'text'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`relative inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3.5 font-semibold transition-colors ${mode === m ? 'text-ink' : 'text-muted hover:text-ink'}`}
              >
                {mode === m ? <motion.span layoutId="mode-pill" className="absolute inset-0 rounded-lg bg-surface shadow-card" transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }} /> : null}
                <span className="relative inline-flex items-center gap-1.5">
                  {m === 'voice' ? <Mic className="size-4" aria-hidden /> : <Keyboard className="size-4" aria-hidden />}
                  {m === 'voice' ? 'Talk' : 'Type'}
                </span>
              </button>
            ))}
          </div>
        </div>
        {mode === 'voice' ? (
          <div className="space-y-3">
            {config && !config.voice.sarvam ? <Notice tone="warn">Speech-to-text is not configured on this server. Type instead.</Notice> : null}
            <Recorder busy={busy === 'listen'} onRecorded={(blob) => void listen(() => client.reviews.voice(draftId, blob, { lang: lang || undefined }))} />
            <div className="flex justify-center">
              <select className="min-h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
                {LANGUAGES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void listen(() => client.reviews.text(draftId, text));
            }}
          >
            <textarea className={`${inputCls} min-h-28`} value={text} onChange={(e) => setText(e.target.value)} placeholder="The biryani was not oily, fed two of us, arrived hot. 4 stars." />
            <Button type="submit" busy={busy === 'listen'} disabled={text.trim().length < 8}>
              <PenLine className="size-4" aria-hidden />
              Make my card
            </Button>
            <p className="text-xs text-muted">Rather talk? Dictate into this box with your keyboard’s mic or a voice keyboard like Wispr Flow.</p>
          </form>
        )}
      </Card>

      <AnimatePresence>
      {heard ? (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE_OUT }}>
        <Card className="space-y-5 border-accent">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-display text-xl font-bold">
              <ReceiptText className="size-5" aria-hidden />
              Your review card
            </span>
            <Tag>{card.generatedBy === 'llm' ? 'structured by a model' : 'structured by rules'}</Tag>
          </div>
          {card.transcript ? <p className="rounded-2xl bg-sunken p-4 text-sm leading-relaxed italic">“{card.transcript}”</p> : null}
          <div className="space-y-1.5">
            <span className="text-sm font-semibold">Stars</span>
            <StarPicker value={rating} onChange={setRating} />
          </div>
          {card.itemChoices.length > 1 ? (
            <Field label="Which item?">
              <select className={inputCls} value={itemId ?? ''} onChange={(e) => setItemId(e.target.value)}>
                {card.itemChoices.map((i) => (
                  <option key={i.itemId} value={i.itemId}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {Object.keys(card.aspects).length ? (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(card.aspects).map(([k, v]) => (
                <AspectTag key={k} name={k} value={v} />
              ))}
            </div>
          ) : null}
          <div className="space-y-1.5" role="group" aria-labelledby="claims-label">
            <span id="claims-label" className="text-sm font-semibold">Claims agents will quote</span>
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {claims.map((c) => (
                  <motion.li
                    key={c}
                    layout
                    exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface py-1 pr-1 pl-3.5 text-sm"
                  >
                    <span className="flex-1 font-display text-base">“{c}”</span>
                    <button
                      type="button"
                      onClick={() => setClaims(claims.filter((x) => x !== c))}
                      className="grid size-10 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-bad-soft hover:text-bad"
                      aria-label={`Remove ${c}`}
                    >
                      <X className="size-4" />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
              {claims.length === 0 ? <li className="text-sm text-muted">No claims: the review will carry only the stars.</li> : null}
            </ul>
            <span className="block text-xs text-muted">Remove anything you did not mean. Each claim links back to this receipt.</span>
          </div>
          {card.warnings.map((w) => (
            <Notice key={w} tone="warn">
              {w}
            </Notice>
          ))}
          <div className="space-y-2 border-t border-dashed border-line pt-5">
            <Button tone="brand" size="lg" busy={busy === 'publish'} disabled={!rating} onClick={() => void publish()} className="w-full sm:w-auto">
              Sign and publish
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <p className="text-xs text-muted">
              Your wallet signs the review{config?.chain.anchored ? ' and it is anchored on Base; Receipts pays the gas' : ''}. Only the text is published, never your voice.
            </p>
          </div>
        </Card>
        </motion.div>
      ) : null}
      </AnimatePresence>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </div>
  );
}

function Published({ result, immediate }: { result: PublishResult & { contentCid: string }; immediate: boolean }) {
  const path = `/r/${result.uid ?? result.reviewId}`;
  return (
    <div className="space-y-6">
      <Steps steps={['Proven', 'Say it', 'Your card', 'Published']} current={4} />
      <Card className="space-y-5 text-center">
        <motion.span
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', bounce: 0.5, duration: 0.6 }}
          className="mx-auto grid size-20 place-items-center rounded-full bg-brand text-brand-ink"
        >
          <Check className="size-10" strokeWidth={3} aria-hidden />
        </motion.span>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Published.</h1>
          <p className="mx-auto max-w-md text-muted">
            {result.status === 'held'
              ? 'A moderator reads reviews that allege fake products before they go public.'
              : immediate
                ? 'It is live.'
                : 'It appears publicly within a day, after a random delay, so the timing cannot point to you.'}{' '}
            When an AI agent cites it, you earn.
          </p>
        </div>
        <div className="flex flex-col items-center">
          <Signature className="h-14 w-auto text-ink" />
          <span className="mt-1 text-xs text-muted">Signed by your wallet</span>
        </div>
        <div className="mx-auto max-w-lg space-y-2 rounded-2xl bg-sunken p-4 text-left text-sm">
          {result.anchored ? (
            <>
              <div>
                <span className="text-muted">Attestation </span>
                <Mono>{result.uid}</Mono>
              </div>
              {result.explorerTx ? (
                <div>
                  <ExternalLink href={result.explorerTx}>View the transaction</ExternalLink>
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-muted">
              {result.anchorPending
                ? 'Signed by your wallet and published. Anchoring on Base is queued: Base or the gas wallet did not answer just now, and it retries every two minutes.'
                : 'Signed by your wallet; this server is not anchoring on-chain.'}
            </div>
          )}
          <div>
            <span className="text-muted">Content </span>
            <Mono>{result.contentCid}</Mono>
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <LinkButton href={path}>
            <ReceiptText className="size-4" aria-hidden />
            Open the receipt
          </LinkButton>
          <LinkButton href="/review" tone="secondary">
            Review something else
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}
