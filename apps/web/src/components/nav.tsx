'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { Bot, CalendarCheck, Coins, ReceiptText, Search, type LucideIcon } from 'lucide-react';
import { shortAddr } from '@receipts/client';
import { Logo, ThemeToggle, useSession, useWallet } from '@receipts/react';

const LINKS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: '/', label: 'Ask', Icon: Search },
  { href: '/review', label: 'Review', Icon: ReceiptText },
  { href: '/followups', label: 'Check-ins', Icon: CalendarCheck },
  { href: '/earnings', label: 'Earnings', Icon: Coins },
  { href: '/developers', label: 'Agents', Icon: Bot },
];

const active = (path: string, href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

export function Nav() {
  const path = usePathname();
  const { wallet } = useWallet();
  const { human, status } = useSession();
  return (
    <>
      {/* A glass capsule that floats over the page; the current page sits in a clay pill that slides between links. */}
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-4">
        <div className="glass mx-auto flex h-15 max-w-5xl items-center gap-3 rounded-full pr-2 pl-4 sm:pl-5">
          <Link href="/" className="rounded-lg" aria-label="Receipts home">
            <Logo />
          </Link>
          <nav className="ml-auto hidden items-center gap-1 text-sm md:flex" aria-label="Main">
            {LINKS.map((l) => {
              const on = active(path, l.href);
              return (
                <Link key={l.href} href={l.href} aria-current={on ? 'page' : undefined} className={`relative rounded-full px-3.5 py-2 font-medium transition-colors ${on ? 'text-accent-ink' : 'text-ink/75 hover:text-ink'}`}>
                  {on ? <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-accent shadow-clay-sm" transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }} /> : null}
                  <span className="relative">{l.label}</span>
                </Link>
              );
            })}
          </nav>
          <ThemeToggle className="ml-auto md:ml-3" />
          <Link
            href="/onboard"
            className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-xs font-semibold shadow-clay-sm transition-[transform,filter] duration-200 ease-squish hover:-translate-y-px active:scale-[0.96] ${wallet ? 'bg-surface ring-1 ring-line ring-inset' : 'bg-accent text-accent-ink hover:brightness-110'}`}
            title={wallet ? wallet.address : 'Connect a wallet'}
          >
            {wallet ? (
              <>
                <span className={`size-2 rounded-full ${human ? 'bg-brand-strong' : status === 'signed-in' ? 'bg-warn' : 'bg-line-strong'}`} aria-hidden />
                <span className="font-mono">{shortAddr(wallet.address)}</span>
                <span className="sr-only">{human ? 'verified human' : status === 'signed-in' ? 'signed in, not yet verified' : 'not signed in'}</span>
              </>
            ) : (
              'Sign in'
            )}
          </Link>
        </div>
      </header>

      {/* Under 768px (phones, small tablets): a floating glass tab bar within thumb reach, with the same clay pill. */}
      <nav aria-label="Main" className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 rounded-[28px] p-1.5 md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {LINKS.map((l) => {
            const on = active(path, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={on ? 'page' : undefined}
                className={`relative flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-[22px] text-[11px] font-medium transition-colors ${on ? 'text-accent-ink' : 'text-ink/75'}`}
              >
                {on ? <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-[22px] bg-accent shadow-clay-sm" transition={{ type: 'spring', bounce: 0.25, duration: 0.45 }} /> : null}
                <l.Icon className="relative size-5" strokeWidth={on ? 2.4 : 1.9} aria-hidden />
                <span className="relative">{l.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
