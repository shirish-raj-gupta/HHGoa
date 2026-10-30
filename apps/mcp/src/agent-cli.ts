import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEMO_QUESTION, runSideBySide, type BaselineResult, type ReceiptsResult } from '@receipts/agent';
import type { Hex } from 'viem';

// The split-screen demo in a terminal: the baseline agent on the sandboxed poisoned web, and the Receipts agent
// paying over x402, on the same question and the same model.
//   pnpm agent "best veg biryani under ₹400 near Calangute"

for (const f of ['../../../.env.local', '../../../.env']) {
  const p = fileURLToPath(new URL(f, import.meta.url));
  if (existsSync(p)) process.loadEnvFile(p);
}

const question = process.argv.slice(2).join(' ').trim() || DEMO_QUESTION;
const color = { baseline: '\x1b[33m', receipts: '\x1b[36m', reset: '\x1b[0m', dim: '\x1b[2m' };

console.log(`\nQ: ${question}\n`);
const result = await runSideBySide(question, {
  apiUrl: process.env.RECEIPTS_API_URL ?? process.env.PUBLIC_API_URL ?? 'http://localhost:8787',
  privateKey: (process.env.AGENT_PRIVATE_KEY as Hex | undefined) ?? null,
  network: process.env.AGENT_NETWORK ?? process.env.X402_NETWORK ?? 'eip155:84532',
  maxSpendUsdc: Number(process.env.AGENT_BUDGET_USDC ?? '0.05'),
  onStep: (agent, s) => console.log(`${color[agent]}${agent.padEnd(8)}${color.reset} ${s.kind.padEnd(7)} ${s.kind === 'answer' ? '(final below)' : s.label.slice(0, 160)}`),
});

const baseline = result.baseline as BaselineResult | { error: string };
const receipts = result.receipts as ReceiptsResult | { error: string };

console.log(`\n${color.baseline}── Baseline (open web, sandboxed) ──${color.reset}`);
if ('error' in baseline) console.log(`error: ${baseline.error}`);
else {
  console.log(baseline.answer);
  console.log(
    `${color.dim}${baseline.generatedBy}${baseline.model ? ` · ${baseline.model}` : ''} · ${baseline.sources.length} sources, ${Math.round(baseline.plantedShare * 100)}% planted${baseline.recommendedPlanted ? ' · recommended the planted restaurant' : ''}${color.reset}`,
  );
}

console.log(`\n${color.receipts}── Receipts agent ──${color.reset}`);
if ('error' in receipts) console.log(`error: ${receipts.error}`);
else {
  console.log(receipts.answer);
  console.log(
    `${color.dim}${receipts.generatedBy}${receipts.model ? ` · ${receipts.model}` : ''} · spent $${receipts.spentUsdc} USDC in ${receipts.payments.length} payment(s)${receipts.payments
      .map((p) => (p.tx ? ` · ${p.tool} ${p.tx}` : ''))
      .join('')}${receipts.verified ? ` · receipt ${receipts.verified.reviewUid.slice(0, 12)} ${receipts.verified.allPass ? 'verified' : 'FAILED a check'}` : ''}${color.reset}`,
  );
}
console.log('');
