'use client';

import { useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { CircleCheck, CircleMinus, CircleX, RefreshCw, ShieldCheck } from 'lucide-react';
import type { VerifyResult } from '@receipts/client';
import { Button, EASE_OUT, errorText, Notice, useSession } from '@receipts/react';

const list: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.09 } } };
const row: Variants = { hidden: { opacity: 0, y: 6 }, shown: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } } };

/** Re-runs every check on the server that holds the proof; anyone can press it. */
export function VerifyPanel({ id }: { id: string }) {
  const { client } = useSession();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [runs, setRuns] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await client.verify(id));
      setRuns((n) => n + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button tone={result ? 'secondary' : 'primary'} busy={busy} onClick={() => void run()}>
        {result ? <RefreshCw className="size-4" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
        {result ? 'Check again' : 'Re-check this receipt'}
      </Button>
      <AnimatePresence mode="wait">
        {result ? (
          <motion.div key={runs} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3" aria-live="polite">
            <motion.ul variants={list} initial="hidden" animate="shown" className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {result.checks.map((c) => (
                <motion.li key={c.check} variants={row} className="flex gap-3 bg-surface px-4 py-3 text-sm">
                  {c.pass === null ? (
                    <CircleMinus className="mt-0.5 size-5 shrink-0 text-muted" aria-label="does not apply" />
                  ) : c.pass ? (
                    <CircleCheck className="mt-0.5 size-5 shrink-0 text-good" aria-label="passed" />
                  ) : (
                    <CircleX className="mt-0.5 size-5 shrink-0 text-bad" aria-label="failed" />
                  )}
                  <span className="min-w-0">
                    <span className="font-semibold">{c.check}</span> <span className="text-muted">{c.detail}</span>
                  </span>
                </motion.li>
              ))}
            </motion.ul>
            <Notice tone={result.allPass ? 'good' : 'bad'}>
              {result.allPass
                ? result.checks.some((c) => c.pass === null)
                  ? 'Every check that applies passed. Checks marked with a dash do not apply to this receipt.'
                  : 'Every check passed.'
                : 'A check failed. Treat this review with care.'}
            </Notice>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </div>
  );
}
