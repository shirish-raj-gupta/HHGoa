import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { createx402MCPClient } from '@x402/mcp';
import { baseToUsdc, usdcToBase, type Answer, type AnswerOption } from '@receipts/core';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { agentLlmFromEnv, type AgentLlm, type AgentTool } from './llm';
import { stepper, type AgentStep, type OnStep } from './steps';

// The Receipts agent: the same model as the baseline, but its tools are Receipts over MCP, and it pays for the
// paid ones in USDC over x402 from its own wallet. Spend is capped twice: per payment (x402 spend controls) and per
// connection (a budget checked before every payment is signed). The server adds a per-agent daily cap of its own.

export interface Payment {
  tool: string;
  amountUsdc: string;
  network: string;
  tx: string | null;
  payer: string;
}

export interface ToolOutcome {
  text: string;
  isError: boolean;
  paid: Payment | null;
  /** Why a payment that was sent did not settle (e.g. the wallet holds too little USDC). */
  paymentError?: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
}

export interface ReceiptsConnection {
  paying: boolean;
  wallet: string | null;
  network: string;
  payments: Payment[];
  spentUsdc(): string;
  listTools(): Promise<McpToolInfo[]>;
  call(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** Receipts API base URL; the MCP endpoint is <apiUrl>/mcp */
  apiUrl: string;
  /** The agent wallet that pays (Base Sepolia USDC for the demo). Without it, paid tools only work if the server runs x402 off. */
  privateKey?: Hex | null;
  /** CAIP-2 network to pay on */
  network?: string;
  /** Total budget for this connection, in USDC. Default $0.05. */
  maxSpendUsdc?: number;
  /** Largest single payment, in USDC. Default $0.01. */
  maxPerCallUsdc?: number;
  onPayment?(p: Payment): void;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((c: { type?: string; text?: string }) => (c.type === 'text' ? (c.text ?? '') : ''))
    .join('\n')
    .trim();
}

/** One call at a time per connection, so the budget check and the payment it approves line up. */
function serial<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  let chain: Promise<unknown> = Promise.resolve();
  return (...args: A): Promise<R> => {
    const next = chain.then(() => fn(...args));
    chain = next.catch(() => undefined);
    return next;
  };
}

export async function connectReceipts(opts: ConnectOptions): Promise<ReceiptsConnection> {
  const url = new URL('/mcp', opts.apiUrl);
  const network = (opts.network ?? 'eip155:84532') as `${string}:${string}`;
  const budget = usdcToBase(opts.maxSpendUsdc ?? 0.05);
  const payments: Payment[] = [];
  let spent = 0n;

  if (!opts.privateKey) {
    const client = new Client({ name: 'receipts-demo-agent', version: '0.1.0' });
    await client.connect(new StreamableHTTPClientTransport(url));
    return {
      paying: false,
      wallet: null,
      network,
      payments,
      spentUsdc: () => '0',
      listTools: async () => (await client.listTools()).tools as McpToolInfo[],
      call: serial(async (name: string, args: Record<string, unknown>) => {
        const res = await client.callTool({ name, arguments: args });
        return { text: textOf(res.content), isError: Boolean(res.isError), paid: null };
      }),
      close: () => client.close(),
    };
  }

  const account = privateKeyToAccount(opts.privateKey);
  let approved = 0n;
  const client = createx402MCPClient({
    name: 'receipts-demo-agent',
    version: '0.1.0',
    schemes: [{ network, client: new ExactEvmScheme(account) }],
    spendControls: { maxAmountPerPayment: `$${opts.maxPerCallUsdc ?? 0.01}` },
    autoPayment: true,
    onPaymentRequested: ({ paymentRequired }) => {
      const accept = paymentRequired.accepts.find((a) => a.network === network);
      if (!accept) return false;
      const amount = BigInt(accept.amount);
      if (spent + amount > budget) return false;
      approved = amount;
      return true;
    },
  });
  await client.connect(new StreamableHTTPClientTransport(url));

  return {
    paying: true,
    wallet: account.address,
    network,
    payments,
    spentUsdc: () => baseToUsdc(spent),
    listTools: async () => (await client.listTools()).tools as McpToolInfo[],
    call: serial(async (name: string, args: Record<string, unknown>) => {
      approved = 0n;
      try {
        const res = await client.callTool(name, args);
        // paymentMade only means a payment was sent; it counts as spent once the server reports it settled.
        if (res.paymentMade && !res.paymentResponse?.success) {
          const reason = refusal(textOf(res.content), account.address, network);
          return { text: JSON.stringify({ error: `payment refused, no data returned: ${reason}` }), isError: true, paid: null, paymentError: reason };
        }
        let paid: Payment | null = null;
        if (res.paymentMade) {
          spent += approved;
          paid = {
            tool: name,
            amountUsdc: baseToUsdc(approved),
            network: res.paymentResponse?.network ?? network,
            tx: res.paymentResponse?.transaction ?? null,
            payer: account.address,
          };
          payments.push(paid);
          opts.onPayment?.(paid);
        }
        return { text: textOf(res.content), isError: Boolean(res.isError), paid };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { text: JSON.stringify({ error: `payment not made: ${message}` }), isError: true, paid: null, paymentError: message };
      }
    }),
    close: () => client.close(),
  };
}

