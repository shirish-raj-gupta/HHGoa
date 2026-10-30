'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowRight, Bot, ReceiptText, RotateCcw, Search, Sparkles, Store, X, type LucideIcon } from 'lucide-react';
import { EASE_OUT, Orbs, Wordmark, type OrbSpec } from '@receipts/react';
import { MERCHANT_URL } from '@/lib/env';
import { liftSplashCover, readVisitor, saveVisitor, type Visitor } from '@/lib/visitor';

// The front door. On a first visit to the home page: the wordmark, then "What brings you to Receipts?". The choice is
// kept in this browser; it sends people where they meant to go, and the home page leads with it afterwards.

type Door = { visitor: Visitor; title: string; sub: string; Icon: LucideIcon; block: string; href: string | null; next: string | null };

const DOORS: Door[] = [
  { visitor: 'shopper', title: 'Find what is actually good', sub: 'Answers from people who can prove they bought it.', Icon: Search, block: 'bg-block-sky', href: null, next: null },
  { visitor: 'reviewer', title: 'Review what I bought', sub: 'Prove it, talk for fifteen seconds, get paid when agents cite it.', Icon: ReceiptText, block: 'bg-block-lime', href: '/review', next: 'Write a verified review' },
  { visitor: 'business', title: 'I run a business', sub: 'Claim your listing, reply in public, hand out signed receipts.', Icon: Store, block: 'bg-block-pink', href: MERCHANT_URL, next: 'Open Receipts for businesses' },
  { visitor: 'developer', title: 'I build AI agents', sub: 'Cite verified reviews over MCP, paid per answer with x402.', Icon: Bot, block: 'bg-block-violet', href: '/developers', next: 'Agent docs and MCP' },
];

// In the margins beside the 48rem column on wide screens; on phones one in the empty top-left corner, clear of text.
const ORBS: OrbSpec[] = [
  { color: 'lime', size: 190, x: 'calc(50% - 24rem - 250px)', y: '12%', depth: 0, className: 'max-sm:hidden' },
  { color: 'sun', size: 56, x: 'calc(50% - 24rem - 96px)', y: '66%', depth: 0, className: 'max-sm:hidden' },
  { color: 'pink', size: 84, x: 'calc(50% + 24rem + 40px)', y: '14%', depth: 0, className: 'max-sm:hidden' },
  { color: 'violet', size: 150, x: 'calc(50% + 24rem + 80px)', y: '58%', depth: 0, className: 'max-sm:hidden' },
  { color: 'sky', size: 96, x: '-40px', y: '-36px', depth: 0, className: 'sm:hidden' },
];

