import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { BRANDS, reclaimProvider, resolveRailConfig } from '@receipts/brands';
import { CATEGORY_CONFIGS } from '@receipts/categories';
import { CITIES, PRICES_USDC, RAIL_INFO, chainInfo } from '@receipts/core';
import { UserError, cities, demo, maps, merchants, payouts, proofs, query, reviews, shop, type Engine, type X402 } from '@receipts/engine';
import { body, ok, rateLimit, type Env } from '../http';

export function publicRoutes(e: Engine, x402: X402 | null) {
  const app = new Hono<Env>();

  /** What the apps need to know about this server. */
  app.get('/v1/config', (c) => {
    const info = e.chain.chainId && e.chain.mode !== 'local' ? chainInfo(e.chain.chainId) : null;
    return ok(c, {
      chain: { mode: e.chain.mode, chainId: e.chain.chainId, anchored: e.chain.enabled, explorer: info?.explorer ?? null, easScan: info?.easScan ?? null, deployment: e.chain.deployment },
      x402: x402 ? { on: true, network: x402.network, payTo: x402.payTo, prices: PRICES_USDC } : { on: false, prices: PRICES_USDC },
      identity: {
        selfScope: e.env.SELF_SCOPE,
        selfEndpoint: e.env.SELF_ENDPOINT,
        selfStaging: e.env.SELF_MOCK_PASSPORT,
        anonAadhaarSeed: e.env.ANON_AADHAAR_NULLIFIER_SEED,
        anonAadhaarTest: e.env.ANON_AADHAAR_TEST_MODE,
        mockAllowed: e.env.ALLOW_MOCK_IDENTITY,
      },
      proofs: { reclaim: !!(e.env.RECLAIM_APP_ID && e.env.RECLAIM_APP_SECRET), simulatedAllowed: e.env.ALLOW_SIMULATED_PROOFS },
      places: { google: !!e.env.GOOGLE_MAPS_API_KEY },
      voice: { sarvam: !!e.env.SARVAM_API_KEY, model: e.env.SARVAM_MODEL },
      llm: { provider: e.llm.provider, model: e.llm.model },
      demoMode: e.env.DEMO_MODE,
      rails: RAIL_INFO,
      categories: CATEGORY_CONFIGS.map((x) => ({ id: x.category, name: x.name, rails: x.rails, aspects: x.aspects, itemNoun: x.item_noun, prompt: x.prompt })),
      cities: CITIES.map((x) => ({ id: x.city, name: x.name, center: x.center, status: x.status, localities: x.localities.map((l) => l[0]) })),
    });
  });

  app.get('/v1/brands', (c) =>
    ok(
      c,
      BRANDS.map((b) => ({
        id: b.id,
        name: b.name,
        group: b.group,
        categories: b.categories,
        defaultRail: b.defaultRail,
        rails: b.rails.map((r) => {
          // What this brand's Reclaim proof carries, from the provider registry; a custom provider (env) says less.
          const id = resolveRailConfig(r).providerId;
          const p = reclaimProvider(id);
          return { rail: r.rail, status: r.status, provider: id ? { proves: p?.proves ?? null, alsoShares: p?.alsoShares ?? null, community: p ? !p.verified : false, tier: p && r.rail === 'order_page' && !p.fields.items ? 'B' : null } : null };
        }),
      })),
    ),
  );
  app.get('/v1/brands/:id/rails', async (c) => ok(c, await e.db.query('SELECT rail, status, provider_id IS NOT NULL AS has_provider, blueprint, network, last_tested_at FROM brand_rails WHERE brand_id = $1', [c.req.param('id')])));

  app.get('/v1/receipts/:uid', async (c) => ok(c, await reviews.getReceipt(e, c.req.param('uid'))));
  app.get('/v1/receipts/:uid/verify', rateLimit('verify-receipt', 60), async (c) => ok(c, await reviews.verifyReceipt(e, c.req.param('uid'))));

  app.get('/v1/content/:cid', async (c) => {
    const content = await e.storage.get(c.req.param('cid'));
    if (!content || content.contentType === 'application/octet-stream') throw new UserError('not found', 404);
    return c.body(new Uint8Array(content.bytes), 200, { 'content-type': content.contentType, 'cache-control': 'public, max-age=31536000, immutable' });
  });

  /** Plain HTTPS answers for humans and auditors (the web app's search box). Free, rate-limited, labelled. */
  app.post('/v1/ask', rateLimit('ask', 20), async (c) => {
    const b = await body<{ q: string; category?: string; lat?: number; lng?: number }>(c);
    return ok(c, await query.answerQuestion(e, { query: b.q, category: b.category ?? null, lat: b.lat ?? null, lng: b.lng ?? null }, { method: 'free', amountBase: 0n, tool: 'web' }));
  });

  app.get('/v1/coverage', async (c) => ok(c, await query.coverage(e, { area: c.req.query('area'), brand: c.req.query('brand') })));
  app.get('/v1/items/:id', async (c) => ok(c, await query.itemReputation(e, c.req.param('id'))));
  app.get('/v1/merchants/:id', async (c) => ok(c, await query.merchantReputation(e, c.req.param('id'))));
  app.get('/v1/merchants/:id/badge', async (c) => ok(c, await merchants.badge(e, c.req.param('id'))));

  app.get('/v1/places', async (c) => {
    const city = c.req.query('city') ?? null;
    const q = c.req.query('q') ?? '';
    return ok(
      c,
      await e.db.query(
        `SELECT m.id, m.name, m.city_id, m.category_id, m.score, m.verified_reviews, m.simulated, ST_Y(m.geom::geometry) AS lat, ST_X(m.geom::geometry) AS lng
           FROM merchants m WHERE ($1::text IS NULL OR m.city_id = $1) AND ($2 = '' OR m.name ILIKE '%' || $2 || '%') AND ($3::boolean OR NOT m.simulated)
          ORDER BY m.verified_reviews DESC, m.name LIMIT 100`,
        [city, q.replace(/[%_]/g, ''), e.env.DEMO_MODE],
      ),
    );
  });

  app.get('/v1/leaderboard', async (c) => ok(c, await payouts.leaderboard(e, Number(c.req.query('limit') ?? 20))));
  app.get('/v1/stats', async (c) => ok(c, await demo.stats(e)));

  app.get('/v1/events', async (c) => ok(c, await e.events.recent(Number(c.req.query('limit') ?? 50), Number(c.req.query('after') ?? 0))));
  app.get('/v1/events/stream', (c) =>
    streamSSE(c, async (stream) => {
      for (const ev of await e.events.recent(30)) await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev), id: String(ev.id) });
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      const off = e.events.subscribe((ev) => {
        queue.push(JSON.stringify(ev));
        wake?.();
      });
      stream.onAbort(off);
      while (!stream.aborted) {
        if (!queue.length) await Promise.race([new Promise<void>((r) => (wake = r)), stream.sleep(15_000)]);
        wake = null;
        while (queue.length) {
          const data = queue.shift()!;
          const ev = JSON.parse(data) as { type: string; id: number };
          await stream.writeSSE({ event: ev.type, data, id: String(ev.id) });
        }
        await stream.writeSSE({ event: 'ping', data: '{}' });
      }
      off();
    }),
  );

  /** A map around a place, drawn by Google with our key (which never reaches the browser). Our cities only. */
  app.get('/v1/maps/static', rateLimit('maps', 60), async (c) => {
    const img = await maps.staticMap(e, { lat: Number(c.req.query('lat')), lng: Number(c.req.query('lng')), zoom: Number(c.req.query('zoom') ?? 16) });
    return c.body(img, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
  });

  /** City suggestions for a search box: configured and known cities, then any city in India from Google. */
  app.get('/v1/cities/search', rateLimit('cities', 60), async (c) => ok(c, await cities.suggestCities(e, c.req.query('q') ?? '')));

  /** The signed receipt behind a bill QR's short code, for the scan page to show before claiming. */
  app.get('/v1/receipt-codes/:code', rateLimit('receipt-codes', 60), async (c) => ok(c, { payload: await merchants.receiptPayload(e, c.req.param('code')) }));

  /** A scanned proof QR: on to Reclaim's portal while the request waits for its proof, else back to the review page. */
  app.get('/go/proof/:id', async (c) => c.redirect((await proofs.proofRequestLink(e, c.req.param('id'))) ?? `${e.urls.web}/review`, 302));

  /** Shop-through click-out: "Buy via Receipts". The commission is disclosed on the link and the landing page. */
  app.get('/go/:item', async (c) => {
    const res = await shop.clickOut(e, c.req.param('item'), { wallet: c.get('session')?.sub ?? c.req.query('w') ?? null, answerId: c.req.query('a') ?? null });
    return c.redirect(res.url, 302);
  });

  return app;
}
