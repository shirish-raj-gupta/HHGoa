'use client';

import { Fragment, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Coins, Dot, Flag, Globe, Search, ShieldCheck, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import type { AgentStep, BaselineResult, ReceiptsResult } from '@receipts/agent';
import { PLANTED_RESTAURANT } from '@receipts/agent/sandbox';
import { explorerTxUrl } from '@receipts/core';
import { Button, EASE_OUT, inputCls, LogoMark, Notice, Tag } from '@receipts/react';
import { runStage, setToken, StageAuthError } from '@/lib/stage-client';

// The split screen. Same question, same model; the left agent searches a sandboxed copy of the open web with four
// planted SEO pages, the right one asks Receipts over MCP and pays per call in USDC over x402.

type Side = 'baseline' | 'receipts';
type Outcome<T> = T | { error: string };

const DEFAULT_QUESTION = 'Best veg biryani under ₹400 near Calangute?';

const KIND_ICON: Record<AgentStep['kind'], LucideIcon> = {
  search: Search,
  open: ArrowUpRight,
  tool: Wrench,
  payment: Coins,
  verify: ShieldCheck,
  answer: Flag,
  note: Dot,
  error: TriangleAlert,
};

function chainOf(network: string): number {
  return Number(network.split(':')[1] ?? 0);
}

/** Plain text with its URLs made clickable; answers may quote receipt links. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="link font-medium">
            {p.replace(/^https?:\/\//, '').slice(0, 42)}
          </a>
        ) : (
          <Fragment key={i}>{p.replace(/\*\*/g, '')}</Fragment>
        ),
      )}
    </>
  );
}

function Steps({ steps }: { steps: AgentStep[] }) {
  return (
    <ol className="space-y-2 font-mono text-[13px]">
      {steps
        .filter((s) => s.kind !== 'answer')
        .map((s, i) => {
          const Icon = KIND_ICON[s.kind];
          return (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
              className={`flex gap-2.5 ${s.kind === 'error' ? 'text-bad' : s.kind === 'payment' || s.kind === 'verify' ? 'text-good' : 'text-muted'}`}
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{s.label}</span>
            </motion.li>
          );
        })}
    </ol>
  );
}

