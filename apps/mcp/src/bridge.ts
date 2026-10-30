import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { connectReceipts } from '@receipts/agent';
import type { Hex } from 'viem';

// A local stdio MCP server that forwards every call to the hosted Receipts MCP endpoint and pays for paid tools in
// USDC over x402 from your agent wallet. For MCP clients that cannot pay by themselves. The low-level Server is
// used because the tool list and its JSON schemas arrive from the remote at runtime.
//
//   RECEIPTS_API_URL=https://api.example AGENT_PRIVATE_KEY=0x... AGENT_BUDGET_USDC=0.10 pnpm --dir apps/mcp bridge
//
// The budget covers the whole bridge session; each payment is also capped (AGENT_MAX_PER_CALL_USDC, default $0.01).

console.log = console.error;
for (const f of ['../../../.env.local', '../../../.env']) {
  const p = fileURLToPath(new URL(f, import.meta.url));
  if (existsSync(p)) process.loadEnvFile(p);
}

const apiUrl = process.env.RECEIPTS_API_URL ?? process.env.PUBLIC_API_URL ?? 'http://localhost:8787';
const conn = await connectReceipts({
  apiUrl,
  privateKey: (process.env.AGENT_PRIVATE_KEY as Hex | undefined) ?? null,
  network: process.env.AGENT_NETWORK ?? process.env.X402_NETWORK ?? 'eip155:84532',
  maxSpendUsdc: Number(process.env.AGENT_BUDGET_USDC ?? '0.10'),
  maxPerCallUsdc: Number(process.env.AGENT_MAX_PER_CALL_USDC ?? '0.01'),
  onPayment: (p) => process.stderr.write(`paid $${p.amountUsdc} for ${p.tool}${p.tx ? ` tx ${p.tx}` : ''}\n`),
});

const server = new Server({ name: 'receipts-bridge', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await conn.listTools() }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const out = await conn.call(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
  const note = out.paid ? `\n\n(paid $${out.paid.amountUsdc} USDC on ${out.paid.network}${out.paid.tx ? `, tx ${out.paid.tx}` : ''}; session total $${conn.spentUsdc()})` : '';
  return { content: [{ type: 'text', text: out.text + note }], isError: out.isError };
});

await server.connect(new StdioServerTransport());
process.stderr.write(
  `Receipts bridge -> ${apiUrl}/mcp | ${conn.paying ? `paying from ${conn.wallet} on ${conn.network}` : 'no AGENT_PRIVATE_KEY: paid tools work only if the server runs x402 off'}\n`,
);

const shutdown = async () => {
  await conn.close().catch(() => undefined);
  process.exit(0);
};
process.stdin.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
