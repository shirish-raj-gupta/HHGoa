'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Bot, Coins, Mic, ReceiptText, Search, X } from 'lucide-react';
import { PRICES_USDC } from '@receipts/core';
import type { Answer, Brand, Stats } from '@receipts/client';
import { AnswerView } from '@/components/answer';
import { HeroReceipt } from '@/components/hero-receipt';
import { Splash, VisitorBar } from '@/components/splash';
import { liftSplashCover, readVisitor, splashDue, type Visitor } from '@/lib/visitor';
import {
  Button,
  EASE_OUT,
  Eyebrow,
  errorText,
  Highlight,
  LinkButton,
  Marquee,
  Notice,
  Orbs,
  Reveal,
  RollingNumber,
  ShaderBackdrop,
  Skeleton,
  SpotlightCard,
  StackCards,
  TextRotate,
  useSession,
  type OrbSpec,
} from '@receipts/react';

const SUGGESTIONS = ['Best veg biryani under ₹400 near Calangute', 'Quietest hotel near Calangute for remote work', 'Best power bank under ₹1,500', 'Which grocery app delivers fresh vegetables in Panaji?'];
const THINGS = ['veg biryani', 'beach stays', 'power banks', 'fresh groceries'];
const BEFORE = ['Anyone can post, bought or not', 'Paid and planted reviews look the same as real ones', 'AI agents repeat whatever ranks'];
const AFTER = ['Only proven purchases can be reviewed', 'One verified human, one review per purchase', 'Every claim links to the receipt behind it'];
const RAIL_FALLBACK = ['Order page', 'Order email', 'Payment proof', 'QR on the bill', 'Shop-through link', 'On-chain payment', 'ONDC order'];

// Clay orbs behind the hero, placed against the centred 64rem column so they sit in the margins and behind the
// receipt, never behind text (cream text on a lime orb would fail contrast in the dark theme). Phones get two of
// their own at the corners.
const COL = 'calc(50% - 32rem)';
const COL_END = 'calc(50% + 32rem)';
const HERO_ORBS: OrbSpec[] = [
  { color: 'lime', size: 210, x: `calc(${COL} - 250px)`, y: '14%', depth: 1.4 },
  { color: 'sun', size: 54, x: `calc(${COL} - 110px)`, y: '72%', depth: 2.2 },
  { color: 'violet', size: 128, x: `calc(${COL_END} + 40px)`, y: '8%', depth: 0.7 },
  { color: 'pink', size: 92, x: 'calc(50% + 21rem)', y: '12%', depth: 1.8 },
  { color: 'sky', size: 160, x: 'calc(50% + 23rem)', y: '56%', depth: 1.1 },
  { color: 'tangerine', size: 66, x: 'calc(50% + 5rem)', y: '84%', depth: 2.4 },
  { color: 'lime', size: 120, x: 'calc(100% - 64px)', y: '2%', depth: 0.9, className: 'sm:hidden' },
  { color: 'violet', size: 84, x: 'calc(100% - 46px)', y: '80%', depth: 1.6, className: 'sm:hidden' },
];

const CTA_ORBS: OrbSpec[] = [
  { color: 'violet', size: 180, x: 'calc(100% - 130px)', y: 'calc(100% - 64px)', depth: 0.3 },
  { color: 'pink', size: 70, x: '58%', y: '-26px', depth: 0.3 },
];

