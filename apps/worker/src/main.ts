import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Cron } from 'croner';
import { JOBS, createEngine, createLogger, jobReporter } from '@receipts/engine';

// The production worker: every job from the engine on its cron schedule, against Postgres. Each job reads its due
// work from the database, so a restart loses nothing.
//   pnpm --filter @receipts/worker start            run on schedule
//   pnpm --filter @receipts/worker once [job ...]   run jobs once and exit (all jobs when none are named)

for (const f of ['../../../.env.local', '../../../.env']) {
  const p = fileURLToPath(new URL(f, import.meta.url));
  if (existsSync(p)) process.loadEnvFile(p);
}

const args = process.argv.slice(2);
const once = args.includes('--once');
const only = args.filter((a) => !a.startsWith('--'));
const log = createLogger('worker');

const url = process.env.DATABASE_URL ?? '';
if (!once && !url.startsWith('postgres')) {
  log.error(
    'The long-running worker needs Postgres (DATABASE_URL=postgres://...). PGlite has a single owner: in development the API runs these jobs in-process (RUN_WORKER_IN_PROCESS). Use --once with the API stopped to run jobs against PGlite.',
  );
  process.exit(1);
}

const engine = await createEngine({ log, seed: false });
const unknown = only.filter((n) => !JOBS.some((j) => j.name === n));
if (unknown.length) {
  log.error(`unknown job(s): ${unknown.join(', ')}. Jobs: ${JOBS.map((j) => j.name).join(', ')}`);
  process.exit(1);
}
const jobs = JOBS.filter((j) => (only.length ? only.includes(j.name) : true)).filter((j) => j.name !== 'epoch' || engine.chain.canOperate || only.includes('epoch'));

if (once) {
  let failed = 0;
  for (const job of jobs) {
    const t0 = Date.now();
    try {
      const result = await job.run(engine);
      log.info(`${job.name} done in ${Date.now() - t0}ms`, result ?? '');
    } catch (err) {
      failed++;
      log.error(`${job.name} failed`, err);
    }
  }
  await engine.close();
  process.exit(failed ? 1 : 0);
}

const report = jobReporter(log);
for (const job of jobs) {
  new Cron(job.cron, { timezone: 'Asia/Kolkata', protect: true, catch: (err) => report.failed(job.name, err) }, async () => {
    await job.run(engine);
    report.ok(job.name);
  });
}
log.info(`worker running ${jobs.length} jobs: ${jobs.map((j) => `${j.name} (${j.cron})`).join(', ')}`);

const shutdown = async () => {
  log.info('shutting down');
  await engine.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