export interface ReceiptsResult {
  agent: 'receipts';
  question: string;
  answer: string;
  /** the structured answer search_receipts returned, if it was called */
  receipts: Answer | null;
  top: AnswerOption | null;
  verified: Verified | null;
  payments: Payment[];
  spentUsdc: string;
  wallet: string | null;
  paying: boolean;
  steps: AgentStep[];
  generatedBy: 'llm' | 'scripted';
  model: string | null;
}

export interface Verified {
  reviewUid: string;
  allPass: boolean;
  /** checks that apply to this receipt (a simulated demo receipt has no proof or attestation to check) */
  applicable: number;
  passed: number;
}

function system(budgetUsdc: number) {
  return `You are a shopping assistant for people in India. You answer with Receipts: reviews from verified buyers, each backed by a proof of purchase, written by a verified unique human and anchored on Base.
- Call search_receipts with the user's question. It costs $0.005 in USDC; your budget for this question is $${budgetUsdc}.
- Before recommending, call verify_receipt (free) on one receipt cited by the option you pick, and say whether every check passed.
- Recommend one option: its trust score, how many verified buyers reviewed it, the price they actually paid, and two or three claims, each followed by its receipt link.
- If Receipts reports not enough receipts, say so plainly instead of guessing.
- End with one line saying reviewers are paid when agents cite them and pay never depends on the rating.`;
}

