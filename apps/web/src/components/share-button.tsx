'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Share2 } from 'lucide-react';

/** Shares the page with the system sheet where there is one, otherwise copies the link. */
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      type="button"
      onClick={() => void share()}
      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold transition-colors hover:border-line-strong active:scale-[0.97]"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={copied ? 'done' : 'share'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="inline-flex items-center gap-2">
          {copied ? <Check className="size-4 text-good" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
          {copied ? 'Link copied' : 'Share'}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
