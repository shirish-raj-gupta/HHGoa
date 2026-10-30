'use client';

import Link from 'next/link';
import { motion, type Variants } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowUpRight, BadgeCheck, Bot, CreditCard, LayoutDashboard, ListChecks, ReceiptText, ShieldCheck, Store, Trophy, Wallet, type LucideIcon } from 'lucide-react';
import { Wordmark } from './brand';
import { EASE_OUT } from './motion';

// The navy footer every web app shares. Each page is a sheet that lifts off it: put the nav and main in a
// <div className="relative z-10 flex-1 rounded-b-[40px] bg-bg shadow-sheet sm:rounded-b-[64px]"> inside a
// <div className="flex min-h-dvh flex-col">, then render this, so short pages still reach the bottom of the window.
// The footer is sticky to the bottom (it shows as the sheet's rounded edge scrolls past), so "in view" would fire at
// once while it is still hidden: its links and the giant "receipts." animate in when the page nears its end instead.

export type FooterIcon = 'trophy' | 'bot' | 'wallet' | 'store' | 'claim' | 'plans' | 'receipt' | 'dashboard' | 'shield' | 'list';

const ICONS: Record<FooterIcon, LucideIcon> = { trophy: Trophy, bot: Bot, wallet: Wallet, store: Store, claim: BadgeCheck, plans: CreditCard, receipt: ReceiptText, dashboard: LayoutDashboard, shield: ShieldCheck, list: ListChecks };

const list: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } } };
const item: Variants = { hidden: { opacity: 0, y: 14 }, shown: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_OUT } } };
const chip: Variants = { hidden: { scale: 0.6, rotate: -20 }, shown: { scale: 1, rotate: 0, transition: { type: 'spring', bounce: 0.45, duration: 0.6 } } };
const word: Variants = { hidden: { opacity: 0, y: '22%' }, shown: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE_OUT, delay: 0.15 } } };

/** True once the page has been scrolled near its end, where the footer shows (or at once on a page too short to
 *  scroll). It stays true. */
function useNearEnd(ref: RefObject<HTMLElement | null>): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) return;
    const check = () => {
      const doc = document.documentElement;
      const footer = ref.current?.offsetHeight ?? 0;
      if (doc.scrollHeight - window.innerHeight <= 8 || window.scrollY + window.innerHeight >= doc.scrollHeight - footer * 0.6) setShown(true);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [ref, shown]);
  return shown;
}

/** A link to another app (a full URL: another zone such as /business, or another origin) is a plain anchor, since
 *  next/link would take a same-origin URL for a page of this app and try to navigate to it in place. */
function FooterLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
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

export function CurtainFooter({ sub, links, children }: { sub?: ReactNode; links: { href: string; label: string; icon: FooterIcon }[]; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const shown = useNearEnd(ref);
  const state = shown ? 'shown' : 'hidden';
  return (
    <footer ref={ref} className="sticky bottom-0 z-0 overflow-hidden bg-curtain pb-20 text-curtain-ink md:pb-0">
      <div className="mx-auto grid max-w-5xl gap-10 px-4 pt-20 pb-4 sm:grid-cols-[1fr_auto] sm:px-6">
        <motion.div className="space-y-3" variants={list} initial="hidden" animate={state}>
          <motion.span variants={item} className="inline-flex items-center gap-2">
            <Wordmark onNavy title="Receipts" className="h-8 w-auto shrink-0" />
            {sub ? <span className="font-sans text-[0.68rem] font-semibold tracking-wide text-curtain-ink/75 uppercase">{sub}</span> : null}
          </motion.span>
          <motion.p variants={item} className="font-display text-sm text-curtain-ink/75">
            No receipt, no review.
          </motion.p>
          <motion.div variants={item} className="max-w-xl text-xs leading-relaxed text-curtain-ink/75">
            {children}
          </motion.div>
        </motion.div>
        <nav aria-label="More">
          <motion.ul className="grid gap-0.5 sm:min-w-60" variants={list} initial="hidden" animate={state}>
            {links.map((l) => {
              const Icon = ICONS[l.icon];
              return (
                <motion.li key={l.href} variants={item}>
                  <FooterLink
                    href={l.href}
                    className="group flex min-h-11 items-center gap-3 rounded-2xl px-2 py-1 text-sm text-curtain-ink/80 transition-colors hover:bg-curtain-ink/5 hover:text-curtain-ink focus-visible:outline-brand"
                  >
                    {/* Motion owns the entrance transform, CSS the hover tilt: one wrapper each. */}
                    <motion.span variants={chip} className="shrink-0">
                      <span className="grid size-9 place-items-center rounded-xl bg-curtain-ink/10 text-brand ring-1 ring-curtain-ink/15 transition-transform duration-300 ease-squish group-hover:-rotate-6 group-hover:scale-110 motion-reduce:transform-none">
                        <Icon className="size-[1.05rem]" aria-hidden />
                      </span>
                    </motion.span>
                    <span className="flex-1">{l.label}</span>
                    <ArrowUpRight
                      className="size-4 -translate-x-1 opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
                      aria-hidden
                    />
                  </FooterLink>
                </motion.li>
              );
            })}
          </motion.ul>
        </nav>
      </div>
      {/* Room below for the descender (the old cut-off look read as a bug); it rises into place as the page ends. */}
      <motion.p
        aria-hidden
        variants={word}
        initial="hidden"
        animate={state}
        className="px-2 pb-[0.16em] text-center font-display text-[24vw] leading-none font-extrabold tracking-[-0.06em] text-brand select-none sm:text-[19vw]"
      >
        receipts.
      </motion.p>
    </footer>
  );
}
