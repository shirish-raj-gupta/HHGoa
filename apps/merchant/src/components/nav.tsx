'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { BadgeCheck, CreditCard, LayoutDashboard, LogOut, type LucideIcon } from 'lucide-react';
import { shortAddr } from '@receipts/client';
import { Logo, ThemeToggle, useWallet } from '@receipts/react';

const LINKS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: '/', label: 'Listings', Icon: LayoutDashboard },
  { href: '/claim', label: 'Claim', Icon: BadgeCheck },
  { href: '/billing', label: 'Plan', Icon: CreditCard },
];

const isActive = (path: string, href: string) => (href === '/' ? path === '/' || path.startsWith('/m/') : path.startsWith(href));

export function Nav() {
  const path = usePathname();
  const { wallet, disconnect } = useWallet();
  return (
    <>
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-4">
        <div className="glass mx-auto flex h-15 max-w-5xl items-center gap-3 rounded-full pr-2 pl-4 sm:pl-5">
          <Link href="/" className="rounded-lg" aria-label="Receipts for business, home">
            <Logo sub="Business" />
          </Link>
          <nav className="ml-auto hidden items-center gap-1 text-sm md:flex" aria-label="Main">
            {LINKS.map((l) => {
              const on = isActive(path, l.href);
              return (
                <Link key={l.href} href={l.href} aria-current={on ? 'page' : undefined} className={`relative rounded-full px-3 py-2 font-medium transition-colors sm:px-3.5 ${on ? 'text-accent-ink' : 'text-ink/75 hover:text-ink'}`}>
                  {on ? <motion.span layoutId="merchant-nav" className="absolute inset-0 rounded-full bg-accent shadow-clay-sm" transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }} /> : null}
                  <span className="relative">{l.label}</span>
                </Link>
              );
            })}
          </nav>
          <ThemeToggle className="ml-auto md:ml-1" />
          {wallet ? (
            <button
              onClick={() => void disconnect()}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-surface font-mono text-xs font-medium shadow-clay-sm ring-1 ring-line ring-inset transition-transform duration-200 ease-squish hover:-translate-y-px active:scale-[0.96] sm:inline-flex sm:w-auto sm:gap-2 sm:px-4"
              title="Sign out"
              aria-label={`Sign out (${shortAddr(wallet.address)})`}
            >
              {/* Phones show only the icon, so the theme toggle keeps its place in the header. */}
              <span className="hidden sm:inline">{shortAddr(wallet.address)}</span>
              <LogOut className="size-3.5 text-muted" aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      {/* Under 768px: the same floating glass tab bar as the reviewer app, so the header keeps room for the theme toggle. */}
      <nav aria-label="Main" className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 rounded-[28px] p-1.5 md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-3">
          {LINKS.map((l) => {
            const on = isActive(path, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={on ? 'page' : undefined}
                className={`relative flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-[22px] text-[11px] font-medium transition-colors ${on ? 'text-accent-ink' : 'text-ink/75'}`}
              >
                {on ? <motion.span layoutId="merchant-tab" className="absolute inset-0 rounded-[22px] bg-accent shadow-clay-sm" transition={{ type: 'spring', bounce: 0.25, duration: 0.45 }} /> : null}
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
