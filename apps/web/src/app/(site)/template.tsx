'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { EASE_OUT } from '@receipts/react';

// Re-mounts on every navigation: each page settles in with a short fade and lift. The home and developer pages
// use the full width; everything else keeps a reading width.
const WIDE = new Set(['/', '/developers']);

export default function Template({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      className={`mx-auto w-full ${WIDE.has(path) ? 'max-w-5xl' : 'max-w-3xl'}`}
    >
      {children}
    </motion.div>
  );
}
