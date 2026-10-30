import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/migrations.generated';
import { createDb, migrate, type Db } from '../src';
import { seedAll } from '../src/seed';

let db: Db;

beforeAll(async () => {
  db = await createDb({ url: 'pglite:memory' });
  await migrate(db, () => {});
  await seedAll(db, { log: () => {} });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe('migrations', () => {
  it('embeds every migration file as it is (run pnpm --filter @receipts/db migrations:gen after changing one)', () => {
    const dir = fileURLToPath(new URL('../migrations', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    expect(MIGRATIONS.map((m) => m.name)).toEqual(files);
    for (const m of MIGRATIONS) expect(m.sql, m.name).toBe(readFileSync(join(dir, m.name), 'utf8').replace(/\r\n/g, '\n'));
  });
});

describe('schema and seeds', () => {
  it('creates the 22 plan tables', async () => {
    const plan = [
      'reviewers', 'brands', 'brand_rails', 'merchants', 'items', 'purchases', 'reviews', 'followups', 'answers', 'citations',
      'ledger', 'epochs', 'payout_methods', 'affiliate_clicks', 'affiliate_conversions', 'merchant_accounts', 'merchant_receipts',
      'cities', 'categories', 'properties', 'credentials', 'flags',
    ];
    const rows = await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    const names = new Set(rows.map((r) => r.table_name));
    for (const t of plan) expect(names, t).toContain(t);
  });

  it('seeds cities, categories, brands and labelled simulated history', async () => {
    expect(Number((await db.one('SELECT count(*) AS n FROM cities')).n)).toBe(4);
    expect(Number((await db.one('SELECT count(*) AS n FROM categories')).n)).toBe(8);
    expect(Number((await db.one(`SELECT count(*) AS n FROM reviews WHERE simulated`)).n)).toBeGreaterThan(100);
    expect(Number((await db.one(`SELECT count(*) AS n FROM reviews WHERE NOT simulated`)).n)).toBe(0);
    const fake = await db.query(`SELECT name FROM merchants WHERE simulated AND name NOT LIKE '%(demo)'`);
    expect(fake).toHaveLength(0);
  });

  it('finds biryani near Calangute with PostGIS and pgvector', async () => {
    const rows = await db.query(
      `SELECT i.canonical_name, m.name,
              ST_Distance(m.geom, ST_SetSRID(ST_MakePoint(73.7554, 15.5439), 4326)::geography) AS meters,
              1 - (i.embedding <=> (SELECT embedding FROM items WHERE canonical_name = 'Veg Dum Biryani' LIMIT 1)) AS sim
         FROM items i JOIN merchants m ON m.id = i.merchant_id
        WHERE ST_DWithin(m.geom, ST_SetSRID(ST_MakePoint(73.7554, 15.5439), 4326)::geography, 5000)
        ORDER BY sim DESC LIMIT 3`,
    );
    expect(rows[0]!.canonical_name).toMatch(/biryani/i);
    expect(Number(rows[0]!.meters)).toBeLessThan(5000);
  });

  it('enforces one review per purchase and the same-day block', async () => {
    const p = await db.one(`SELECT * FROM purchases LIMIT 1`);
    await expect(
      db.query(
        `INSERT INTO purchases (id, purchase_nullifier, reviewer_id, wallet, rail, tier, brand_id, merchant_id, amount_minor, currency, purchased_on, proof_hash, status)
         VALUES ('dup', $1, NULL, $2, 'order_page', 'A', 'demo', $3, 1, 'INR', '2026-10-01', '0x', 'confirmed')`,
        [p.purchase_nullifier, p.wallet, p.merchant_id],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `INSERT INTO purchases (id, purchase_nullifier, reviewer_id, wallet, rail, tier, brand_id, merchant_id, amount_minor, currency, purchased_on, proof_hash, status)
         VALUES ('dup2', 'other-nullifier', $1, $2, 'payment_proof', 'B', 'demo', $3, $4, 'INR', $5, '0x', 'confirmed')`,
        [p.reviewer_id, p.wallet, p.merchant_id, p.amount_minor, p.purchased_on],
      ),
    ).rejects.toThrow();
  });
});
