import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ChainError, LlmRefusal, UserError, billing, type Engine, type X402 } from '@receipts/engine';
import { body, ok, rateLimit, sessionMiddleware, type Env } from './http';
import { adminRoutes } from './routes/admin';
import { agentRoutes } from './routes/agent';
import { authRoutes } from './routes/auth';
import { merchantRoutes } from './routes/merchant';
import { publicRoutes } from './routes/public';
import { reviewerRoutes } from './routes/reviewer';
import { webhookRoutes } from './routes/webhooks';

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export async function createApp(e: Engine, x402: X402 | null) {
  const app = new Hono<Env>();
  // Origins, not URLs: the business app is a path (/business) on the reviewer site's origin.
  const origins = [e.urls.web, e.urls.merchant, e.urls.demo, e.env.PUBLIC_ADMIN_URL, ...(e.env.CORS_ORIGINS?.split(',').map((s) => s.trim()) ?? [])].map(originOf);

  app.use(
    '*',
    cors({
      origin: (origin) => (!origin || origins.includes(origin) || (!e.env.production && /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.)/.test(origin)) ? origin : null),
      allowHeaders: ['content-type', 'authorization', 'payment-signature', 'x-payment', 'x-admin-token', 'mcp-session-id', 'mcp-protocol-version'],
      exposeHeaders: ['payment-required', 'payment-response', 'x-payment-response', 'mcp-session-id'],
      credentials: true,
    }),
  );
  app.use('*', sessionMiddleware(e));

  app.onError((err, c) => {
    if (err instanceof UserError) return c.json({ error: err.message, code: err.code }, err.status);
    if (err instanceof ChainError) {
      e.log.warn('chain error', err.message);
      return c.json({ error: `On-chain step failed: ${err.message}`, code: 'chain' }, 502);
    }
    if (err instanceof LlmRefusal) return c.json({ error: err.message, code: 'llm_refusal' }, 422);
    if (rpcUnreachable(err)) {
      e.log.warn(`${c.req.method} ${c.req.path}: Base RPC unreachable after retries and fallbacks`, err.message.split('\n')[0]);
      return c.json({ error: 'The Base network did not answer just now. Nothing was lost: try again in a moment.', code: 'chain_unavailable' }, 503);
    }
    e.log.error(`${c.req.method} ${c.req.path}`, err);
    return c.json({ error: e.env.production ? 'Something went wrong.' : err.message, code: 'internal' }, 500);
  });

  app.get('/', (c) => c.text('Receipts API. Agents: MCP at /mcp, x402 at /v1/answer. Humans: https://github.com/ (see README).'));
  app.get('/health', (c) => ok(c, { ok: true, chain: e.chain.mode, anchored: e.chain.enabled, x402: !!x402, llm: e.llm.provider, db: e.db.kind }));

  app.route('/v1/auth', authRoutes(e));
  // Before the public routes: their GET /v1/merchants/:id would otherwise answer /v1/merchants/mine and /search.
  app.route('/v1/merchants', merchantRoutes(e));
  app.route('/', publicRoutes(e, x402));
  app.route('/', webhookRoutes(e));
  app.route('/', await agentRoutes(e, x402));
  app.route('/v1', reviewerRoutes(e));
  app.route('/v1/admin', adminRoutes(e));

  // Card customers: API keys and credits (Dodo).
  app.post('/v1/billing/api-keys', rateLimit('api-keys', 5), async (c) => ok(c, await billing.createApiKey(e, await body<{ email?: string; label?: string }>(c))));
  app.post('/v1/billing/credits/checkout', rateLimit('checkout', 10), async (c) => {
    const b = await body<{ apiKey: string; email: string; name?: string; dollars: number }>(c);
    const key = await billing.apiKeyFromHeader(e, `Bearer ${b.apiKey}`);
    if (!key) throw new UserError('Unknown API key.', 404);
    return ok(c, await billing.creditsCheckout(e, { apiKeyId: key.id, email: b.email, name: b.name, dollars: b.dollars }));
  });
  app.get('/v1/billing/credits', async (c) => {
    const key = await billing.apiKeyFromHeader(e, c.req.header('authorization'));
    if (!key) throw new UserError('Send your API key as a Bearer token.', 401);
    return ok(c, { credits_usdc: (Number(key.credits_usdc) / 1e6).toFixed(6) });
  });

  return app;
}

/** A Base RPC that could not be reached (viem's HttpRequestError, TimeoutError or a dropped connection), even when
 *  wrapped in a contract-call error: the person should try again, not read the request dump. */
function rpcUnreachable(err: Error): boolean {
  const names = new Set(['HttpRequestError', 'TimeoutError', 'WebSocketRequestError']);
  for (let cur: unknown = err, depth = 0; cur instanceof Error && depth < 6; cur = cur.cause, depth++) {
    if (names.has(cur.name) || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(cur.message.split('\n')[0] ?? '')) return true;
  }
  return false;
}
