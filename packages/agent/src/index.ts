import { runBaselineAgent, type BaselineResult } from './baseline';
import type { AgentLlm } from './llm';
import { runReceiptsAgent, type ConnectOptions, type ReceiptsResult } from './receipts';
import type { AgentStep } from './steps';

export { runBaselineAgent, mostMentionedName, type BaselineResult } from './baseline';
export { runReceiptsAgent, connectReceipts, type ReceiptsResult, type ReceiptsConnection, type Payment, type ConnectOptions, type ToolOutcome, type Verified } from './receipts';
export { agentLlmFromEnv, type AgentLlm, type AgentTool } from './llm';
export type { AgentStep, StepKind, OnStep } from './steps';
export { PLANTED_RESTAURANT, SANDBOX_PAGES, sandboxSearch, sandboxPage, type SandboxPage } from './sandbox';

export const DEMO_QUESTION = 'Best veg biryani under ₹400 near Calangute?';

/** Both agents on the same question and the same model, side by side; steps stream through onStep. */
export async function runSideBySide(
  question: string,
  opts: ConnectOptions & { llm?: AgentLlm | null; onStep?: (agent: 'baseline' | 'receipts', step: AgentStep) => void },
): Promise<{ baseline: BaselineResult | { error: string }; receipts: ReceiptsResult | { error: string } }> {
  const [baseline, receipts] = await Promise.allSettled([
    runBaselineAgent(question, { llm: opts.llm, onStep: (s) => opts.onStep?.('baseline', s) }),
    runReceiptsAgent(question, { ...opts, onStep: (s) => opts.onStep?.('receipts', s) }),
  ]);
  const unwrap = <T>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : { error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  return { baseline: unwrap(baseline), receipts: unwrap(receipts) };
}
