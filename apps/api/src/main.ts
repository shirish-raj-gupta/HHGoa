import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Cron } from 'croner';
import { JOBS, createEngine, createLogger, createX402, jobReporter } from '@receipts/engine';
import { createApp } from './app';

// ENV_FILE points the API at another settings file instead of the root .env (the browser tests use e2e/test.env).
const envFiles = process.env.ENV_FILE ? [process.env.ENV_FILE] : ['../../../.env.local', '../../../.env'].map((f) => fileURLToPath(new URL(f, import.meta.url)));
for (const p of envFiles) {
  if (existsSync(p)) process.loadEnvFile(p);
}

const log = createLogger('api');
const engine = await createEngine({ log });
const x402 = await createX402(engine);
const app = await createApp(engine, x402);
const port = engine.env.PORT;

serve({ fetch: app.fetch, port }, () => {
  log.info(`Receipts API on ${engine.urls.api} (port ${port}) | chain ${engine.chain.mode}${engine.chain.enabled ? ' (anchoring)' : ''} | x402 ${x402 ? 'on' : 'off'} | LLM ${engine.llm.provider}`);
  log.info(`MCP: ${engine.urls.api}/mcp   paid HTTP: ${engine.urls.api}/v1/answer?q=...`);
});

// In development the worker jobs run inside the API process (PGlite has one owner). In production run apps/worker.
if (engine.env.RUN_WORKER_IN_PROCESS) {
  const jobLog = log.child('jobs');
  const report = jobReporter(jobLog);
  for (const job of JOBS) {
    if (job.name === 'epoch' && !engine.chain.canOperate) continue;
    new Cron(job.cron, { timezone: 'Asia/Kolkata', protect: true, catch: (err) => report.failed(job.name, err) }, async () => {
      await job.run(engine);
      report.ok(job.name);
    });
  }
  jobLog.info(`${JOBS.length} jobs scheduled in-process`);
}

const shutdown = async () => {
  log.info('shutting down');
  await engine.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
