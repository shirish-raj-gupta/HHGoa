import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import type { AgentRequest, AgentResult, JsonRequest, Llm } from './types';
import { LlmRefusal, parseJsonText } from './types';

// Claude via the official SDK. Structured outputs (output_config.format) for single answers, the SDK tool runner
// for agent loops. Requests opt into server-side refusal fallbacks ("default" routes by refusal category), and
// every response's stop_reason is checked before its content is read.

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class AnthropicLlm implements Llm {
  readonly provider = 'anthropic' as const;
  private client: Anthropic;

  constructor(
    readonly model: string,
    apiKey?: string,
  ) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async json<T>(req: JsonRequest): Promise<T> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: req.system,
      output_config: {
        effort: req.effort ?? 'low',
        format: { type: 'json_schema', schema: req.schema },
      },
      messages: [{ role: 'user', content: req.prompt }],
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
    if (response.stop_reason === 'refusal') {
      throw new LlmRefusal((response as { stop_details?: { category?: string | null } }).stop_details?.category ?? null);
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return parseJsonText<T>(text);
  }

  async agent(req: AgentRequest): Promise<AgentResult> {
    const toolCalls: AgentResult['toolCalls'] = [];
    const tools = req.tools.map((t) =>
      betaTool({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as never,
        run: async (input: unknown) => {
          const output = await t.run(input as Record<string, unknown>).catch((e: unknown) => `error: ${e instanceof Error ? e.message : String(e)}`);
          toolCalls.push({ name: t.name, input, output });
          return output;
        },
      }),
    );
    const final = await this.client.beta.messages.toolRunner({
      model: this.model,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: req.system,
      output_config: { effort: req.effort ?? 'high' },
      max_iterations: req.maxIterations ?? 12,
      tools,
      messages: [{ role: 'user', content: req.prompt }],
    } as never);
    const message = final as Anthropic.Beta.BetaMessage;
    if (message.stop_reason === 'refusal') throw new LlmRefusal(null);
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return { text, toolCalls };
  }
}
