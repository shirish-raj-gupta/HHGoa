// Run a command with the root .env loaded, for tools that only read the environment (pnpm security:scan).
//   node scripts/with-env.mjs <command> [args...]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/with-env.mjs <command> [args...]');
  process.exit(1);
}
const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
