import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { GoogleGenAI, type Content } from '@google/genai';

// One small tool loop for both demo agents, so they run the same model with different tools. Claude through the
// SDK tool runner (same settings as the engine), Gemini with manual function calling, or any OpenAI-compatible
// endpoint (AI Grants India keys, OpenRouter, Groq) with function tools. Without a key the agents
// use their scripted paths, which make the same tool calls in a fixed order.

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  run(input: Record<string, unknown>): Promise<string>;
}

export interface LoopRequest {
  system: string;
  prompt: string;
  tools: AgentTool[];
  maxIterations?: number;
}

export interface AgentLlm {
  readonly provider: 'anthropic' | 'gemini' | 'openai-compat';
  readonly model: string;
  loop(req: LoopRequest): Promise<string>;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

class ClaudeLoop implements AgentLlm {
  readonly provider = 'anthropic' as const;
  private client: Anthropic;
  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async loop(req: LoopRequest): Promise<string> {
    const tools = req.tools.map((t) =>
      betaTool({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as never,
        run: (input: unknown) => t.run(input as Record<string, unknown>).catch((e: unknown) => `error: ${e instanceof Error ? e.message : String(e)}`),
      }),
    );
    const final = (await this.client.beta.messages.toolRunner({
      model: this.model,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: req.system,
      output_config: { effort: 'medium' },
      max_iterations: req.maxIterations ?? 8,
      tools,
      messages: [{ role: 'user', content: req.prompt }],
    } as never)) as Anthropic.Beta.BetaMessage;
    if (final.stop_reason === 'refusal') return 'The model declined to answer this question.';
    return final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }
}

class GeminiLoop implements AgentLlm {
  readonly provider = 'gemini' as const;
  private ai: GoogleGenAI;
  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  /** Gemini answers 503 (overloaded) or 429 (per-minute quota) under load; retry twice before giving up. */
  private async generate(params: Parameters<GoogleGenAI['models']['generateContent']>[0]) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.ai.models.generateContent(params);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A daily quota does not reset by waiting, so only per-minute limits and overload are retried.
        if (attempt >= 2 || /per day|PerDay/i.test(msg) || !/\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(msg)) throw err;
        // A per-minute quota error says how long to wait; honour it up to 30 seconds.
        const hinted = Number(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(msg)?.[1] ?? 0) * 1000;
        await new Promise((r) => setTimeout(r, Math.min(30_000, hinted || 1500 * (attempt + 1))));
      }
    }
  }

  async loop(req: LoopRequest): Promise<string> {
    const byName = new Map(req.tools.map((t) => [t.name, t]));
    const contents: Content[] = [{ role: 'user', parts: [{ text: req.prompt }] }];
    for (let i = 0; i < (req.maxIterations ?? 8); i++) {
      const res = await this.generate({
        model: this.model,
        contents,
        config: {
          systemInstruction: req.system,
          tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema })) }],
        },
      });
      const calls = res.functionCalls ?? [];
      if (calls.length === 0) return (res.text ?? '').trim();
      const modelTurn = res.candidates?.[0]?.content;
      if (modelTurn) contents.push(modelTurn);
      const parts = [];
      for (const call of calls) {
        const tool = call.name ? byName.get(call.name) : undefined;
        const output = tool
          ? await tool.run(call.args ?? {}).catch((e: unknown) => `error: ${e instanceof Error ? e.message : String(e)}`)
          : `error: unknown tool ${call.name}`;
        parts.push({ functionResponse: { id: call.id, name: call.name, response: { output } } });
      }
      contents.push({ role: 'user', parts });
    }
    // Out of steps: one last turn without tools, so the agent answers from what it has already read.
    contents.push({ role: 'user', parts: [{ text: 'You have used all your steps. Give your final answer now from what you have found.' }] });
    const last = await this.generate({ model: this.model, contents, config: { systemInstruction: req.system } });
    return (last.text ?? '').trim() || 'Stopped after the maximum number of steps without a final answer.';
  }
}

interface CompatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

class OpenAiCompatLoop implements AgentLlm {
  readonly provider = 'openai-compat' as const;
  constructor(
    readonly model: string,
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async loop(req: LoopRequest): Promise<string> {
    const byName = new Map(req.tools.map((t) => [t.name, t]));
    const tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    const messages: CompatMessage[] = [
      { role: 'system', content: req.system },
      { role: 'user', content: req.prompt },
    ];
    for (let i = 0; i < (req.maxIterations ?? 8); i++) {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, messages, tools, max_tokens: 4096 }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = (await res.json().catch(() => ({}))) as { choices?: { message?: CompatMessage }[]; error?: { message?: string } };
      if (!res.ok) throw new Error(`model endpoint returned ${res.status}: ${data.error?.message ?? 'no detail'}`);
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error('model endpoint returned no message');
      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) return (msg.content ?? '').trim();
      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
      for (const call of calls) {
        const tool = byName.get(call.function.name);
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          // malformed arguments become an empty input; the tool says what is missing
        }
        const output = tool
          ? await tool.run(input).catch((e: unknown) => `error: ${e instanceof Error ? e.message : String(e)}`)
          : `error: unknown tool ${call.function.name}`;
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
    }
    return 'Stopped after the maximum number of steps without a final answer.';
  }
}

/** The model both demo agents share. AGENT_LLM picks one when several keys are set. */
export function agentLlmFromEnv(env: Record<string, string | undefined> = process.env): AgentLlm | null {
  const want = env.AGENT_LLM ?? env.LLM_PROVIDER;
  if (env.ANTHROPIC_API_KEY && want !== 'gemini' && want !== 'openai-compat' && want !== 'offline') return new ClaudeLoop(env.ANTHROPIC_MODEL ?? 'claude-opus-5-5', env.ANTHROPIC_API_KEY);
  if (env.GEMINI_API_KEY && want !== 'offline' && want !== 'openai-compat') return new GeminiLoop(env.GEMINI_MODEL ?? 'gemini-3.6-flash', env.GEMINI_API_KEY);
  if (env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_API_KEY && env.OPENAI_COMPAT_MODEL && want !== 'offline') {
    return new OpenAiCompatLoop(env.OPENAI_COMPAT_MODEL, env.OPENAI_COMPAT_BASE_URL, env.OPENAI_COMPAT_API_KEY);
  }
  return null;
}
