import type { Context, MiddlewareHandler } from 'hono';
import { UserError, verifySession, type AskPayment, type Engine, type SessionClaims } from '@receipts/engine';

export type Env = { Variables: { session: SessionClaims | null; payment: AskPayment | null } };

/** JSON that survives bigints. */
export function ok(c: Context, data: unknown, status = 200) {
  return c.body(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), status as never, { 'content-type': 'application/json; charset=utf-8' });
}

export function sessionMiddleware(e: Engine): MiddlewareHandler<Env> {
  return async (c, next) => {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ey') ? auth.slice(7) : null;
    c.set('session', token ? await verifySession(token, e.env.SESSION_SECRET) : null);
    c.set('payment', null);
    await next();
  };
}

/** Any signed-in wallet: the same session reviews and runs a business (the engine checks what the wallet owns). */
export function requireSession(c: Context<Env>): SessionClaims {
  const s = c.get('session');
  if (!s) throw new UserError('Sign in with your wallet first.', 401, 'unauthenticated');
  return s;
}

export function requireAdmin(e: Engine, c: Context): void {
  const token = c.req.header('x-admin-token') ?? c.req.query('admin');
  if (!e.env.ADMIN_TOKEN) {
    if (e.env.production) throw new UserError('Admin is disabled (no ADMIN_TOKEN).', 403);
    return; // local development: demo controls open
  }
  if (token !== e.env.ADMIN_TOKEN) throw new UserError('Admin token required.', 401, 'admin');
}

const buckets = new Map<string, { tokens: number; at: number }>();

/** A small in-memory token bucket per IP and route. */
export function rateLimit(name: string, perMinute: number): MiddlewareHandler {
  return async (c, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('cf-connecting-ip') ?? 'local';
    const key = `${name}|${ip}`;
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: perMinute, at: now };
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
    b.at = now;
    if (b.tokens < 1) return c.json({ error: 'Slow down a little.', code: 'rate_limited' }, 429);
    b.tokens -= 1;
    buckets.set(key, b);
    await next();
  };
}

export async function body<T = Record<string, unknown>>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new UserError('Send a JSON body.', 400, 'bad_json');
  }
}
