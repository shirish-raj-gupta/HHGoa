import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenAiCompatLlm } from '../src/llm/openai-compat';

// The OpenAI-compatible model provider (AI Grants India keys, OpenRouter, Groq), checked against a local stand-in.

function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => resolve(s ? (JSON.parse(s) as Record<string, unknown>) : {}));
  });
}

let server: Server;
let base = '';
let schemaSupported = true;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const b = await body(req);
    if (req.headers.authorization !== 'Bearer test-key') return void res.writeHead(401).end('{}');
    const format = (b.response_format as { type?: string } | undefined)?.type;
    if (format === 'json_schema' && !schemaSupported) return void res.writeHead(400).end(JSON.stringify({ error: { message: 'response_format json_schema unsupported' } }));
    const messages = b.messages as { role: string; content: string | null }[];
    const reply = (message: Record<string, unknown>) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message }] }));
    if (format) return reply({ role: 'assistant', content: JSON.stringify({ rating: 4, via: format }) });
    // Tool loop: ask for the tool once, then answer with what it returned.
    const toolResult = messages.find((m) => m.role === 'tool');
    if (!toolResult) return reply({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"q":"biryani"}' } }] });
    return reply({ role: 'assistant', content: `found ${toolResult.content}` });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('OpenAI-compatible provider', () => {
  const schema = { type: 'object', properties: { rating: { type: 'number' } }, required: ['rating'] };

  it('returns structured JSON with a schema', async () => {
    const llm = new OpenAiCompatLlm('test-model', `${base}/v1`, 'test-key');
    expect(await llm.json<{ rating: number; via: string }>({ system: 's', prompt: 'p', schema })).toEqual({ rating: 4, via: 'json_schema' });
  });

  it('falls back to JSON mode where schemas are unsupported', async () => {
    schemaSupported = false;
    const llm = new OpenAiCompatLlm('test-model', `${base}/v1/`, 'test-key');
    expect(await llm.json<{ rating: number; via: string }>({ system: 's', prompt: 'p', schema })).toEqual({ rating: 4, via: 'json_object' });
    schemaSupported = true;
  });

  it('runs a tool loop', async () => {
    const llm = new OpenAiCompatLlm('test-model', `${base}/v1`, 'test-key');
    const result = await llm.agent({
      system: 's',
      prompt: 'p',
      tools: [{ name: 'lookup', description: 'find', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, run: async (i) => `result for ${String(i.q)}` }],
    });
    expect(result.text).toBe('found result for biryani');
    expect(result.toolCalls).toEqual([{ name: 'lookup', input: { q: 'biryani' }, output: 'result for biryani' }]);
  });

  it('reports a bad key', async () => {
    const llm = new OpenAiCompatLlm('test-model', `${base}/v1`, 'wrong');
    await expect(llm.json({ system: 's', prompt: 'p', schema })).rejects.toThrow(/401/);
  });
});
