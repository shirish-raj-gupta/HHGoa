'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';

const LINKS = [
  ['/', 'Two agents'],
  ['/attack', 'The attack'],
  ['/stats', 'The week in numbers'],
  ['/sandbox', 'The sandbox'],
] as const;

export function StageNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto text-sm" aria-label="Stage">
      {LINKS.map(([href, label]) => {
        const on = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={on ? 'page' : undefined} className={`relative shrink-0 rounded-full px-3.5 py-2 font-medium transition-colors ${on ? 'text-accent-ink' : 'text-ink/75 hover:text-ink'}`}>
            {on ? <motion.span layoutId="stage-nav" className="absolute inset-0 rounded-full bg-accent shadow-clay-sm" transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }} /> : null}
            <span className="relative">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
