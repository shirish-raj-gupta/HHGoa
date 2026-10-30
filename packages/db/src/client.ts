import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { DebugLevel } from '@electric-sql/pglite';

// One small interface over node-postgres (production: Neon, Supabase, Railway with PostGIS + pgvector) and PGlite
// (local: Postgres in WASM with the same extensions, zero setup). Raw SQL everywhere; no ORM.
//
// DATABASE_URL:
//   postgres://...        node-postgres pool
//   pglite:<dir>          PGlite persisted to <dir>
//   pglite:memory         PGlite in memory (tests)
//   unset                 PGlite at <repo>/.data/pglite

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export interface Db {
  kind: 'pg' | 'pglite';
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(text: string, params?: unknown[]): Promise<T>;
  maybe<T = Row>(text: string, params?: unknown[]): Promise<T | null>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

function wrap(kind: Db['kind'], q: Queryable, execFn: (sql: string) => Promise<void>, txFn: Db['tx'], closeFn: () => Promise<void>): Db {
  const db: Db = {
    kind,
    async query<T>(text: string, params: unknown[] = []) {
      const r = await q.query(text, params.map(normalizeParam));
      return r.rows as T[];
    },
    async one<T>(text: string, params?: unknown[]) {
      const rows = await db.query<T>(text, params);
      if (!rows[0]) throw new Error(`expected a row: ${text.slice(0, 80)}`);
      return rows[0];
    },
    async maybe<T>(text: string, params?: unknown[]) {
      const rows = await db.query<T>(text, params);
      return rows[0] ?? null;
    },
    exec: execFn,
    tx: txFn,
    close: closeFn,
  };
  return db;
}

class JsonParam {
  constructor(readonly value: unknown) {}
}

/**
 * Mark a parameter as JSON. Plain objects and arrays of objects are sent as JSON automatically; arrays of strings
 * or numbers are sent as Postgres arrays (text[], float8[]), so wrap them in json() when the column is jsonb.
 */
export function json(value: unknown): JsonParam {
  return new JsonParam(value);
}

/** bigints and plain objects need converting before they reach either driver. */
function normalizeParam(p: unknown): unknown {
  if (p instanceof JsonParam) return JSON.stringify(p.value);
  if (typeof p === 'bigint') return p.toString();
  if (p instanceof Uint8Array) return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
  if (p instanceof Date) return p;
  if (p !== null && typeof p === 'object' && !Array.isArray(p)) return JSON.stringify(p);
  if (Array.isArray(p) && p.some((x) => x !== null && typeof x === 'object')) return JSON.stringify(p);
  return p;
}

export function defaultDataDir(): string {
  return fileURLToPath(new URL('../../../.data/pglite', import.meta.url));
}

export async function createDb(opts: { url?: string | null } = {}): Promise<Db> {
  const url = opts.url ?? process.env.DATABASE_URL ?? '';
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return createPgDb(url);
  const dir = url.startsWith('pglite:') ? url.slice('pglite:'.length) : defaultDataDir();
  return createPgliteDb(dir === 'memory' ? null : dir);
}

async function createPgDb(url: string): Promise<Db> {
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
  const make = (client: Queryable, inTx: boolean): Db =>
    wrap(
      'pg',
      client,
      async (sql) => {
        await client.query(sql);
      },
      inTx
        ? async (fn) => fn(make(client, true))
        : async (fn) => {
            const c = await pool.connect();
            try {
              await c.query('BEGIN');
              const r = await fn(make(c, true));
              await c.query('COMMIT');
              return r;
            } catch (e) {
              await c.query('ROLLBACK');
              throw e;
            } finally {
              c.release();
            }
          },
      async () => {
        if (!inTx) await pool.end();
      },
    );
  return make(pool, false);
}

async function createPgliteDb(dir: string | null): Promise<Db> {
  const [{ PGlite, types }, { postgis }, { vector }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite-postgis'),
    import('@electric-sql/pglite-pgvector'),
  ]);
  if (dir) mkdirSync(dir, { recursive: true });
  const unlock = dir ? await lockDataDir(dir) : () => {};
  // int8 and numeric come back as strings, the same as node-postgres. PGLITE_DEBUG=1 prints Postgres's own log.
  const pglite = new PGlite({
    ...(dir ? { dataDir: dir } : {}),
    extensions: { postgis, vector },
    parsers: { [types.INT8]: (v: string) => v, [types.NUMERIC]: (v: string) => v },
    debug: Number(process.env.PGLITE_DEBUG ?? 0) as DebugLevel,
  });
  try {
    await pglite.waitReady;
  } catch (e) {
    unlock();
    if (!dir) throw e;
    // Otherwise Node prints the line of minified WASM glue it failed in, which tells nobody anything.
    throw new Error(
      `PGlite could not open the database at ${dir} (${e instanceof Error ? e.message : String(e)}). Its files are damaged, ` +
        'usually because two processes wrote to it at once. Move the folder aside to start a fresh one (the API migrates ' +
        'and seeds it on start); PGLITE_DEBUG=1 shows why Postgres stopped.',
      { cause: e },
    );
  }
  const make = (q: Queryable & { exec(sql: string): Promise<unknown> }, inTx: boolean): Db =>
    wrap(
      'pglite',
      q,
      async (sql) => {
        await q.exec(sql);
      },
      inTx ? async (fn) => fn(make(q, true)) : async (fn) => pglite.transaction(async (t) => fn(make(t as never, true))),
      async () => {
        if (inTx) return;
        await pglite.close();
        unlock();
      },
    );
  return make(pglite as never, false);
}

/**
 * PGlite has no lock between processes, and two processes writing one data directory overwrite each other's WAL until
 * Postgres will not start ("could not locate a valid checkpoint record"). So the process that opens a directory keeps
 * its pid in `<dir>.lock` until it closes it; another one waits a few seconds (an API restarting under tsx watch) and
 * then stops with a message. A lock left by a process that is gone is taken over.
 */
async function lockDataDir(dir: string): Promise<() => void> {
  const file = `${resolve(dir)}.lock`;
  for (let attempt = 1; ; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const holder = runningPid(file);
    if (holder === null || holder === process.pid) rmSync(file, { force: true });
    else if (attempt > 40) {
      throw new Error(
        `The database at ${dir} is open in another process (pid ${holder}), and PGlite allows one process per database. ` +
          `Stop that process first (in development the API owns it), or delete ${file} if pid ${holder} is not one of ours.`,
      );
    } else await sleep(250);
  }
  let held = true;
  const unlock = () => {
    if (!held) return;
    held = false;
    process.off('exit', unlock);
    rmSync(file, { force: true });
  };
  process.on('exit', unlock);
  return unlock;
}

/** The pid in a lock file while that process is still running, else null. */
function runningPid(file: string): number | null {
  let pid: number;
  try {
    pid = Number(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM' ? pid : null;
  }
}

/** Accept the string/number/bigint any driver returns for a bigint column. */
export function toBigInt(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string' && v !== '') return BigInt(v.split('.')[0]!);
  return 0n;
}