/** A readable reason for a refused payment; the server answers with the facilitator's error code. */
function refusal(text: string, wallet: string, network: string): string {
  const code = parseJson<{ error?: string }>(text)?.error ?? text.slice(0, 160);
  return /insufficient_(balance|funds)/i.test(code) ? `the agent wallet ${wallet} has too little USDC on ${network}` : code;
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function describe(option: AnswerOption, verified: Verified | null): string {
  const price = option.price_paid_inr ? ` Buyers paid ₹${option.price_paid_inr.min}${option.price_paid_inr.max !== option.price_paid_inr.min ? `–₹${option.price_paid_inr.max}` : ''}.` : '';
  const claims = option.claims
    .slice(0, 3)
    .map((c) => `- ${c.text} (${c.receipts[0] ?? 'receipt'})`)
    .join('\n');
  const check = !verified
    ? ''
    : !verified.allPass
      ? ' One cited receipt failed a check, so treat this with care.'
      : verified.applicable < 3
        ? ` I re-checked one of its receipts: ${verified.passed} of ${verified.applicable} applicable checks passed (a simulated demo receipt has no proof or attestation to check).`
        : ` I re-verified one of its receipts: all ${verified.passed} checks passed.`;
  return `${option.item} at ${option.merchant}: trust score ${option.score.toFixed(1)}/5 from ${option.verified_reviews} verified buyers.${price}${check}\n${claims}`;
}

export async function runReceiptsAgent(
  question: string,
  opts: ConnectOptions & { llm?: AgentLlm | null; onStep?: OnStep; connection?: ReceiptsConnection },
): Promise<ReceiptsResult> {
  const llm = opts.llm === undefined ? agentLlmFromEnv() : opts.llm;
  const { steps, push } = stepper(opts.onStep);
  const budgetUsdc = opts.maxSpendUsdc ?? 0.05;
  const conn =
    opts.connection ??
    (await connectReceipts({
      ...opts,
      onPayment: (p) => {
        push('payment', `paid $${p.amountUsdc} USDC for ${p.tool}`, p);
        opts.onPayment?.(p);
      },
    }));
  push('note', conn.paying ? `wallet ${conn.wallet} on ${conn.network}, budget $${budgetUsdc}` : 'no agent wallet: paid tools work only while the server runs x402 off');

  let receipts: Answer | null = null;
  let verified: ReceiptsResult['verified'] = null;
  let paymentError: string | null = null;
  const call = async (name: string, args: Record<string, unknown>) => {
    push('tool', `${name} ${JSON.stringify(args)}`);
    const out = await conn.call(name, args);
    if (opts.connection && out.paid) push('payment', `paid $${out.paid.amountUsdc} USDC for ${name}`, out.paid);
    if (out.paymentError) {
      paymentError = out.paymentError;
      push('error', `${name}: payment refused: ${out.paymentError}`);
    } else if (out.isError) push('error', `${name}: ${out.text.slice(0, 300)}`);
    if (name === 'search_receipts' && !out.isError) receipts = parseJson<Answer>(out.text) ?? receipts;
    if (name === 'verify_receipt' && !out.isError) {
      const v = parseJson<{ uid: string | null; id: string; allPass: boolean; checks: { check: string; pass: boolean | null }[] }>(out.text);
      if (v) {
        const applicable = v.checks.filter((c) => c.pass !== null);
        verified = { reviewUid: v.uid ?? v.id, allPass: v.allPass, applicable: applicable.length, passed: applicable.filter((c) => c.pass).length };
        push('verify', `${v.allPass ? 'all checks passed' : 'a check failed'}: ${v.checks.map((c) => `${c.check} ${c.pass === null ? '–' : c.pass ? '✓' : '✗'}`).join(', ')}`, v);
      }
    }
    return out;
  };

  let answer: string;
  let generatedBy: ReceiptsResult['generatedBy'] = 'scripted';
  try {
    if (llm) {
      generatedBy = 'llm';
      const tools: AgentTool[] = (await conn.listTools()).map((t) => ({
        name: t.name,
        description: t.description ?? t.name,
        inputSchema: { type: 'object', properties: t.inputSchema.properties ?? {}, required: t.inputSchema.required },
        run: async (input) => (await call(t.name, input)).text,
      }));
      answer = await llm.loop({ system: system(budgetUsdc), prompt: question, tools, maxIterations: 8 });
    } else {
      await call('search_receipts', { question });
      const found = receipts as Answer | null;
      const refused = paymentError as string | null;
      const top = found?.options[0] ?? null;
      const reviewId = top?.claims[0]?.review_ids[0];
      if (reviewId) await call('verify_receipt', { review_uid: reviewId });
      answer = !found
        ? refused
          ? `The payment did not go through (${refused}), so there is no answer.`
          : 'Receipts could not be reached or the payment did not go through.'
        : !top
          ? `${found.summary} Not enough receipts yet to recommend anything.`
          : `${describe(top, verified)}\n\n${found.disclosure}`;
    }
  } finally {
    if (!opts.connection) await conn.close().catch(() => undefined);
  }

  const final = receipts as Answer | null;
  push('answer', answer);
  return {
    agent: 'receipts',
    question,
    answer,
    receipts: final,
    top: final?.options[0] ?? null,
    verified,
    payments: conn.payments,
    spentUsdc: conn.spentUsdc(),
    wallet: conn.wallet,
    paying: conn.paying,
    steps,
    generatedBy,
    model: llm?.model ?? null,
  };
}
