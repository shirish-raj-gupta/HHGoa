// pnpm db:migrate | db:seed | db:reset   (reads DATABASE_URL from the root .env; PGlite at .data/pglite when unset)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from './client';
import { migrate, resetDatabase } from './migrate';
import { seedAll } from './seed';

for (const f of ['../../../.env.local', '../../../.env']) {
  const p = fileURLToPath(new URL(f, import.meta.url));
  if (existsSync(p)) process.loadEnvFile(p);
}

const cmd = process.argv[2] ?? 'migrate';
const db = await createDb();
try {
  if (cmd === 'reset') {
    if (db.kind === 'pg' && process.env.NODE_ENV === 'production') throw new Error('refusing to reset a production database');
    await resetDatabase(db);
    console.log('dropped everything');
  }
  await migrate(db);
  if (cmd === 'seed' || cmd === 'reset') {
    await seedAll(db, { demoHistory: process.env.SEED_DEMO_HISTORY !== 'false' });
  }
} finally {
  await db.close();
}
