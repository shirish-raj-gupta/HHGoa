'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { BadgeCheck, LayoutDashboard, ListChecks, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Logo, ThemeToggle } from '@receipts/react';

const LINKS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: '/', label: 'Overview', Icon: LayoutDashboard },
  { href: '/claims', label: 'Claims', Icon: BadgeCheck },
  { href: '/moderation', label: 'Moderation', Icon: ShieldCheck },
  { href: '/providers', label: 'Providers', Icon: ListChecks },
];

const isActive = (path: string, href: string) => (href === '/' ? path === '/' : path.startsWith(href));

export function Nav() {
  const path = usePathname();
  return (
    <>
      <header className="sticky top-3 z-30 px-3">
        <div className="glass mx-auto flex h-15 max-w-6xl items-center gap-3 rounded-full pr-2 pl-4 sm:pl-5">
          <Link href="/" className="rounded-lg" aria-label="Receipts admin, overview">
            <Logo sub="Admin" />
          </Link>
          <nav className="ml-auto hidden items-center gap-1 text-sm md:flex" aria-label="Main">
            {LINKS.map((l) => {
              const on = isActive(path, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={on ? 'page' : undefined}
                  className={`relative flex min-h-11 shrink-0 items-center rounded-full px-3 font-medium transition-colors sm:px-3.5 ${on ? 'text-accent-ink' : 'text-ink/75 hover:text-ink'}`}
                >
                  {on ? <motion.span layoutId="admin-nav" className="absolute inset-0 rounded-full bg-accent shadow-clay-sm" transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }} /> : null}
                  <span className="relative">{l.label}</span>
                </Link>
              );
            })}
          </nav>
          <ThemeToggle className="ml-auto shrink-0 md:ml-1" />
        </div>
      </header>

      {/* Under 768px: a floating glass tab bar, as in the other apps, so the header keeps room for the theme toggle. */}
      <nav aria-label="Main" className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 rounded-[28px] p-1.5 md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {LINKS.map((l) => {
            const on = isActive(path, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={on ? 'page' : undefined}
                className={`relative flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-[22px] text-[11px] font-medium transition-colors ${on ? 'text-accent-ink' : 'text-ink/75'}`}
              >
                {on ? <motion.span layoutId="admin-tab" className="absolute inset-0 rounded-[22px] bg-accent shadow-clay-sm" transition={{ type: 'spring', bounce: 0.25, duration: 0.45 }} /> : null}
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
