// Embed migrations/*.sql in src/migrations.generated.ts:  pnpm --filter @receipts/db migrations:gen
// A serverless function (the API on Vercel) is a bundle, not the repo, so it cannot read the folder at run time.
// Run after adding or editing a migration; the db tests fail while the embedded copy is out of date.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = fileURLToPath(new URL('../migrations', import.meta.url));
const out = fileURLToPath(new URL('../src/migrations.generated.ts', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
// Line endings normalised, so the output is the same on Windows and Linux checkouts.
const readSql = (name: string) => readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n');
const entries = files.map((name) => `  { name: ${JSON.stringify(name)}, sql: ${JSON.stringify(readSql(name))} },`);
writeFileSync(
  out,
  `// Generated from packages/db/migrations/*.sql by \`pnpm --filter @receipts/db migrations:gen\`. Do not edit: change the
// .sql file and run that. Embedded so the API can migrate from inside a serverless bundle.

export const MIGRATIONS: { name: string; sql: string }[] = [
${entries.join('\n')}
];
`,
);
console.log(`embedded ${files.length} migrations in src/migrations.generated.ts`);
