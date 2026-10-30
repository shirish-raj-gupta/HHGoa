import type { Engine } from './context';

// TigerGraph over REST++ (Savanna free tier or Community Edition in Docker). A Savanna instance may stop after an
// hour idle: wake it well before the demo slot. Everything here is best effort; local detection in graph.ts never
// depends on it.

// Savanna pauses a workspace after an idle hour; with its auto start off, every call then answers "Failed to start
// workspace". Say so plainly and leave it alone for a while instead of knocking every five minutes.
const PAUSED = /Auto start is not enabled|Failed to start workspace/i;
const PAUSED_MESSAGE =
  'the TigerGraph workspace is paused (Savanna pauses it after an idle hour and its auto start is off): run pnpm graph:wake or resume it in the Savanna console. Local fraud checks keep running without it.';
const PAUSE_BACKOFF_MS = 15 * 60_000;
let pausedUntil = 0;

export class TigerGraph {
  private token: string | null;
  private tokenAt = 0;

  constructor(
    private host: string,
    private graph: string,
    private secret?: string,
    token?: string,
  ) {
    this.token = token ?? null;
    this.host = host.replace(/\/$/, '');
  }

  static fromEnv(e: Engine): TigerGraph | null {
    const { TIGERGRAPH_HOST, TIGERGRAPH_GRAPH, TIGERGRAPH_SECRET, TIGERGRAPH_TOKEN } = e.env;
    if (!TIGERGRAPH_HOST || (!TIGERGRAPH_SECRET && !TIGERGRAPH_TOKEN)) return null;
    return new TigerGraph(TIGERGRAPH_HOST.startsWith('http') ? TIGERGRAPH_HOST : `https://${TIGERGRAPH_HOST}`, TIGERGRAPH_GRAPH, TIGERGRAPH_SECRET, TIGERGRAPH_TOKEN);
  }

  private async auth(): Promise<string> {
    if (this.token && (!this.secret || Date.now() - this.tokenAt < 20 * 3_600_000)) return this.token;
    if (!this.secret) throw new Error('TigerGraph token expired and no secret to refresh it');
    if (Date.now() < pausedUntil) throw new Error(PAUSED_MESSAGE);
    for (const [url, body] of [
      [`${this.host}/gsql/v1/tokens`, { secret: this.secret, lifetime: '86400' }],
      [`${this.host}/restpp/requesttoken`, { secret: this.secret, lifetime: '86400' }],
    ] as const) {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
      if (!res) continue;
      if (!res.ok) {
        if (PAUSED.test(await res.text().catch(() => ''))) {
          pausedUntil = Date.now() + PAUSE_BACKOFF_MS;
          throw new Error(PAUSED_MESSAGE);
        }
        continue;
      }
      const data = (await res.json()) as { token?: string; results?: { token?: string } };
      const token = data.token ?? data.results?.token;
      if (token) {
        this.token = token;
        this.tokenAt = Date.now();
        return token;
      }
    }
    throw new Error('could not get a TigerGraph token (is the instance awake?)');
  }

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await this.auth();
    const res = await fetch(`${this.host}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`TigerGraph ${path} ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  upsert(payload: { vertices?: Record<string, unknown>; edges?: Record<string, unknown> }) {
    return this.call(`/restpp/graph/${this.graph}`, { method: 'POST', body: JSON.stringify(payload) });
  }

  runQuery(name: string, params: Record<string, string | number | string[]> = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) qs.append(k, String(x));
    return this.call(`/restpp/query/${this.graph}/${name}?${qs.toString()}`);
  }

  /** Ad-hoc read-only GSQL for the investigator (interpreted, no install needed). */
  interpret(gsql: string) {
    if (!/^\s*INTERPRET\s+QUERY/i.test(gsql) || /\b(DELETE|INSERT|UPDATE|DROP|CREATE\s+VERTEX|CREATE\s+EDGE)\b/i.test(gsql)) {
      throw new Error('only read-only INTERPRET QUERY statements are allowed');
    }
    return this.call(`/gsql/v1/queries/interpret?graph=${encodeURIComponent(this.graph)}`, { method: 'POST', body: gsql, headers: { 'content-type': 'text/plain' } });
  }
}