function Panel({ title, sub, tone, steps, children, running }: { title: string; sub: string; tone: 'web' | 'receipts'; steps: AgentStep[]; children: ReactNode; running: boolean }) {
  return (
    <section
      className={`flex min-h-[30rem] flex-col gap-5 rounded-3xl border p-6 ${tone === 'receipts' ? 'beam border-transparent bg-surface shadow-[0_30px_60px_-30px_rgb(149_246_75/0.3)]' : 'border-line bg-sunken'}`}
    >
      <header className="flex items-start gap-3">
        <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${tone === 'receipts' ? 'bg-brand text-brand-ink' : 'bg-surface text-muted'}`}>
          {tone === 'receipts' ? <LogoMark className="h-6 w-auto" title={null} /> : <Globe className="size-5" aria-hidden />}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">{title}</h2>
            {running ? (
              <span className="flex gap-1" aria-label="working">
                {[0, 1, 2].map((i) => (
                  <motion.span key={i} className="size-1.5 rounded-full bg-accent" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />
                ))}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted">{sub}</p>
        </div>
      </header>
      <Steps steps={steps} />
      {steps.length === 0 && !running ? <p className="font-mono text-sm text-muted">Idle · waiting for the question</p> : null}
      <div className="mt-auto space-y-3">{children}</div>
    </section>
  );
}

export function Stage() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<Side, AgentStep[]>>({ baseline: [], receipts: [] });
  const [result, setResult] = useState<{ baseline: Outcome<BaselineResult>; receipts: Outcome<ReceiptsResult> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needToken, setNeedToken] = useState(false);
  const [token, setTokenInput] = useState('');
  const abort = useRef<AbortController | null>(null);

  const run = async (e?: FormEvent) => {
    e?.preventDefault();
    abort.current?.abort();
    abort.current = new AbortController();
    setRunning(true);
    setError(null);
    setResult(null);
    setSteps({ baseline: [], receipts: [] });
    try {
      await runStage(
        question,
        (event, data) => {
          if (event === 'step') {
            const { agent, step } = data as { agent: Side; step: AgentStep };
            setSteps((prev) => ({ ...prev, [agent]: [...prev[agent], step] }));
          } else if (event === 'result') setResult(data as { baseline: Outcome<BaselineResult>; receipts: Outcome<ReceiptsResult> });
          else if (event === 'error') setError((data as { message: string }).message);
        },
        abort.current.signal,
      );
    } catch (err) {
      if (err instanceof StageAuthError) setNeedToken(true);
      else if (!(err instanceof DOMException && err.name === 'AbortError')) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const baseline = result && !('error' in result.baseline) ? result.baseline : null;
  const receipts = result && !('error' in result.receipts) ? result.receipts : null;

  return (
    <div className="space-y-5">
      <form onSubmit={run} className="flex flex-col gap-3 sm:flex-row">
        <input className={`${inputCls} rounded-2xl! py-3.5! text-xl`} value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Question for both agents" />
        <Button type="submit" tone="brand" size="lg" busy={running} className="sm:w-56">
          Ask both agents
        </Button>
      </form>
      {needToken ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setToken(token.trim());
            setNeedToken(false);
            void run();
          }}
        >
          <input className={inputCls} value={token} onChange={(e) => setTokenInput(e.target.value)} placeholder="Operator token (DEMO_TOKEN)" type="password" />
          <Button type="submit" tone="secondary">
            Save
          </Button>
        </form>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="An agent on the open web"
          sub={`web_search + open_page over a sandboxed copy of the web · ${baseline?.model ?? 'same model as the right'}`}
          tone="web"
          steps={steps.baseline}
          running={running && !baseline}
        >
          {result && 'error' in result.baseline ? <Notice tone="bad">{result.baseline.error}</Notice> : null}
          {baseline ? (
            <>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-line bg-surface p-5 text-base leading-relaxed whitespace-pre-wrap">
                <Linkified text={baseline.answer} />
              </motion.div>
              <div className="flex flex-wrap gap-1.5">
                <Tag tone={baseline.plantedShare > 0.3 ? 'bad' : 'neutral'}>
                  {Math.round(baseline.plantedShare * 100)}% of its {baseline.sources.length} sources were planted
                </Tag>
                {baseline.recommendedPlanted ? <Tag tone="bad">recommended {PLANTED_RESTAURANT}, which no buyer has reviewed</Tag> : null}
                <Tag>{baseline.generatedBy === 'llm' ? 'model' : 'scripted, no model key'}</Tag>
              </div>
            </>
          ) : null}
        </Panel>

        <Panel
          title="The same agent with Receipts"
          sub={`MCP tools, paid per call in USDC over x402 · ${receipts?.model ?? 'same model as the left'}`}
          tone="receipts"
          steps={steps.receipts}
          running={running && !receipts}
        >
          {result && 'error' in result.receipts ? <Notice tone="bad">{result.receipts.error}</Notice> : null}
          {receipts ? (
            <>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-brand/40 bg-accent-soft p-5 text-base leading-relaxed whitespace-pre-wrap">
                <Linkified text={receipts.answer} />
              </motion.div>
              <div className="flex flex-wrap gap-1.5">
                {receipts.payments.length ? (
                  receipts.payments.map((p, i) => {
                    const url = p.tx ? explorerTxUrl(chainOf(p.network), p.tx) : null;
                    return (
                      <Tag key={i} tone="good">
                        paid ${p.amountUsdc} for {p.tool}
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center underline">
                            tx
                            <ArrowUpRight className="size-3" aria-hidden />
                          </a>
                        ) : null}
                      </Tag>
                    );
                  })
                ) : (
                  <Tag tone="warn">{receipts.paying ? 'no payment needed' : 'x402 off on this server: answered free'}</Tag>
                )}
                {receipts.verified ? (
                  <Tag tone={receipts.verified.allPass ? 'good' : 'bad'}>
                    receipt re-verified: {receipts.verified.passed}/{receipts.verified.applicable} checks
                  </Tag>
                ) : null}
                {receipts.top ? <Tag>{receipts.top.verified_reviews} verified buyers</Tag> : null}
                <Tag>{receipts.generatedBy === 'llm' ? 'model' : 'scripted, no model key'}</Tag>
              </div>
            </>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