const list: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } } };
const rise: Variants = { hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } } };
const card: Variants = { hidden: { opacity: 0, y: 26, scale: 0.95 }, shown: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', bounce: 0.32, duration: 0.65 } } };
const glide = { duration: 0.6, ease: EASE_OUT };

/** `intro` plays the wordmark first (a first visit); without it the doors show at once (choosing again). Rendered into
 *  <body>, so nothing on the page (spacing, stacking, transforms) can cut it short. */
export function Splash({ open, intro = true, onDone }: { open: boolean; intro?: boolean; onDone(visitor: Visitor | null): void }) {
  const router = useRouter();
  const still = !!useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<'brand' | 'doors'>('brand');
  const dialog = useRef<HTMLDivElement>(null);
  // Opened under the pre-paint cover (a first visit), the splash shows at once; opened later, it fades in.
  const [covered] = useState(() => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-splash'));

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (open && mounted) liftSplashCover();
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !mounted) return;
    setPhase(still || !intro ? 'doors' : 'brand');
    dialog.current?.focus();
    const t = setTimeout(() => setPhase('doors'), 1400);
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      html.style.overflow = overflow;
    };
  }, [open, mounted, still, intro]);

  // Skipping keeps an earlier choice; on a first visit it only records that the splash was seen.
  function skip() {
    if (!readVisitor()) saveVisitor('skip');
    onDone(null);
  }

  function choose(d: Door) {
    saveVisitor(d.visitor);
    onDone(d.visitor);
    if (!d.href) return;
    if (d.href.startsWith('http')) window.location.assign(d.href);
    else router.push(d.href);
  }

  // Escape skips; Tab stays inside the dialog (which holds focus from the moment it opens).
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') return skip();
    if (e.key !== 'Tab') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button')];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!mounted) return null;
  const big = phase === 'brand';

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="splash"
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="splash-title"
          tabIndex={-1}
          onKeyDown={onKey}
          onPointerDown={() => big && setPhase('doors')}
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-curtain px-4 pt-20 pb-12 text-curtain-ink outline-none sm:px-6"
          initial={{ opacity: covered ? 1 : 0 }}
          animate={{ opacity: 1, transition: { duration: 0.25 } }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
        >
          <Orbs orbs={ORBS} />
          <div className="relative mx-auto my-auto flex w-full max-w-3xl flex-col items-center">
            <div className="flex flex-col items-center gap-4 text-center">
              <motion.div layout transition={glide}>
                <motion.div
                  initial={still ? false : { opacity: 0, scale: 0.8, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  transition={{ duration: 0.75, ease: EASE_OUT }}
                >
                  <Wordmark onNavy title="Receipts" className={big ? 'h-20 w-auto sm:h-32' : 'h-12 w-auto sm:h-14'} />
                </motion.div>
              </motion.div>
              <motion.span
                layout="position"
                transition={glide}
                aria-hidden
                className="block h-1 w-24 origin-left rounded-full bg-brand"
                initial={still ? false : { scaleX: 0 }}
                animate={{ scaleX: 1, transition: { delay: 0.45, duration: 0.6, ease: EASE_OUT } }}
              />
              <motion.p
                layout="position"
                transition={glide}
                className="font-display text-sm tracking-[0.2em] text-curtain-ink/80 uppercase sm:text-base"
                initial={still ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { delay: 0.6, duration: 0.6, ease: EASE_OUT } }}
              >
                No Receipt, No Review
              </motion.p>
            </div>

            {phase === 'doors' ? (
              <motion.section className="mt-10 w-full" initial="hidden" animate="shown" variants={list}>
                <motion.h2 id="splash-title" variants={rise} className="mb-6 text-center text-3xl font-extrabold tracking-tight sm:text-5xl">
                  What brings you to <span className="font-serif font-normal italic">Receipts?</span>
                </motion.h2>
                <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                  {DOORS.map((d) => (
                    <motion.div key={d.visitor} variants={card}>
                      <button
                        onClick={() => choose(d)}
                        className={`group flex h-full min-h-28 w-full items-start gap-4 rounded-[28px] p-5 text-left text-block-ink shadow-clay-block transition-transform duration-300 ease-squish outline-none hover:-translate-y-1 focus-visible:ring-4 focus-visible:ring-curtain-ink active:scale-[0.97] motion-reduce:transform-none ${d.block}`}
                      >
                        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-block-bubble shadow-clay-sm transition-transform duration-300 ease-squish group-hover:-rotate-6 group-hover:scale-110 motion-reduce:transform-none">
                          <d.Icon className="size-5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-display text-lg leading-tight font-extrabold">{d.title}</span>
                          <span className="mt-1 block text-sm leading-snug text-block-ink/85">{d.sub}</span>
                        </span>
                        <ArrowRight className="mt-1 size-5 shrink-0 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transform-none" aria-hidden />
                      </button>
                    </motion.div>
                  ))}
                </div>
                <motion.p variants={rise} className="mt-6 text-center text-sm text-curtain-ink/75">
                  Kept in this browser only. Change it any time from the home page.
                </motion.p>
              </motion.section>
            ) : (
              <h2 id="splash-title" className="sr-only">
                Receipts
              </h2>
            )}
          </div>

          <button
            onClick={skip}
            className="fixed top-4 right-4 inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-curtain-ink/80 ring-1 ring-curtain-ink/20 transition-colors ring-inset hover:bg-curtain-ink/10 hover:text-curtain-ink"
          >
            Skip
            <X className="size-4" aria-hidden />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function ZoneLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return href.startsWith('http') ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/** Under the ask box: what this visitor came for, one tap away, and a way to choose again. */
export function VisitorBar({ visitor, onChange }: { visitor: Visitor | null; onChange(): void }) {
  const door = DOORS.find((d) => d.visitor === visitor);
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="flex flex-wrap items-center gap-2">
      {door?.href && door.next ? (
        // The business app is another zone (/business): a full page load, so a plain anchor rather than next/link.
        <ZoneLink
          href={door.href}
          className={`group inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold text-block-ink shadow-clay-block transition-transform duration-200 ease-squish hover:-translate-y-0.5 active:scale-[0.97] motion-reduce:transform-none ${door.block}`}
        >
          <door.Icon className="size-4" aria-hidden />
          {door.next}
          <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
        </ZoneLink>
      ) : null}
      <button type="button" onClick={onChange} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted transition-colors hover:bg-sunken hover:text-ink">
        {door ? <RotateCcw className="size-3.5" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
        {door ? (door.href ? 'Here for something else?' : 'Here to find what is good. Change') : 'What brings you here?'}
      </button>
    </motion.div>
  );
}
