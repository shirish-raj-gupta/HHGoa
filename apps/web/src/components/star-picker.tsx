'use client';

import { useState, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';

const STAR = 'M12 2.6l2.84 5.98 6.56.79-4.83 4.52 1.25 6.49L12 17.2l-5.82 3.18 1.25-6.49L2.6 9.37l6.56-.79z';
const WORDS = ['', 'Bad', 'Poor', 'Okay', 'Good', 'Excellent'];

/** A 1–5 rating as a radio group: arrow keys move, hover previews, each star is a 44px target. */
export function StarPicker({ value, onChange }: { value: number | null; onChange(n: number): void }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(Math.min(5, (value ?? 0) + 1));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(Math.max(1, (value ?? 2) - 1));
    else return;
    e.preventDefault();
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="radiogroup" aria-label="Stars" className="flex" onKeyDown={onKey} onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <motion.button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            tabIndex={value === n || (value === null && n === 1) ? 0 : -1}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            whileTap={{ scale: 0.85 }}
            className="grid size-11 place-items-center rounded-lg"
          >
            <motion.svg
              viewBox="0 0 24 24"
              className={`size-9 ${n <= shown ? 'text-accent' : 'text-line'}`}
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              animate={{ scale: value === n ? [1, 1.25, 1] : 1 }}
              transition={{ duration: 0.3 }}
              aria-hidden
            >
              <path d={STAR} />
            </motion.svg>
          </motion.button>
        ))}
      </div>
      <span className="min-w-20 font-display text-lg font-semibold">{WORDS[shown] ?? ''}</span>
    </div>
  );
}
