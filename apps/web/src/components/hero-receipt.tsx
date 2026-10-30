'use client';

import { motion, type Variants } from 'motion/react';
import { Check, Coins } from 'lucide-react';
import { EASE_OUT, Stars, VerifiedStamp } from '@receipts/react';

// The home page illustration: what a receipt carries. It is an example, labelled as one, not live data.

const CHECKS = ['Purchase proven: order page, Reclaim', 'One human: passport check, Self', 'One purchase, one review', 'Anchored on Base: EAS attestation'];

const list: Variants = { hidden: {}, shown: { transition: { delayChildren: 0.55, staggerChildren: 0.16 } } };
const row: Variants = { hidden: { opacity: 0, x: -8 }, shown: { opacity: 1, x: 0, transition: { duration: 0.35, ease: EASE_OUT } } };
const tick: Variants = { hidden: { scale: 0 }, shown: { scale: 1, transition: { type: 'spring', bounce: 0.45, duration: 0.45 } } };

export function HeroReceipt() {
  return (
    <div className="relative mx-auto w-full max-w-sm" role="img" aria-label="An example receipt: a proven purchase, a verified unique human, one review per purchase, anchored on Base.">
      <div className="absolute -inset-2 -z-10 rounded-[2.5rem] bg-accent-soft/80 blur-2xl sm:-inset-6" aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: 28, rotate: -5 }}
        animate={{ opacity: 1, y: 0, rotate: -2 }}
        transition={{ type: 'spring', bounce: 0.25, duration: 0.8 }}
        className="[filter:drop-shadow(0_22px_32px_rgb(var(--shadow-color)/0.2))]"
      >
        <div className="perforated" />
        <div className="bg-surface px-6 pt-4 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] tracking-[0.2em] text-muted uppercase">Example receipt</p>
              <h3 className="mt-1 text-xl font-bold">Veg Dum Biryani</h3>
              <p className="text-sm text-muted">Coastal kitchen · Calangute</p>
            </div>
            <VerifiedStamp className="shrink-0 px-2.5!">Verified</VerifiedStamp>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Stars value={4} size="text-lg" />
            <span className="font-mono text-xs text-muted">4.0</span>
          </div>
          <p className="mt-3 font-serif text-xl leading-snug italic">“Not oily at all. The portion fed two of us.”</p>
          <div className="my-4 border-t-2 border-dashed border-line" />
          <motion.ul variants={list} initial="hidden" animate="shown" className="space-y-2 font-mono text-[11px] leading-tight">
            {CHECKS.map((c) => (
              <motion.li key={c} variants={row} className="flex items-center gap-2.5">
                <motion.span variants={tick} className="grid size-4 shrink-0 place-items-center rounded-full bg-brand text-brand-ink">
                  <Check className="size-3" strokeWidth={3.5} />
                </motion.span>
                {c}
              </motion.li>
            ))}
          </motion.ul>
          <div className="my-4 border-t-2 border-dashed border-line" />
          <div className="flex justify-between font-mono text-[11px] text-muted">
            <span>PAID ₹290 · UPI</span>
            <span>0x11b7…ff48</span>
          </div>
        </div>
        <div className="perforated rotate-180" />
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 1.45, type: 'spring', bounce: 0.35, duration: 0.6 }}
        className="absolute right-2 -bottom-5 flex items-center gap-2 rounded-2xl bg-accent px-3.5 py-2.5 text-accent-ink shadow-lift sm:-right-8"
      >
        <span className="grid size-7 place-items-center rounded-full bg-accent-mark text-accent">
          <Coins className="size-4" />
        </span>
        <span className="text-xs leading-tight">
          <span className="block font-semibold">An agent cited it</span>
          <span className="block opacity-80">the reviewer earns USDC</span>
        </span>
      </motion.div>
    </div>
  );
}
