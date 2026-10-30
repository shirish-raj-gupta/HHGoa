import { createDb, migrate } from '@receipts/db';
import { seedAll } from '@receipts/db/seed';
import { ChainService } from './chain';
import { parseEnv } from './config';
import type { Engine } from './context';
import { deriveKey } from './crypto';
import { EventBus } from './events';
import { syncRegistry } from './identity';
import { createLlm } from './llm';
import { createLogger, type Logger } from './log';
import { Storage } from './storage';
import { runTrust } from './trust';

export * from './context';
export { parseEnv, type Env } from './config';
export { createLogger, type Logger } from './log';
export { signSession, verifySession, randomToken, sha256Hex, type SessionClaims } from './crypto';
export { ChainService, ChainError } from './chain';
export * as identity from './identity';
export * as proofs from './proofs';
export * as reviews from './reviews';
export * as followups from './followups';
export * as query from './query';
export * as trust from './trust';
export * as payouts from './payouts';
export * as shop from './shopthrough';
export * as merchants from './merchants';
export * as places from './places';
export * as cities from './cities';
export * as admin from './admin';
export { anchorPending } from './reviews';
export * as maps from './google';
export * as billing from './billing';
export * as speech from './speech';
export * as demo from './demo';
export * as notify from './notify';
export { investigate, decideFlag, type CaseFile } from './investigator';
export { syncGraph, TigerGraph } from './tigergraph';
export { createX402, paymentRef, payerOf, withinAgentCap, type X402 } from './x402';
export { JOBS, jobReporter, type Job } from './jobs';
export { LlmUnavailable, LlmRefusal } from './llm';
export type { AskPayment, AskInput } from './query';
export type { PurchaseView } from './proofs';
export type { ReviewCard, PublishResult } from './reviews';
export { buildAccepts, createReceiptsMcpServer } from './mcp/server';

export interface CreateEngineOptions {
  env?: Record<string, string | undefined>;
  log?: Logger;
  /** Apply migrations on start (default true). */
  migrate?: boolean;
  /** Upsert cities, categories and brands, and seed labelled demo history when DEMO_MODE (default true). */
  seed?: boolean;
}

export async function createEngine(opts: CreateEngineOptions = {}): Promise<Engine & { close(): Promise<void> }> {
  const env = parseEnv(opts.env ?? process.env);
  const log = opts.log ?? createLogger('receipts');
  const t0 = Date.now();
  const db = await createDb({ url: env.DATABASE_URL });
  if (opts.migrate !== false) await migrate(db, (m) => log.info(m));
  if (opts.seed !== false) await seedAll(db, { demoHistory: env.DEMO_MODE, log: (m) => log.info(m) });
  log.info(`database ready (${db.kind}) in ${Date.now() - t0}ms`);

  const chain = await ChainService.create(env, log.child('chain'));
  const llm = createLlm(env, log.child('llm'));
  const storage = new Storage(db, env, deriveKey(env.DATA_ENCRYPTION_KEY ?? env.SESSION_SECRET), log.child('storage'));
  const events = new EventBus(db);
  const engine: Engine = {
    env,
    db,
    log,
    chain,
    llm,
    storage,
    events,
    urls: { api: env.PUBLIC_API_URL, web: env.PUBLIC_WEB_URL, merchant: env.PUBLIC_MERCHANT_URL, demo: env.PUBLIC_DEMO_URL },
  };

  if (chain.mode === 'local') {
    const n = await syncRegistry(engine);
    if (n) log.info(`re-registered ${n} humans on the fresh local chain`);
  }
  const unscored = await db.maybe<{ n: string }>(`SELECT count(*)::text AS n FROM items WHERE score IS NULL AND verified_reviews = 0 AND EXISTS (SELECT 1 FROM reviews r WHERE r.item_id = items.id)`);
  if (Number(unscored?.n ?? 0) > 0) {
    const report = await runTrust(engine);
    log.info(`trust engine: scored ${report.items} items from ${report.reviews} reviews in ${report.ms}ms`);
  }
  return { ...engine, close: () => db.close() };
}
