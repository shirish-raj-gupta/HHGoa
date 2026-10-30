// Smoke test: spawn the stdio server against an in-memory database, list tools, run one free and one paid tool.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', new URL('../src/stdio.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')],
  env: { ...process.env, DATABASE_URL: 'pglite:memory', CHAIN: 'off', NODE_ENV: 'development' } as Record<string, string>,
  stderr: 'inherit',
});
const client = new Client({ name: 'smoke', version: '0.0.1' });
await client.connect(transport);
const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));
const cov = await client.callTool({ name: 'coverage', arguments: { area: 'Calangute' } });
console.log('coverage:', JSON.stringify(cov.content).slice(0, 160));
const s = await client.callTool({ name: 'search_receipts', arguments: { question: 'best veg biryani under ₹400 near Calangute' } });
const text = (s.content as { text: string }[])[0]!.text;
const a = JSON.parse(text);
console.log('search:', a.summary, '|', a.options.map((o: { item: string; merchant: string; score: number }) => `${o.score.toFixed(2)} ${o.item} @ ${o.merchant}`).join(' | '), '| payment', a.payment?.method);
await client.close();
