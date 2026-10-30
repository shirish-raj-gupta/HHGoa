'use client';

import { Fragment } from 'react';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { EASE_OUT } from '@receipts/react';

/** Where the reviewer is in the flow: done steps show a lime check, the current one a navy ring. */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <Fragment key={label}>
            {i > 0 ? (
              <li aria-hidden className="relative h-0.5 min-w-4 flex-1 overflow-hidden rounded-full bg-line">
                <motion.span className="absolute inset-0 origin-left bg-brand-strong" initial={false} animate={{ scaleX: i <= current ? 1 : 0 }} transition={{ duration: 0.5, ease: EASE_OUT }} />
              </li>
            ) : null}
            <li className="flex items-center gap-2" aria-current={now ? 'step' : undefined}>
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors ${done ? 'bg-brand text-brand-ink' : now ? 'bg-accent text-accent-ink ring-4 ring-accent/15' : 'bg-sunken text-muted'}`}
              >
                {done ? <Check className="size-4" strokeWidth={3} aria-label="done" /> : i + 1}
              </span>
              <span className={`hidden text-sm font-semibold sm:inline ${now ? 'text-ink' : 'text-muted'}`}>{label}</span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
