import { Hono } from 'hono';
import { createEngine, createLogger, createX402 } from '@receipts/engine';
import { createApp } from './app';

// The API as a Vercel function (vercel.json, service "api"). Settings come from the project's environment, not .env.
// The engine starts on an instance's first request (migrations and seeding are idempotent, so every cold start may run
// them); there is no listening server and no in-process timer: Vercel Cron calls /v1/cron/:minutes instead.
// Local development keeps src/main.ts.

type App = Awaited<ReturnType<typeof createApp>>;
let started: Promise<App> | null = null;

function start(): Promise<App> {
  return (async () => {
    const engine = await createEngine({ log: createLogger('api') });
    return createApp(engine, await createX402(engine));
  })();
}

const app = new Hono();
app.all('*', async (c) => {
  // A failed start (the database not answering, say) is retried on the next request instead of being kept.
  started ??= start().catch((err: unknown) => {
    started = null;
    throw err;
  });
  return (await started).fetch(c.req.raw);
});

export default app;
