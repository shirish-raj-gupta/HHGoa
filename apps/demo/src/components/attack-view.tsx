'use client';

import { useState } from 'react';
import { Button, Card, Notice, Tag } from '@receipts/react';
import { operator, setToken, StageAuthError } from '@/lib/stage-client';

// The attack, live: five planted accounts funded by one wallet rate a bad place five stars. A plain average jumps;
// the trust score barely moves, the ring is flagged and the investigator writes the case file. Simulated and
// labelled; it touches only fictional "(demo)" merchants.

interface AttackResult {
  simulated: boolean;
  target: { merchant: string; item: string };
  before: { score: number | null; reviews: number };
  after: { score: number | null; reviews: number };
  naiveAverage: { before: number | null; after: number | null };
  flags: { id: string; signal: string; members: number }[];
  caseFile: {
    summary: string;
    recommendation: 'confirm' | 'clear';
    confidence: string;
    generatedBy: 'agent' | 'scripted';
    findings: { statement: string; queries: string[]; entities: string[] }[];
    queries: { id: string; tool: string }[];
  } | null;
}

const fmt = (x: number | null) => (x === null ? '—' : x.toFixed(2));

function Move({ label, before, after, tone }: { label: string; before: number | null; after: number | null; tone: 'bad' | 'good' }) {
  const delta = before !== null && after !== null ? after - before : null;
  return (
    <Card className="space-y-2">
      <div className="text-sm text-muted">{label}</div>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-semibold text-muted">{fmt(before)}</span>
        <span className="text-muted">→</span>
        <span className="text-5xl font-semibold">{fmt(after)}</span>
      </div>
      {delta !== null ? <Tag tone={tone}>{`${delta >= 0 ? '+' : ''}${delta.toFixed(2)} stars`}</Tag> : null}
    </Card>
  );
}

export function AttackView() {
  const [result, setResult] = useState<AttackResult | null>(null);
  const [busy, setBusy] = useState<'run' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needToken, setNeedToken] = useState(false);
  const [token, setTokenInput] = useState('');

  const call = async (which: 'run' | 'reset') => {
    setBusy(which);
    setError(null);
    try {
      if (which === 'run') setResult(await operator<AttackResult>('/api/attack'));
      else {
        await operator('/api/attack/reset');
        setResult(null);
      }
    } catch (e) {
      if (e instanceof StageAuthError) setNeedToken(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button busy={busy === 'run'} onClick={() => void call('run')}>
          Plant a review ring
        </Button>
        <Button tone="secondary" busy={busy === 'reset'} onClick={() => void call('reset')}>
          Reset
        </Button>
        <Tag tone="warn">simulated · fictional “(demo)” merchants only</Tag>
      </div>
      {needToken ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setToken(token.trim());
            setNeedToken(false);
          }}
        >
          <input className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5" value={token} onChange={(e) => setTokenInput(e.target.value)} placeholder="Operator token (DEMO_TOKEN)" type="password" />
          <Button type="submit" tone="secondary">
            Save
          </Button>
        </form>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}

      {result ? (
        <div className="space-y-4">
          <p className="text-lg">
            Five new accounts, all funded by one wallet, gave <strong>{result.target.item}</strong> at <strong>{result.target.merchant}</strong> five stars within minutes.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Move label="A plain star average" before={result.naiveAverage.before} after={result.naiveAverage.after} tone="bad" />
            <Move label="The Receipts trust score" before={result.before.score} after={result.after.score} tone="good" />
          </div>
          <Card className="space-y-2">
            <div className="text-sm font-semibold">What the trust engine flagged</div>
            <div className="flex flex-wrap gap-1.5">
              {result.flags.map((f) => (
                <Tag key={f.id} tone="bad">
                  {f.signal.replace(/_/g, ' ')} · {f.members} accounts
                </Tag>
              ))}
            </div>
          </Card>
          {result.caseFile ? (
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Investigator’s case file</span>
                <Tag tone={result.caseFile.recommendation === 'confirm' ? 'bad' : 'good'}>recommends: {result.caseFile.recommendation}</Tag>
                <Tag>confidence {result.caseFile.confidence}</Tag>
                <Tag>{result.caseFile.generatedBy === 'agent' ? 'written by the investigator agent' : 'scripted (no model key)'}</Tag>
              </div>
              <p>{result.caseFile.summary}</p>
              <ul className="space-y-1.5 text-sm">
                {result.caseFile.findings.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted">{i + 1}.</span>
                    <span>
                      {f.statement} <span className="font-mono text-xs text-muted">[{f.queries.join(', ')}]</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">Every finding cites the graph queries it came from. A person confirms or clears the flag; the agent cannot.</p>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
