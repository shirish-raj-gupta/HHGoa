// Validates configs/*.yaml against CategoryConfig and writes src/configs.generated.ts.
// Run after editing a YAML file: pnpm categories:gen
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { CategoryConfig } from '@receipts/core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'configs');
const configs = readdirSync(dir)
  .filter((f) => f.endsWith('.yaml'))
  .sort()
  .map((f) => {
    const parsed = CategoryConfig.safeParse(parse(readFileSync(join(dir, f), 'utf8')));
    if (!parsed.success) {
      console.error(`${f}:`, parsed.error.issues);
      process.exit(1);
    }
    if (`${parsed.data.category}.yaml` !== f) throw new Error(`${f}: category must match the file name`);
    return parsed.data;
  });

const out = `// Generated from configs/*.yaml by scripts/gen.ts. Do not edit by hand.
import type { CategoryConfig } from '@receipts/core';

export const CATEGORY_CONFIGS: CategoryConfig[] = ${JSON.stringify(configs, null, 2)};
`;
writeFileSync(join(root, 'src', 'configs.generated.ts'), out);
console.log(`wrote ${configs.length} categories: ${configs.map((c) => c.category).join(', ')}`);
