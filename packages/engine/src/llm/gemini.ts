import { GoogleGenAI, type Content, type Part } from '@google/genai';
import type { AgentRequest, AgentResult, JsonRequest, Llm } from './types';
import { parseJsonText } from './types';

// Gemini for structured answers (structuring reviews, parsing questions, writing cited answers) and for the
// investigator's tool loop (function calling).

export class GeminiLlm implements Llm {
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

  async json<T>(req: JsonRequest): Promise<T> {
    const res = await this.generate({
      model: this.model,
      contents: req.prompt,
      config: {
        systemInstruction: req.system,
        responseMimeType: 'application/json',
        responseJsonSchema: req.schema,
        maxOutputTokens: req.maxTokens ?? 8192,
      },
    });
    const text = res.text;
    if (!text) throw new Error('Gemini returned no text');
    return parseJsonText<T>(text);
  }

  async agent(req: AgentRequest): Promise<AgentResult> {
    const byName = new Map(req.tools.map((t) => [t.name, t]));
    const toolCalls: AgentResult['toolCalls'] = [];
    const contents: Content[] = [{ role: 'user', parts: [{ text: req.prompt }] }];
    for (let i = 0; i < (req.maxIterations ?? 10); i++) {
      const res = await this.generate({
        model: this.model,
        contents,
        config: {
          systemInstruction: req.system,
          tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema })) }],
        },
      });
      const calls = res.functionCalls ?? [];
      if (calls.length === 0) return { text: (res.text ?? '').trim(), toolCalls };
      const modelTurn = res.candidates?.[0]?.content;
      if (modelTurn) contents.push(modelTurn);
      const parts: Part[] = [];
      for (const call of calls) {
        const tool = call.name ? byName.get(call.name) : undefined;
        const input = call.args ?? {};
        const output = tool
          ? await tool.run(input).catch((e: unknown) => `error: ${e instanceof Error ? e.message : String(e)}`)
          : `error: unknown tool ${call.name}`;
        toolCalls.push({ name: call.name ?? '', input, output });
        parts.push({ functionResponse: { id: call.id, name: call.name, response: { output } } });
      }
      contents.push({ role: 'user', parts });
    }
    return { text: 'Stopped after the maximum number of steps without a final answer.', toolCalls };
  }
}
