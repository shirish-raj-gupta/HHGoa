// Set up a TigerGraph Savanna workspace for Receipts:  pnpm graph:setup
// Needs TIGERGRAPH_API_KEY (Savanna > Admin settings > API keys) in the root .env. Creates an in-database user for
// the API, loads schema.gsql and queries.gsql, installs the queries and creates a secret, then writes
// TIGERGRAPH_HOST and TIGERGRAPH_SECRET (and the user's password, commented) into .env. Safe to re-run: every step
// checks what already exists. Savanna creates the user without schema rights; the script says how to grant them.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const apiKey = process.env.TIGERGRAPH_API_KEY;
if (!apiKey) {
  console.error('Set TIGERGRAPH_API_KEY in .env (Savanna > Admin settings > API keys).');
  process.exit(1);
}
const USER = 'receipts_api';
const GRAPH = process.env.TIGERGRAPH_GRAPH ?? 'Receipts';

function setEnv(name: string, value: string, commented = false) {
  let s = readFileSync(envFile, 'utf8');
  const line = `${commented ? '# ' : ''}${name}=${value}`;
  const re = new RegExp(`^#? ?${name}=.*$`, 'm');
  if (re.test(s)) s = s.replace(re, line);
  else if (/^TIGERGRAPH_API_KEY=.*$/m.test(s)) s = s.replace(/^TIGERGRAPH_API_KEY=.*$/m, (m) => `${m}\n${line}`);
  else s += `\n${line}\n`;
  writeFileSync(envFile, s);
}

async function controlPlane<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.tgcloud.io/controller/v4/v2${path}`, { ...init, headers: { 'x-api-key': apiKey!, 'content-type': 'application/json' } });
  const body = (await res.json().catch(() => null)) as { Error?: boolean; Message?: string; Result?: T } | null;
  if (!res.ok || body?.Error) throw new Error(`Savanna ${path}: HTTP ${res.status} ${body?.Message ?? ''}`);
  return body!.Result as T;
}

// The workspace (the first one in the first workgroup).
type Workgroup = { workgroup_id: string; name: string; workspaces: { workspace_id: string; name: string; nginx_host: string; status: string }[] };
const group = (await controlPlane<Workgroup[]>('/workgroups'))[0];
const workspace = group?.workspaces[0];
if (!group || !workspace) {
  console.error('No Savanna workspace found: create one (the free tier is enough) and run this again.');
  process.exit(1);
}
const host = `https://${workspace.nginx_host}`;
console.log(`workspace ${group.name}/${workspace.name} (${workspace.status}) at ${host}`);
setEnv('TIGERGRAPH_HOST', host);

// An in-database user for the API. Its password lives only in .env (commented: only this script uses it).
const dbUsers = `/workgroups/${group.workgroup_id}/workspaces/${workspace.workspace_id}/dbuser`;
const existing = ((await controlPlane<{ username?: string }[] | null>(dbUsers)) ?? []).some((u) => u.username === USER);
let password = /^# ?TIGERGRAPH_DB_PASSWORD=(.+)$/m.exec(readFileSync(envFile, 'utf8'))?.[1];
if (!existing || !password) {
  password = `R${randomBytes(18).toString('base64url')}a9!`;
  await controlPlane(dbUsers, { method: existing ? 'PUT' : 'POST', body: JSON.stringify({ username: USER, password }) });
  setEnv('TIGERGRAPH_DB_USER', USER, true);
  setEnv('TIGERGRAPH_DB_PASSWORD', password, true);
  console.log(`${existing ? 'reset the password of' : 'created'} database user ${USER} (password saved in .env)`);
}
const basic = `Basic ${Buffer.from(`${USER}:${password}`).toString('base64')}`;

async function gsql(path: string, init: RequestInit = {}): Promise<{ status: number; text: string }> {
  const res = await fetch(`${host}${path}`, { ...init, headers: { authorization: basic, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(300_000) });
  return { status: res.status, text: await res.text() };
}
const statements = (text: string) => gsql('/gsql/v1/statements', { method: 'POST', body: text, headers: { 'content-type': 'text/plain' } });

// Schema and queries.
const graphs = await gsql('/gsql/v1/schema/graphs');
if (graphs.status === 403) {
  console.log(
    `\n${USER} has no schema rights yet. In Savanna, open the workspace's GSQL editor and run:\n\n` +
      `  GRANT ROLE globaldesigner TO ${USER}\n\nthen run pnpm graph:setup again. Continuing with the secret.\n`,
  );
} else {
  if (!graphs.text.includes(`"${GRAPH}"`)) {
    const r = await statements(readFileSync(join(here, 'schema.gsql'), 'utf8'));
    console.log(`schema: ${r.text.trim().split('\n').slice(-3).join(' | ')}`);
  }
  const shown = await statements(`USE GRAPH ${GRAPH}\nSHOW QUERY *`);
  if (!shown.text.includes('receipts_rings')) {
    const r = await statements(readFileSync(join(here, 'queries.gsql'), 'utf8'));
    console.log(`queries: ${r.text.trim().split('\n').slice(-3).join(' | ')}`);
  }
  const install = await gsql(`/gsql/v1/queries/install?graph=${GRAPH}&queries=all`);
  const requestId = (JSON.parse(install.text || '{}') as { requestId?: string }).requestId;
  if (!requestId) console.log(`install: HTTP ${install.status} ${install.text.slice(0, 200)}`);
  for (let i = 0; requestId && i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const s = await gsql(`/gsql/v1/queries/install/${requestId}`);
    if (!/running|progress|wait/i.test(s.text)) {
      console.log(`install: ${s.text.slice(0, 200)}`);
      break;
    }
  }
}

// A secret for the API, which exchanges it for tokens (packages/engine/src/tigergraph.ts).
if (!process.env.TIGERGRAPH_SECRET) {
  const r = await gsql(`/gsql/v1/secrets?alias=receipts_api_${Date.now().toString(36)}`, { method: 'POST', headers: { 'content-type': 'application/json' } });
  const value = (JSON.parse(r.text || '{}') as { results?: { value?: string } }).results?.value;
  if (!value) throw new Error(`creating the secret failed: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  setEnv('TIGERGRAPH_SECRET', value);
  process.env.TIGERGRAPH_SECRET = value;
  console.log('created a secret for the API (TIGERGRAPH_SECRET in .env)');
}

// The API's own path: secret -> token -> REST++.
const tokenRes = await fetch(`${host}/gsql/v1/tokens`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: process.env.TIGERGRAPH_SECRET, lifetime: '86400' }) });
const token = ((await tokenRes.json().catch(() => ({}))) as { token?: string }).token;
console.log(`token from the secret: ${token ? 'ok' : `failed (HTTP ${tokenRes.status})`}`);
if (token) {
  const read = await fetch(`${host}/restpp/graph/${GRAPH}/vertices/Reviewer?limit=1`, { headers: { authorization: `Bearer ${token}` } });
  console.log(`REST++ read of ${GRAPH}: HTTP ${read.status} ${(await read.text()).slice(0, 160)}`);
}
