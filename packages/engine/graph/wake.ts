// Wake the TigerGraph Savanna workspace, for example before a demo:  pnpm graph:wake
// Savanna pauses a workspace after an idle hour and, with its auto start off, keeps it paused until it is resumed here
// or in the Savanna console. Uses TIGERGRAPH_API_KEY from the root .env (the key pnpm graph:setup uses), resumes the
// workspace TIGERGRAPH_HOST points at, and waits until it is running. Resuming uses the workspace's compute hours.
import { existsSync } from 'node:fs';
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

async function controlPlane<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.tgcloud.io/controller/v4/v2${path}`, { ...init, headers: { 'x-api-key': apiKey!, 'content-type': 'application/json' } });
  const body = (await res.json().catch(() => null)) as { Error?: boolean; Message?: string; Result?: T } | null;
  if (!res.ok || body?.Error) throw new Error(`Savanna ${path}: HTTP ${res.status} ${body?.Message ?? ''}`);
  return body!.Result as T;
}

type Workspace = { workspace_id: string; name: string; nginx_host: string; display_status?: string; condition_type?: string; enable_auto_start?: boolean };
type Workgroup = { workgroup_id: string; name: string; workspaces: Workspace[] };

const UP = /running|ready|active|healthy/i;

// The workspace TIGERGRAPH_HOST points at, else the first one (as pnpm graph:setup picks).
async function find(): Promise<{ group: Workgroup; ws: Workspace }> {
  const groups = await controlPlane<Workgroup[]>('/workgroups');
  const host = (process.env.TIGERGRAPH_HOST ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  for (const group of groups) for (const ws of group.workspaces) if (host && ws.nginx_host === host) return { group, ws };
  const group = groups[0];
  const ws = group?.workspaces[0];
  if (!group || !ws) {
    console.error('No Savanna workspace found: create one and run pnpm graph:setup.');
    process.exit(1);
  }
  return { group, ws };
}

const status = (ws: Workspace) => ws.display_status || ws.condition_type || 'unknown';

let { group, ws } = await find();
console.log(`workspace ${group.name}/${ws.name}: ${status(ws)}${ws.enable_auto_start ? '' : ' (auto start off)'}`);
if (UP.test(status(ws))) {
  console.log('Already running.');
  process.exit(0);
}
await controlPlane(`/workgroups/${group.workgroup_id}/workspaces/${ws.workspace_id}/resume`, { method: 'POST' });
console.log('Resuming; this takes a few minutes.');
const until = Date.now() + 10 * 60_000;
while (Date.now() < until) {
  await new Promise((r) => setTimeout(r, 15_000));
  ({ group, ws } = await find());
  console.log(`  ${status(ws)}`);
  if (UP.test(status(ws))) {
    console.log('Running. The API picks it up at its next graph sync (within 15 minutes); restart the API to sync at once.');
    process.exit(0);
  }
}
console.error('Still not running after 10 minutes: look at the workspace in the Savanna console.');
process.exit(1);
