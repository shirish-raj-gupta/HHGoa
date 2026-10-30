import type { AgentRequest, AgentResult, JsonRequest, Llm } from './types';
import { parseJsonText } from './types';

// Any OpenAI-compatible chat completions endpoint: free model keys from AI Grants India, OpenRouter, Groq, or a
// local server. Plain fetch, no SDK. Structured answers ask for a JSON schema and fall back to JSON mode on
// endpoints that do not support schemas; agent loops use function tools.

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface ChatResponse {
  choices?: { message?: ChatMessage; finish_reason?: string }[];
  error?: { message?: string };
}

export class OpenAiCompatLlm implements Llm {
  readonly provider = 'openai-compat' as const;

  constructor(
    readonly model: string,
    private baseUrl: string,
    private apiKey: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async chat(body: Record<string, unknown>): Promise<{ status: number; data: ChatResponse }> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, ...body }),
      signal: AbortSignal.timeout(120_000),
    });
    const data = (await res.json().catch(() => ({}))) as ChatResponse;
    return { status: res.status, data };
  }

  async json<T>(req: JsonRequest): Promise<T> {
    const messages = [
      { role: 'system', content: req.system },
      { role: 'user', content: req.prompt },
    ];
    let r = await this.chat({
      messages,
      max_tokens: req.maxTokens ?? 8192,
      response_format: { type: 'json_schema', json_schema: { name: 'result', schema: req.schema } },
    });
    if (r.status === 400 || r.status === 422) {
      // No schema support: ask for plain JSON mode and put the schema in the instructions.
      r = await this.chat({
        messages: [{ role: 'system', content: `${req.system}\n\nReply with one JSON object that matches this JSON schema:\n${JSON.stringify(req.schema)}` }, messages[1]],
        max_tokens: req.maxTokens ?? 8192,
        response_format: { type: 'json_object' },
      });
    }
    if (r.status >= 400) throw new Error(`model endpoint returned ${r.status}: ${r.data.error?.message ?? 'no detail'}`);
    const text = r.data.choices?.[0]?.message?.content;
    if (!text) throw new Error('model endpoint returned no text');
    return parseJsonText<T>(text);
  }

  async agent(req: AgentRequest): Promise<AgentResult> {
    const toolCalls: AgentResult['toolCalls'] = [];
    const byName = new Map(req.tools.map((t) => [t.name, t]));
    const tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    const messages: ChatMessage[] = [
      { role: 'system', content: req.system },
      { role: 'user', content: req.prompt },
    ];
    for (let i = 0; i < (req.maxIterations ?? 12); i++) {
      const r = await this.chat({ messages, tools, max_tokens: 8192 });
      if (r.status >= 400) throw new Error(`model endpoint returned ${r.status}: ${r.data.error?.message ?? 'no detail'}`);
      const msg = r.data.choices?.[0]?.message;
      if (!msg) throw new Error('model endpoint returned no message');
      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) return { text: (msg.content ?? '').trim(), toolCalls };
      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
      for (const call of calls) {
        const tool = byName.get(call.function.name);
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          // a malformed argument string is passed through as an empty input; the tool reports what is missing
        }
        const output = tool
          ? await tool.run(input).catch((e: unknown) => `error: ${e instanceof Error ? e.message : String(e)}`)
          : `error: unknown tool ${call.function.name}`;
        toolCalls.push({ name: call.function.name, input, output });
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
    }
    return { text: 'Stopped after the maximum number of steps without a final answer.', toolCalls };
  }
}
