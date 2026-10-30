import type { Db } from './client';
import { MIGRATIONS } from './migrations.generated';

/** Apply the migrations (migrations/*.sql, embedded by `pnpm --filter @receipts/db migrations:gen`) in order, each in its
 *  own transaction. Idempotent: the API runs this on every start, a serverless cold start included. */
export async function migrate(db: Db, log: (m: string) => void = console.log): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM _migrations')).map((r) => r.name));
  const done: string[] = [];
  for (const { name, sql } of MIGRATIONS) {
    if (applied.has(name)) continue;
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query('INSERT INTO _migrations (name) VALUES ($1)', [name]);
    });
    log(`migrated ${name}`);
    done.push(name);
  }
  return done;
}

/** Drop everything (local dev only). */
export async function resetDatabase(db: Db): Promise<void> {
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}
