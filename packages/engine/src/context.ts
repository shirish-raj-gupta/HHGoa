import type { Db } from '@receipts/db';
import type { ChainService } from './chain';
import type { Env } from './config';
import type { EventBus } from './events';
import type { Llm } from './llm';
import type { Logger } from './log';
import type { Storage } from './storage';

/** Everything a service needs. Created once per process by createEngine(). */
export interface Engine {
  env: Env;
  db: Db;
  log: Logger;
  chain: ChainService;
  llm: Llm;
  storage: Storage;
  events: EventBus;
  urls: { api: string; web: string; merchant: string; demo: string };
}

/** An error the API maps to a 4xx with a human-readable message. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 402 | 403 | 404 | 409 | 413 | 422 | 429 | 502 | 503 = 400,
    readonly code = 'bad_request',
  ) {
    super(message);
    this.name = 'UserError';
  }
}

export function receiptUrl(e: Engine, idOrUid: string): string {
  return `${e.urls.web}/r/${idOrUid}`;
}