/** Mirror reviewers, reviews, items, merchants, wallets and the co-review graph into TigerGraph. */
export async function syncGraph(e: Engine): Promise<{ vertices: number; edges: number } | null> {
  const tg = TigerGraph.fromEnv(e);
  if (!tg) return null;
  const reviewers = await e.db.query<{ id: string; reliability: number; level: number; simulated: boolean; wallet: string }>('SELECT id, reliability, level, simulated, wallet FROM reviewers');
  const reviews = await e.db.query<{ id: string; reviewer_id: string; item_id: string; rating: number; created_at: Date; rail: string; tier: string }>(
    `SELECT id, reviewer_id, item_id, rating, created_at, rail, tier FROM reviews WHERE status IN ('active', 'held')`,
  );
  const items = await e.db.query<{ id: string; canonical_name: string; category_id: string; merchant_id: string }>('SELECT id, canonical_name, category_id, merchant_id FROM items');
  const merchants = await e.db.query<{ id: string; name: string; city_id: string | null }>('SELECT id, name, city_id FROM merchants WHERE id IN (SELECT merchant_id FROM items)');
  const funding = await e.db.query<{ from_wallet: string; to_wallet: string; tx_hash: string }>('SELECT from_wallet, to_wallet, tx_hash FROM wallet_funding');
  const co = await e.db.query<{ a: string; b: string; shared: string; jaccard: number }>(
    `WITH pairs AS (
       SELECT a.reviewer_id AS a, b.reviewer_id AS b, count(DISTINCT a.item_id) AS shared
         FROM reviews a JOIN reviews b ON a.item_id = b.item_id AND a.reviewer_id < b.reviewer_id
          AND abs(extract(epoch FROM a.created_at - b.created_at)) <= 14 * 86400
        WHERE a.status = 'active' AND b.status = 'active' GROUP BY 1, 2),
     counts AS (SELECT reviewer_id, count(DISTINCT item_id) AS n FROM reviews WHERE status = 'active' GROUP BY 1)
     SELECT p.a, p.b, p.shared::text, p.shared::float8 / (ca.n + cb.n - p.shared) AS jaccard
       FROM pairs p JOIN counts ca ON ca.reviewer_id = p.a JOIN counts cb ON cb.reviewer_id = p.b`,
  );
  const v = (attrs: Record<string, unknown>) => Object.fromEntries(Object.entries(attrs).map(([k, x]) => [k, { value: x }]));
  const vertices = {
    Reviewer: Object.fromEntries(reviewers.map((r) => [r.id, v({ reliability: r.reliability, level: r.level, simulated: r.simulated })])),
    Review: Object.fromEntries(reviews.map((r) => [r.id, v({ rating: r.rating, created_at: new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' '), rail: r.rail, tier: r.tier })])),
    Item: Object.fromEntries(items.map((i) => [i.id, v({ name: i.canonical_name, category: i.category_id })])),
    Merchant: Object.fromEntries(merchants.map((m) => [m.id, v({ name: m.name })])),
    Wallet: Object.fromEntries([...new Set([...reviewers.map((r) => r.wallet), ...funding.flatMap((f) => [f.from_wallet, f.to_wallet])])].map((w) => [w.toLowerCase(), {}])),
    Area: Object.fromEntries([...new Set(merchants.map((m) => m.city_id).filter(Boolean))].map((c) => [c!, v({ name: c })])),
  };
  const edges: Record<string, Record<string, Record<string, Record<string, Record<string, unknown>>>>> = { Reviewer: {}, Review: {}, Item: {}, Wallet: {}, Merchant: {} };
  const add = (fromType: string, from: string, edge: string, toType: string, to: string, attrs: Record<string, unknown> = {}) => {
    const byFrom = (edges[fromType]![from] ??= {});
    const byEdge = (byFrom[edge] ??= {});
    (byEdge[toType] ??= {})[to] = v(attrs);
  };
  for (const r of reviews) {
    add('Reviewer', r.reviewer_id, 'WROTE', 'Review', r.id);
    add('Review', r.id, 'ABOUT', 'Item', r.item_id);
  }
  for (const i of items) add('Item', i.id, 'SOLD_BY', 'Merchant', i.merchant_id);
  for (const r of reviewers) add('Reviewer', r.id, 'PAID_TO', 'Wallet', r.wallet.toLowerCase());
  for (const f of funding) add('Wallet', f.to_wallet.toLowerCase(), 'FUNDED_BY', 'Wallet', f.from_wallet.toLowerCase(), { tx: f.tx_hash });
  for (const c of co) add('Reviewer', c.a, 'CO_REVIEWED', 'Reviewer', c.b, { shared: Number(c.shared), jaccard: Math.round(Number(c.jaccard) * 1000) / 1000 });
  for (const m of merchants) if (m.city_id) add('Merchant', m.id, 'IN_AREA', 'Area', m.city_id);
  await tg.upsert({ vertices, edges });
  const edgeCount = reviews.length * 2 + items.length + reviewers.length + funding.length + co.length;
  return { vertices: reviewers.length + reviews.length + items.length + merchants.length, edges: edgeCount };
}