export default function Home() {
  const { client, config, configError, wallet } = useSession();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const results = useRef<HTMLDivElement>(null);
  // The splash: on a first visit, then whenever someone asks to choose again. 'unread' until this browser's choice is read.
  const [visitor, setVisitor] = useState<Visitor | 'unread' | null>('unread');
  const [splash, setSplash] = useState<'first' | 'again' | null>(null);

  useEffect(() => {
    setVisitor(readVisitor());
    if (splashDue()) setSplash('first');
    else liftSplashCover();
  }, []);

  useEffect(() => {
    client.stats().then(setStats).catch(() => undefined);
    client
      .brands()
      .then((b) => setBrands(b.filter((x) => x.id !== 'demo')))
      .catch(() => undefined);
  }, [client]);

  async function ask(question: string) {
    if (!question.trim()) return;
    setQ(question);
    setBusy(true);
    setError(null);
    setAnswer(null);
    requestAnimationFrame(() => results.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    try {
      setAnswer(await client.ask(question));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(q);
  };

  const rails = config ? Object.values(config.rails).map((r) => r.label) : RAIL_FALLBACK;

  return (
    <div className="space-y-20 sm:space-y-28">
      <Splash
        open={splash !== null}
        intro={splash === 'first'}
        onDone={(v) => {
          setSplash(null);
          if (v) setVisitor(v);
        }}
      />
      <section className="relative isolate">
        {/* The moving gradient, the dot grid and the orbs run the full width of the window, under the glass header. */}
        <div aria-hidden className="absolute -top-32 -bottom-16 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden">
          <ShaderBackdrop className="h-full w-full" />
          <div className="bg-dots absolute inset-0 opacity-70" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-bg" />
          <Orbs orbs={HERO_ORBS} />
          <div className="grain absolute inset-0" />
        </div>

        <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10">
          <div className="space-y-6">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tracking-[0.18em] text-muted uppercase">
              <span>
                <b className="font-semibold text-good">{rails.length}</b> proof rails
              </span>
              <span aria-hidden>·</span>
              <span>
                <b className="font-semibold text-good">1</b> human, 1 review
              </span>
              <span aria-hidden>·</span>
              <span>
                <b className="font-semibold text-good">70%</b> to reviewers
              </span>
            </p>
            <h1 className="text-5xl leading-[0.95] font-extrabold tracking-[-0.04em] sm:text-6xl lg:text-7xl">
              No receipt,
              <br />
              <span className="relative isolate inline-block font-serif font-normal tracking-[-0.01em] italic">
                no review.
                <motion.span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-[0.08em] h-[0.12em] origin-left rounded-full bg-brand"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.35, duration: 0.6, ease: EASE_OUT }}
                />
              </span>
            </h1>
            <p className="max-w-xl font-display text-xl leading-snug sm:text-2xl">
              Honest reviews of <TextRotate words={THINGS} className="font-semibold" />, from people who can prove they bought it.
            </p>
            <p className="max-w-xl text-lg leading-relaxed text-muted">
              Every review comes from a <Highlight>proven purchase</Highlight> by a <Highlight delay={0.45}>verified unique human</Highlight>, and anyone can re-check
              it. AI agents pay a fraction of a cent to cite them; the reviewers get paid.
            </p>

            <form onSubmit={onSubmit} className="max-w-xl" role="search">
              <div className="glass flex items-center gap-2 rounded-[26px] p-2 transition-[box-shadow] focus-within:ring-4 focus-within:ring-brand/40">
                <Search className="ml-2 size-5 shrink-0 text-muted" aria-hidden />
                <input
                  className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-muted"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="What should I buy, or where should I go?"
                  aria-label="Your question"
                />
                {q ? (
                  <button type="button" onClick={() => setQ('')} className="grid size-11 shrink-0 place-items-center rounded-2xl text-muted hover:bg-sunken hover:text-ink" aria-label="Clear">
                    <X className="size-4" />
                  </button>
                ) : null}
                <Button type="submit" tone="brand" busy={busy} className="shrink-0">
                  Ask
                </Button>
              </div>
            </form>
            <div className="flex max-w-xl flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="min-h-11 rounded-full bg-surface/80 px-4 text-xs font-medium text-muted shadow-clay-sm ring-1 ring-line/70 ring-inset transition-[color,transform] duration-200 ease-squish hover:-translate-y-px hover:text-ink active:scale-[0.96]"
                >
                  {s}
                </button>
              ))}
            </div>
            {visitor !== 'unread' ? <VisitorBar visitor={visitor} onChange={() => setSplash('again')} /> : null}
          </div>
          <div className="pb-6 lg:pb-0">
            <HeroReceipt />
          </div>
        </div>
      </section>

      {brands.length ? (
        <section className="-mt-6 space-y-4 sm:-mt-12" aria-label="Where purchases can be proven">
          <p className="text-center font-mono text-[11px] tracking-[0.18em] text-muted uppercase">Purchases proven from</p>
          <div className="glass rounded-full py-4">
            <Marquee duration={45}>
              {brands.map((b) => (
                <span key={b.id} className="font-display text-xl font-bold whitespace-nowrap text-ink/75 sm:text-2xl">
                  {b.name}
                </span>
              ))}
            </Marquee>
          </div>
        </section>
      ) : null}

      {configError || error || busy || answer ? (
        <div ref={results} className="scroll-mt-24 space-y-4">
          {configError ? <Notice tone="bad">Cannot reach the Receipts API ({configError}). Start it with `pnpm dev:api`.</Notice> : null}
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <AnimatePresence mode="wait">
            {busy ? (
              <motion.div key="loading" exit={{ opacity: 0 }} className="space-y-3" aria-live="polite">
                <p className="text-sm text-muted">Reading the receipts…</p>
                <Skeleton className="h-36" />
                <Skeleton className="h-36" />
              </motion.div>
            ) : answer ? (
              <motion.section key={answer.answer_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} aria-live="polite" className="space-y-4">
                <Eyebrow>Answer from receipts</Eyebrow>
                <h2 className="text-2xl font-bold">{answer.query}</h2>
                <AnswerView answer={answer} wallet={wallet?.address} />
              </motion.section>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}

      <section className="space-y-10">
        <Reveal className="max-w-2xl space-y-3">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="text-3xl font-bold sm:text-5xl">
            Three steps, <span className="font-serif font-normal italic">under a minute.</span>
          </h2>
        </Reveal>
        <StackCards top={92}>
          {[
            <Step key="prove" n="01" Icon={ReceiptText} title="Prove it" className="bg-block-sky">
              <p>Connect the order page, the order email, a signed receipt from the counter or a payment. Seven ways in, one kind of proof.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {rails.map((r) => (
                  <span key={r} className="rounded-full bg-block-bubble px-3 py-1.5 text-xs font-semibold shadow-clay-sm">
                    {r}
                  </span>
                ))}
              </div>
            </Step>,
            <Step key="say" n="02" Icon={Mic} title="Say it" className="bg-block-pink">
              <p>Fifteen seconds in any Indian language. We turn it into a short card you check and sign.</p>
              <div className="mt-6 flex h-14 items-center gap-1.5" aria-hidden>
                {[0.1, 0.35, 0.2, 0.5, 0.15, 0.4, 0.25, 0.55, 0.3, 0.45, 0.12, 0.38, 0.22, 0.5].map((d, i) => (
                  <span key={i} className="block h-full w-2 origin-center animate-bars rounded-full bg-block-ink" style={{ animationDelay: `${d}s` }} />
                ))}
                <span className="ml-3 font-mono text-sm">0:15</span>
              </div>
            </Step>,
            <Step key="paid" n="03" Icon={Coins} title="Get paid" className="bg-block-lime">
              <p>Of what agents pay for an answer, this much goes to the reviews it cites. Pay never depends on your rating.</p>
              <div className="mt-4 font-display text-7xl font-extrabold tracking-tight sm:text-8xl">
                <RollingNumber value={70} />%
              </div>
            </Step>,
          ]}
        </StackCards>
      </section>

      <Reveal>
        <SpotlightCard tilt className="grid gap-8 rounded-[36px] bg-block-violet p-7 text-block-ink shadow-clay-block sm:p-10 md:grid-cols-[1fr_1.15fr]">
          <div className="flex flex-col items-start gap-4">
            <span className="grid size-14 place-items-center rounded-full bg-block-bubble shadow-clay-sm">
              <Bot className="size-6" aria-hidden />
            </span>
            <h2 className="text-3xl font-extrabold sm:text-5xl">
              Built for <span className="font-serif font-normal italic">AI agents.</span>
            </h2>
            <p className="max-w-md leading-relaxed text-block-ink/85">Agents ask over MCP or HTTPS and pay per answer in USDC on Base. Every claim they quote links back to its receipt.</p>
            <LinkButton href="/developers" className="mt-2 bg-block-ink! text-curtain-ink!">
              For developers
              <ArrowRight className="size-4" aria-hidden />
            </LinkButton>
          </div>
          <pre className="self-center rounded-[28px] bg-block-ink p-5 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-curtain-ink shadow-clay-pressed sm:p-6">
            <span className="opacity-70">&gt; </span>search_receipts(&quot;best veg biryani under ₹400&quot;)
            {'\n'}
            <span className="opacity-70">  402 Payment Required · </span>${PRICES_USDC.search_receipts} USDC · x402 on Base
            {'\n'}
            <span className="text-block-lime">  ✓ paid</span> · ranked options, each claim linked to its receipts
          </pre>
        </SpotlightCard>
      </Reveal>

      <section className="grid gap-4 md:grid-cols-2">
        <Reveal className="h-full rounded-[36px] bg-sunken p-8 ring-1 ring-line ring-inset">
          <Eyebrow>The open web</Eyebrow>
          <h3 className="mt-3 text-3xl font-bold text-muted">
            Reviews anyone can <span className="font-serif font-normal italic">write.</span>
          </h3>
          <ul className="mt-5 space-y-3">
            {BEFORE.map((b) => (
              <li key={b} className="flex gap-3 text-muted">
                <X className="mt-0.5 size-5 shrink-0 text-bad" aria-hidden />
                {b}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.08} className="beam h-full rounded-[36px] bg-accent p-8 text-accent-ink shadow-clay-block">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.18em] uppercase opacity-80">
            <span className="size-1.5 rounded-full bg-accent-mark" aria-hidden />
            Receipts
          </span>
          <h3 className="mt-3 text-3xl font-bold">
            Reviews you can <span className="font-serif font-normal italic">check.</span>
          </h3>
          <ul className="mt-5 space-y-3">
            {AFTER.map((a) => (
              <li key={a} className="flex gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-mark text-accent">
                  <ArrowRight className="size-3" strokeWidth={3} aria-hidden />
                </span>
                {a}
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      {stats && stats.receipts > 0 ? (
        <section className="space-y-4">
          <Reveal className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Verified reviews', value: stats.receipts, bg: 'bg-block-lime' },
              { label: 'Unique humans', value: stats.humans, bg: 'bg-block-sky' },
              { label: 'Paid agent queries', value: stats.paidQueries, bg: 'bg-block-sun' },
              { label: 'Earned by reviewers', value: Number(stats.earnedByReviewersUsdc), money: true, bg: 'bg-block-pink' },
            ].map((s) => (
              <div key={s.label} className={`rounded-[28px] p-6 text-block-ink shadow-clay-block ${s.bg}`}>
                <div className="font-display text-4xl font-bold tracking-tight">
                  <RollingNumber value={s.value} format={s.money ? (n) => `$${n.toFixed(2)}` : undefined} />
                </div>
                <div className="mt-1 text-sm text-block-ink/85">{s.label}</div>
              </div>
            ))}
          </Reveal>
          {stats.simulatedReceipts ? <p className="text-xs text-muted">Plus {stats.simulatedReceipts} simulated demo reviews, labelled wherever they appear.</p> : null}
        </section>
      ) : null}

      <Reveal>
        <section className="relative isolate overflow-hidden rounded-[40px] bg-block-lime p-8 text-block-ink shadow-clay-block sm:p-12">
          <div className="bg-dots absolute inset-0 -z-10 opacity-60" aria-hidden />
          <Orbs orbs={CTA_ORBS} className="-z-10" />
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            <div className="flex-1 space-y-2">
              <h2 className="text-3xl font-extrabold sm:text-5xl">
                Bought something <span className="font-serif font-normal italic">this week?</span>
              </h2>
              <p className="max-w-lg text-base text-block-ink/85">Review it with its receipt. It takes under a minute, and you are paid whenever an agent cites it.</p>
            </div>
            <LinkButton href="/review" size="lg" className="bg-block-ink! text-block-lime!">
              Write a verified review
              <ArrowRight className="size-4" aria-hidden />
            </LinkButton>
          </div>
        </section>
      </Reveal>
    </div>
  );
}

/** One step of "How it works": a vibrant clay block with its number, a clay bubble for the icon, and its own visual. */
function Step({ n, Icon, title, className, children }: { n: string; Icon: typeof Coins; title: string; className: string; children: ReactNode }) {
  return (
    <article className={`grid gap-6 rounded-[36px] p-7 text-block-ink shadow-clay-block sm:grid-cols-[auto_1fr] sm:gap-10 sm:p-10 ${className}`}>
      <div className="flex items-center gap-4 sm:flex-col sm:items-start">
        <span className="font-mono text-xs tracking-[0.2em]">{n}</span>
        <span className="grid size-16 place-items-center rounded-full bg-block-bubble shadow-clay-sm">
          <Icon className="size-7" aria-hidden />
        </span>
      </div>
      <div className="min-w-0 text-base leading-relaxed text-block-ink/85">
        <h3 className="mb-3 text-4xl font-extrabold tracking-tight text-block-ink sm:text-5xl">{title}</h3>
        {children}
      </div>
    </article>
  );
}
