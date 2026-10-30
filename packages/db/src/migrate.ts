import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Db } from './client';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/** Apply migrations/*.sql in order, each in its own transaction. Idempotent. */
export async function migrate(db: Db, log: (m: string) => void = console.log): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM _migrations')).map((r) => r.name));
  const done: string[] = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
    });
    log(`migrated ${file}`);
    done.push(file);
  }
  return done;
}

/** Drop everything (local dev only). */
export async function resetDatabase(db: Db): Promise<void> {
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}
