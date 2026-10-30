import type { Env } from '../config';
import type { Logger } from '../log';
import { AnthropicLlm } from './anthropic';
import { GeminiLlm } from './gemini';
import { OpenAiCompatLlm } from './openai-compat';
import { LlmUnavailable, type AgentRequest, type AgentResult, type JsonRequest, type Llm } from './types';

export * from './types';

class OfflineLlm implements Llm {
  readonly provider = 'offline' as const;
  readonly model = null;
  async json<T>(_req: JsonRequest): Promise<T> {
    throw new LlmUnavailable();
  }
  async agent(_req: AgentRequest): Promise<AgentResult> {
    throw new LlmUnavailable();
  }
}

export function createLlm(env: Env, log: Logger): Llm {
  if (env.LLM_PROVIDER === 'anthropic') {
    log.info(`LLM: Anthropic ${env.ANTHROPIC_MODEL}`);
    return new AnthropicLlm(env.ANTHROPIC_MODEL, env.ANTHROPIC_API_KEY);
  }
  if (env.LLM_PROVIDER === 'gemini' && env.GEMINI_API_KEY) {
    log.info(`LLM: Gemini ${env.GEMINI_MODEL}`);
    return new GeminiLlm(env.GEMINI_MODEL, env.GEMINI_API_KEY);
  }
  if (env.LLM_PROVIDER === 'openai-compat' && env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_API_KEY && env.OPENAI_COMPAT_MODEL) {
    log.info(`LLM: ${env.OPENAI_COMPAT_MODEL} at ${env.OPENAI_COMPAT_BASE_URL} (OpenAI-compatible)`);
    return new OpenAiCompatLlm(env.OPENAI_COMPAT_MODEL, env.OPENAI_COMPAT_BASE_URL, env.OPENAI_COMPAT_API_KEY);
  }
  log.warn('LLM: none configured; using rule-based structuring and extractive answers (labelled "extractive")');
  return new OfflineLlm();
}
