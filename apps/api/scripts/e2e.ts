// End-to-end over HTTP against a running API (pnpm dev:api, then pnpm e2e). Uses a fresh throwaway wallet, the
// mock human (ALLOW_MOCK_IDENTITY) and the dev rail (ALLOW_SIMULATED_PROOFS), so it runs with an empty .env.
//   API_URL=http://localhost:8787 pnpm e2e
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { typedDataFromJson } from '@receipts/core';

const API = process.env.API_URL ?? 'http://localhost:8787';
const account = privateKeyToAccount(generatePrivateKey());
let token = '';

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : null) as T;
}

function step(name: string, detail = '') {
  console.log(`✓ ${name}${detail ? `  ${detail}` : ''}`);
}

const health = await call<{ chain: string; anchored: boolean; x402: boolean; llm: string }>('GET', '/health');
step('health', JSON.stringify(health));

const nonce = await call<{ nonce: string; issued: string; message: string }>('POST', '/v1/auth/nonce', { address: account.address });
const signed = await call<{ token: string }>('POST', '/v1/auth/verify', {
  address: account.address,
  nonce: nonce.nonce,
  issued: nonce.issued,
  signature: await account.signMessage({ message: nonce.message }),
});
token = signed.token;
step('wallet sign-in', account.address);

const human = await call<{ token: string; reviewerId: string }>('POST', '/v1/identity/mock');
token = human.token;
step('one human (mock, labelled)', human.reviewerId.slice(0, 12));

const purchase = await call<{ id: string; tier: string; items: { itemId: string; name: string }[] }>('POST', '/v1/proofs/simulated', {
  merchantName: 'E2E Test Kitchen (demo)',
  cityId: 'goa',
  lat: 15.5442,
  lng: 73.7551,
  category: 'food',
  items: [{ name: 'Veg Dum Biryani', priceMinor: 29000 }],
});
step('proof (dev rail, simulated)', `${purchase.id} tier ${purchase.tier}`);

const draft = await call<{ draftId: string }>('POST', '/v1/reviews', { purchaseId: purchase.id });
const card = await call<{ rating: number; item: { name: string } | null; claims: string[] }>('POST', `/v1/reviews/${draft.draftId}/text`, {
  text: 'The veg dum biryani was excellent and not oily. Portion fed two people. Arrived hot. 5 stars.',
});
step('structured card', `${card.rating}★ ${card.item?.name} | ${card.claims.join(' / ')}`);

const fin = await call<{ signing: { kind: 'eas'; typedData: string } | { kind: 'message'; message: string }; contentCid: string }>('POST', `/v1/reviews/${draft.draftId}/finalize`, {});
const signature =
  fin.signing.kind === 'eas' ? await account.signTypedData(typedDataFromJson(fin.signing.typedData) as never) : await account.signMessage({ message: fin.signing.message });
const pub = await call<{ reviewId: string; uid: string | null; anchored: boolean; receiptUrl: string }>('POST', `/v1/reviews/${draft.draftId}/publish`, { signature });
step('published', `${pub.anchored ? 'anchored ' + pub.uid : 'not anchored'} -> ${pub.receiptUrl}`);

const receipt = await call<{ rating: number; purchase: { railLabel: string } }>('GET', `/v1/receipts/${pub.uid ?? pub.reviewId}`);
const verify = await call<{ allPass: boolean; checks: { check: string; pass: boolean | null }[] }>('GET', `/v1/receipts/${pub.uid ?? pub.reviewId}/verify`);
step('receipt + verify', `${receipt.purchase.railLabel}; ${verify.checks.map((c) => `${c.check}:${c.pass === null ? '-' : c.pass ? 'ok' : 'FAIL'}`).join(' ')}`);

token = '';
const ask = await call<{ summary: string; options: { merchant: string; item: string; score: number; claims: { text: string; receipts: string[] }[] }[]; generated_by: string }>(
  'POST',
  '/v1/ask',
  { q: 'best veg biryani under ₹400 near Calangute' },
);
step('human question', `${ask.generated_by}: ${ask.summary}`);
for (const o of ask.options) console.log(`    ${o.score} ${o.item} @ ${o.merchant} — ${o.claims.map((c) => c.text).join('; ')}`);

const agentRes = await fetch(`${API}/v1/answer?q=${encodeURIComponent('quietest hotel near Calangute for remote work')}`);
if (agentRes.status === 402) step('agent endpoint', '402 Payment Required (x402 on): pay with the demo agent');
else {
  const a = (await agentRes.json()) as { options: { item: string; merchant: string }[] };
  step('agent endpoint (x402 off, free)', a.options.map((o) => `${o.item} @ ${o.merchant}`).join(' | '));
}

const mcp = new Client({ name: 'receipts-e2e', version: '0.1.0' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${API}/mcp`)));
const tools = await mcp.listTools();
step('MCP tools', tools.tools.map((t) => t.name).join(', '));
const cov = await mcp.callTool({ name: 'coverage', arguments: { area: 'Calangute' } });
step('MCP coverage (free)', JSON.stringify(cov.content).slice(0, 120));
const search = await mcp.callTool({ name: 'search_receipts', arguments: { question: 'best power bank under ₹1,500' } });
step('MCP search_receipts', search.isError ? `payment required: ${JSON.stringify(search.content).slice(0, 160)}` : JSON.stringify(search.content).slice(0, 200));
await mcp.close();

const attack = await call<{ before: { score: number }; after: { score: number }; naiveAverage: { before: number; after: number }; flags: { signal: string }[] }>(
  'POST',
  '/v1/admin/attack',
  {},
  process.env.ADMIN_TOKEN ? { 'x-admin-token': process.env.ADMIN_TOKEN } : {},
);
step(
  'attack (simulated)',
  `trust score ${attack.before.score?.toFixed(2)} -> ${attack.after.score?.toFixed(2)}; naive average ${attack.naiveAverage.before} -> ${attack.naiveAverage.after}; flags ${attack.flags.map((f) => f.signal).join(', ')}`,
);
await call('POST', '/v1/admin/attack/reset', {}, process.env.ADMIN_TOKEN ? { 'x-admin-token': process.env.ADMIN_TOKEN } : {});

const stats = await call('GET', '/v1/stats');
step('stats', JSON.stringify(stats));
console.log('\nall steps passed');
