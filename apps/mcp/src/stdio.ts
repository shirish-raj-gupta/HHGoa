#!/usr/bin/env -S npx tsx
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createEngine, createReceiptsMcpServer, type Logger } from '@receipts/engine';

// Receipts MCP over stdio, backed by the engine in this process (for Claude Code, Claude Desktop and other local
// MCP clients). stdio clients cannot pay, so paid tools answer free here and are logged as "free": point this at
// your own development database, never at production. To pay real USDC from a local client, use the bridge
// (src/bridge.ts), which forwards to the hosted HTTP endpoint over x402.
//
//   claude mcp add receipts -- pnpm --dir <repo>/apps/mcp stdio

// stdout carries JSON-RPC; everything else goes to stderr.
console.log = console.error;
console.info = console.error;

for (const f of ['../../../.env.local', '../../../.env']) {
  const p = fileURLToPath(new URL(f, import.meta.url));
  if (existsSync(p)) process.loadEnvFile(p);
}

function stderrLogger(scope: string): Logger {
  const line = (level: string, msg: string, data?: unknown) =>
    process.stderr.write(`${level} [${scope}] ${msg}${data === undefined ? '' : ` ${data instanceof Error ? data.message : JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`}\n`);
  return {
    info: (m, d) => line('info', m, d),
    warn: (m, d) => line('warn', m, d),
    error: (m, d) => line('error', m, d),
    child: (s) => stderrLogger(`${scope}:${s}`),
  };
}

const log = stderrLogger('mcp-stdio');
const engine = await createEngine({ log });
const server = createReceiptsMcpServer(engine, null, null);
await server.connect(new StdioServerTransport());
log.info(`Receipts MCP on stdio (database ${engine.db.kind}, paid tools free in this mode)`);

const shutdown = async () => {
  await server.close().catch(() => undefined);
  await engine.close().catch(() => undefined);
  process.exit(0);
};
process.stdin.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
