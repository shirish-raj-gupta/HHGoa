export type Effort = 'low' | 'medium' | 'high';

export interface JsonRequest {
  system: string;
  prompt: string;
  /** JSON schema the response must satisfy (structured outputs). */
  schema: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  run(input: Record<string, unknown>): Promise<string>;
}

export interface AgentRequest {
  system: string;
  prompt: string;
  tools: AgentTool[];
  effort?: Effort;
  maxIterations?: number;
}

export interface AgentResult {
  text: string;
  toolCalls: { name: string; input: unknown; output: string }[];
}

export interface Llm {
  readonly provider: 'anthropic' | 'gemini' | 'openai-compat' | 'offline';
  readonly model: string | null;
  /** One structured answer. Throws LlmUnavailable when no provider is configured, so callers use their fallback. */
  json<T>(req: JsonRequest): Promise<T>;
  /** A tool-using agent loop. Only some providers support it; others throw LlmUnavailable. */
  agent(req: AgentRequest): Promise<AgentResult>;
}

export class LlmUnavailable extends Error {
  constructor(message = 'no LLM provider configured') {
    super(message);
    this.name = 'LlmUnavailable';
  }
}

export class LlmRefusal extends Error {
  constructor(readonly category: string | null) {
    super(`the model declined this request${category ? ` (${category})` : ''}`);
    this.name = 'LlmRefusal';
  }
}

export function parseJsonText<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  return JSON.parse(trimmed) as T;
}
