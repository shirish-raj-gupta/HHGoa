import {
  RAIL_TIER,
  contentAddress,
  embedText,
  itemIdFor,
  merchantIdFor,
  purchaseNullifier,
  reviewerIdFromNullifier,
  toPgVector,
  type Rail,
} from '@receipts/core';
import { CATEGORY_CONFIGS } from '@receipts/categories';
import { keccak256, toBytes, getAddress, type Hex } from 'viem';
import { json, type Db } from '../client';

// Labelled simulated history. It covers what a four-day event cannot produce: track-record scores, day-30 and
// day-90 follow-ups, and enough reviews to rank. Rules:
//   - every merchant and product here is fictional and its name ends in "(demo)";
//   - everything sits under the pseudo-brand "demo", never a real brand;
//   - every row has simulated = true, and every screen labels it;
//   - real places get real receipts only.

const DEMO_BRAND = 'demo';

interface DemoItem {
  name: string;
  quality: number;
  price: number;
  diet?: 'veg' | 'non_veg';
  durability?: number;
  good: string[];
  bad: string[];
}

interface DemoMerchant {
  key: string;
  name: string;
  city: string | null;
  category: string;
  rail: Rail;
  at?: [number, number];
  items: DemoItem[];
}

const near = (lat: number, lng: number, dLat: number, dLng: number): [number, number] => [lat + dLat, lng + dLng];
const CALANGUTE: [number, number] = [15.5439, 73.7554];

export const DEMO_MERCHANTS: DemoMerchant[] = [
  {
    key: 'saudade',
    name: 'Saudade Kitchen (demo)',
    city: 'goa',
    category: 'food',
    rail: 'order_page',
    at: near(...CALANGUTE, 0.0021, 0.0012),
    items: [
      {
        name: 'Veg Dum Biryani',
        quality: 4.5,
        price: 320,
        diet: 'veg',
        durability: 0.88,
        good: ['Portion fed two people', 'Not oily at all', 'Rice was long and fragrant', 'Raita was fresh', 'Arrived hot'],
        bad: ['Arrived 20 minutes late', 'A little too spicy'],
      },
      {
        name: 'Chicken Dum Biryani',
        quality: 4.3,
        price: 380,
        diet: 'non_veg',
        durability: 0.82,
        good: ['Chicken was tender', 'Generous portion', 'Well packed'],
        bad: ['Slightly salty'],
      },
      {
        name: 'Goan Fish Thali',
        quality: 4.1,
        price: 420,
        diet: 'non_veg',
        good: ['Fish curry tasted homemade', 'Good value for a thali'],
        bad: ['Fish piece was small'],
      },
    ],
  },
  {
    key: 'baga-biryani',
    name: 'Baga Biryani Co. (demo)',
    city: 'goa',
    category: 'food',
    rail: 'order_email',
    at: near(...CALANGUTE, 0.0108, -0.0031),
    items: [
      {
        name: 'Veg Biryani',
        quality: 3.8,
        price: 240,
        diet: 'veg',
        durability: 0.7,
        good: ['Cheap and filling', 'Quick delivery'],
        bad: ['Bit oily', 'Vegetables were overcooked', 'Small portion for the price'],
      },
      {
        name: 'Paneer Biryani',
        quality: 3.6,
        price: 300,
        diet: 'veg',
        good: ['Plenty of paneer'],
        bad: ['Paneer was rubbery', 'Too much oil'],
      },
    ],
  },
  {
    key: 'golden-sands',
    name: 'Golden Sands Grill (demo)',
    city: 'goa',
    category: 'food',
    rail: 'payment_proof',
    at: near(...CALANGUTE, -0.0034, 0.0019),
    items: [
      {
        name: 'Veg Biryani',
        quality: 2.1,
        price: 350,
        diet: 'veg',
        durability: 0.3,
        good: ['Big portion'],
        bad: ['Rice was stale', 'Very oily', 'Felt unwell next day', 'Overpriced for the quality', 'Cold on arrival'],
      },
    ],
  },
  {
    key: 'spice-route',
    name: 'Spice Route Dhaba (demo)',
    city: 'goa',
    category: 'food',
    rail: 'merchant_receipt',
    at: near(15.5182, 73.7621, 0.0011, 0.0009),
    items: [
      {
        name: 'Veg Dum Biryani',
        quality: 4.0,
        price: 280,
        diet: 'veg',
        durability: 0.8,
        good: ['Tasty and balanced spice', 'Good value', 'Clean kitchen visible from the table'],
        bad: ['Long wait at dinner time'],
      },
    ],
  },
  {
    key: 'tidewater',
    name: 'Tidewater Café (demo)',
    city: 'goa',
    category: 'food',
    rail: 'payment_proof',
    at: near(...CALANGUTE, 0.0007, -0.0018),
    items: [
      {
        name: 'Filter Coffee',
        quality: 4.4,
        price: 90,
        diet: 'veg',
        good: ['Strong filter coffee', 'Good place to work for an hour'],
        bad: ['Few power sockets'],
      },
      { name: 'Masala Dosa', quality: 4.0, price: 140, diet: 'veg', good: ['Crisp dosa', 'Chutney was fresh'], bad: ['Sambar was watery'] },
    ],
  },
  {
    key: 'casa-quieta',
    name: 'Casa Quieta Stay (demo)',
    city: 'goa',
    category: 'travel',
    rail: 'order_email',
    at: near(...CALANGUTE, 0.0052, 0.0041),
    items: [
      {
        name: 'Deluxe Room',
        quality: 4.6,
        price: 3800,
        good: ['Very quiet at night', 'Wi-Fi held steady for video calls', 'Desk and chair in the room', 'Staff were helpful', 'Spotless bathroom'],
        bad: ['Breakfast ended early'],
      },
    ],
  },
  {
    key: 'party-point',
    name: 'Party Point Hostel (demo)',
    city: 'goa',
    category: 'travel',
    rail: 'order_email',
    at: near(...CALANGUTE, 0.0094, -0.0027),
    items: [
      {
        name: 'Dorm Bed',
        quality: 3.3,
        price: 900,
        good: ['Fun crowd', 'Cheap', 'Close to the beach'],
        bad: ['Loud music until 2 am', 'Wi-Fi kept dropping', 'Shared bathroom was messy'],
      },
    ],
  },
  {
    key: 'palm-grove',
    name: 'Palm Grove Residency (demo)',
    city: 'goa',
    category: 'travel',
    rail: 'order_page',
    at: near(...CALANGUTE, -0.0061, 0.0033),
    items: [
      {
        name: 'Standard Room',
        quality: 3.9,
        price: 2600,
        good: ['Clean room', 'Good value', 'Pool was well kept'],
        bad: ['Wi-Fi slow in the evenings', 'Road noise in front rooms'],
      },
    ],
  },
  {
    key: 'electronics',
    name: 'Demo Electronics Store (demo)',
    city: null,
    category: 'products',
    rail: 'order_page',
    items: [
      {
        name: 'VoltPeak 10000mAh Power Bank (demo)',
        quality: 4.4,
        price: 1199,
        durability: 0.9,
        good: ['Charges a phone twice', 'Fast charging works', 'Slim enough for a pocket', 'Still holding charge after a month'],
        bad: ['Cable is short'],
      },
      {
        name: 'ChargeMax 20000mAh Power Bank (demo)',
        quality: 3.5,
        price: 1499,
        durability: 0.55,
        good: ['Large capacity', 'Two ports'],
        bad: ['Heavy', 'Got warm while charging', 'Battery swelled after two months'],
      },
      {
        name: 'PocketJuice 5000mAh Power Bank (demo)',
        quality: 3.9,
        price: 699,
        durability: 0.8,
        good: ['Very light', 'Cheap and reliable'],
        bad: ['Only one full charge'],
      },
      {
        name: 'MegaCell 30000mAh Power Bank (demo)',
        quality: 4.2,
        price: 2499,
        durability: 0.85,
        good: ['Lasted a whole trek'],
        bad: ['Very heavy'],
      },
    ],
  },
  {
    key: 'store',
    name: 'Quick Store Calangute (demo)',
    city: 'goa',
    category: 'groceries',
    rail: 'order_email',
    at: near(...CALANGUTE, 0.0015, 0.0027),
    items: [{ name: 'Store', quality: 3.9, price: 650, good: ['Fresh vegetables', 'Delivered in 12 minutes'], bad: ['Milk was substituted without asking'] }],
  },
  {
    key: 'scooter',
    name: 'Calangute Scooter Hire (demo)',
    city: 'goa',
    category: 'local_services',
    rail: 'payment_proof',
    at: near(...CALANGUTE, -0.0012, -0.0022),
    items: [
      {
        name: 'Scooter rental (1 day)',
        quality: 4.1,
        price: 400,
        good: ['Scooter in good condition', 'Honest pricing, no deposit games'],
        bad: ['Helmet was worn out'],
      },
    ],
  },
  {
    key: 'sea-breeze',
    name: 'Sea Breeze Apartments, Candolim (demo)',
    city: 'goa',
    category: 'landlords',
    rail: 'payment_proof',
    at: near(15.5182, 73.7621, -0.0016, 0.0024),
    items: [
      {
        name: 'Building',
        quality: 3.7,
        price: 18000,
        good: ['Repairs done within a week', 'Deposit returned in full'],
        bad: ['Water supply cut most mornings'],
      },
    ],
  },
  {
    key: 'streambox',
    name: 'StreamBox Premium (demo)',
    city: null,
    category: 'subscriptions',
    rail: 'order_email',
    items: [{ name: 'Premium plan', quality: 3.4, price: 499, good: ['Good catalogue'], bad: ['Cancelling took three emails', 'Price went up without notice'] }],
  },
  {
    key: 'tide-api',
    name: 'Tide Tables API (demo)',
    city: null,
    category: 'agents_apis',
    rail: 'onchain_payment',
    items: [{ name: 'GET /tides', quality: 4.3, price: 1, good: ['Accurate tide times', 'Fast responses'], bad: ['Down for an hour once'] }],
  },
  {
    key: 'koramangala',
    name: 'Koramangala Kitchen (demo)',
    city: 'bengaluru',
    category: 'food',
    rail: 'order_page',
    at: [12.9352, 77.6245],
    items: [{ name: 'Veg Dum Biryani', quality: 4.6, price: 300, diet: 'veg', good: ['Best biryani in the area', 'Huge portion'], bad: ['Packaging leaked'] }],
  },
  {
    key: 'bandra-bites',
    name: 'Bandra Bites (demo)',
    city: 'mumbai',
    category: 'food',
    rail: 'order_email',
    at: [19.0596, 72.8295],
    items: [{ name: 'Vada Pav Combo', quality: 4.2, price: 180, diet: 'veg', good: ['Crispy vada', 'Spicy chutney'], bad: ['Pav was dry'] }],
  },
  {
    key: 'cp-thali',
    name: 'CP Thali House (demo)',
    city: 'delhi',
    category: 'food',
    rail: 'merchant_receipt',
    at: [28.6315, 77.2167],
    items: [{ name: 'Veg Thali', quality: 4.0, price: 350, diet: 'veg', good: ['Unlimited refills', 'Dal was excellent'], bad: ['Crowded at lunch'] }],
  },
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;

export function demoWallet(i: number): `0x${string}` {
  return getAddress(`0x${keccak256(toBytes(`receipts-demo-reviewer-${i}`)).slice(26)}`);
}

export async function seedDemoHistory(db: Db, opts: { reviewers?: number; now?: Date; log?: (m: string) => void } = {}): Promise<{ reviews: number }> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const rand = mulberry32(20261031);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const normal = () => {
    const u = Math.max(rand(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };

  await db.query(
    `INSERT INTO brands (id, name, grp, domains, categories, default_rail)
     VALUES ($1, 'Simulated demo data', 'demo', '{}', $2, 'order_page') ON CONFLICT (id) DO NOTHING`,
    [DEMO_BRAND, CATEGORY_CONFIGS.map((c) => c.category)],
  );

  const reviewerCount = opts.reviewers ?? 36;
  const reviewers = Array.from({ length: reviewerCount }, (_, i) => {
    const nullifier = keccak256(toBytes(`receipts-demo-nullifier-${i}`));
    return { i, nullifier, id: reviewerIdFromNullifier(nullifier), wallet: demoWallet(i).toLowerCase(), noise: 0.25 + rand() * 1.1 };
  });
  for (const r of reviewers) {
    await db.query(
      `INSERT INTO reviewers (id, nullifier_hash, id_type, wallet, simulated) VALUES ($1, $2, 'simulated', $3, true)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.nullifier, r.wallet],
    );
    // Each simulated reviewer was funded by its own wallet: no shared funder in honest history.
    await db.query(
      `INSERT INTO wallet_funding (tx_hash, from_wallet, to_wallet, asset, amount, block_time, simulated)
       VALUES ($1, $2, $3, 'ETH', '1000000000000000', $4, true) ON CONFLICT DO NOTHING`,
      [keccak256(toBytes(`fund-${r.i}`)), `0x${keccak256(toBytes(`funder-${r.i}`)).slice(26)}`, r.wallet, new Date(now.getTime() - 200 * DAY)],
    );
  }

  let count = 0;
  for (const m of DEMO_MERCHANTS) {
    const merchantId = merchantIdFor({ brandId: DEMO_BRAND, cityId: m.city, externalId: `demo:${m.key}`, name: m.name });
    await db.query(
      `INSERT INTO merchants (id, brand_id, city_id, category_id, name, geom, source, simulated)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7::float8, $6::float8), 4326)::geography END, 'demo', true)
       ON CONFLICT (id) DO NOTHING`,
      [merchantId, DEMO_BRAND, m.city, m.category, m.name, m.at?.[0] ?? null, m.at?.[1] ?? null],
    );
    const cat = CATEGORY_CONFIGS.find((c) => c.category === m.category)!;
    for (const it of m.items) {
      const itemId = itemIdFor(merchantId, it.name);
      await db.query(
        `INSERT INTO items (id, merchant_id, category_id, canonical_name, embedding, diet, price_min_minor, price_max_minor)
         VALUES ($1, $2, $3, $4, $5::vector, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [itemId, merchantId, m.category, it.name, toPgVector(embedText(it.name)), it.diet ?? null, it.price * 100, it.price * 100],
      );

      const n = 6 + Math.floor(rand() * 7);
      const chosen = [...reviewers].sort(() => rand() - 0.5).slice(0, n);
      for (const r of chosen) {
        const ageDays = 3 + Math.floor(rand() * 115);
        const createdAt = new Date(now.getTime() - ageDays * DAY - Math.floor(rand() * DAY));
        const purchasedOn = new Date(createdAt.getTime() - Math.floor(rand() * 2) * DAY).toISOString().slice(0, 10);
        const rating = Math.max(1, Math.min(5, Math.round(it.quality + normal() * r.noise)));
        const paid = Math.round(it.price * (0.9 + rand() * 0.2));
        const pool = rating >= 4 ? it.good : rating <= 2 ? it.bad : [...it.good, ...it.bad];
        const claims = [...new Set([pick(pool), pick(pool), ...(rand() > 0.5 ? [pick(pool)] : [])])].slice(0, 3);
        const aspects = Object.fromEntries(
          cat.aspects.filter(() => rand() > 0.3).map((a) => [a, Math.max(-1, Math.min(1, Math.round(((rating - 3) / 2 + normal() * 0.3) * 100) / 100))]),
        );
        const language = rand() > 0.55 ? 'hi-IN' : 'en-IN';
        const summary = `${rating >= 4 ? 'Recommended' : rating <= 2 ? 'Would not order again' : 'Mixed'}: ${claims[0]!.toLowerCase()}.`;
        const orderRef = `demo-${m.key}-${r.i}-${ageDays}-${Math.floor(rand() * 1e6)}`;
        const nullifier = purchaseNullifier(`sim:${DEMO_BRAND}`, orderRef);
        const purchaseId = `pu_demo_${nullifier.slice(2, 16)}`;
        const reviewId = `r_demo_${nullifier.slice(2, 16)}`;
        const tier = RAIL_TIER[m.rail];

        const doc = {
          schema: 'receipts.review.v1' as const,
          category: m.category,
          itemId,
          item: it.name,
          merchantId,
          merchant: m.name,
          brand: DEMO_BRAND,
          rating,
          aspects,
          claims,
          diet: it.diet ?? null,
          language,
          summary_en: summary,
          transcript: null,
          rail: m.rail,
          tier,
          purchased: purchasedOn,
          reviewerId: r.id,
          simulated: true,
        };
        const { cid, bytes } = await contentAddress(doc);
        await db.query('INSERT INTO content (cid, bytes, content_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [cid, bytes, 'application/json']);

        const inserted = await db.maybe(
          `INSERT INTO purchases (id, purchase_nullifier, reviewer_id, wallet, rail, tier, brand_id, merchant_id, category_id, item_ids, items,
             amount_minor, currency, purchased_on, proof_hash, status, simulated, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'INR', $13, $14, 'confirmed', true, $15)
           ON CONFLICT DO NOTHING RETURNING id`,
          [
            purchaseId,
            nullifier,
            r.id,
            r.wallet,
            m.rail,
            tier,
            DEMO_BRAND,
            merchantId,
            m.category,
            [itemId],
            [{ name: it.name, quantity: 1, priceMinor: paid * 100 }],
            paid * 100,
            purchasedOn,
            keccak256(toBytes(`demo-proof-${orderRef}`)),
            createdAt,
          ],
        );
        if (!inserted) continue;
        const reviewInserted = await db.maybe(
          `INSERT INTO reviews (id, reviewer_id, purchase_id, item_id, merchant_id, category_id, rating, aspects, claims, summary_en, diet,
             language, content_cid, rail, tier, status, publish_at, embedding, simulated, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'active', $16, $17::vector, true, $16)
           ON CONFLICT DO NOTHING RETURNING id`,
          [
            reviewId,
            r.id,
            purchaseId,
            itemId,
            merchantId,
            m.category,
            rating,
            aspects,
            json(claims),
            summary,
            it.diet ?? null,
            language,
            cid,
            m.rail,
            tier,
            createdAt,
            toPgVector(embedText(claims.join('. '))),
          ],
        );
        if (!reviewInserted) continue;
        count++;

        // Follow-ups: answered when their time has passed, fast-forwarded and labelled like the rest.
        for (const spec of cat.followups) {
          const days = /^(\d+)d$/.exec(spec)?.[1];
          const offset = days ? Number(days) : spec === 'trip_end' ? 2 : spec === 'move_out' ? 120 : 30;
          const due = new Date(createdAt.getTime() + offset * DAY);
          const answered = due.getTime() < now.getTime() - DAY;
          const durability = it.durability ?? (rating >= 4 ? 0.85 : 0.5);
          const stillGood = answered ? rand() < (rating >= 3 ? durability : durability * 0.4) : null;
          await db.query(
            `INSERT INTO followups (id, review_id, kind, day_offset, due_at, status, still_good, new_rating, answered_at, simulated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) ON CONFLICT DO NOTHING`,
            [
              `fu_${reviewId.slice(2)}_${spec}`,
              reviewId,
              spec,
              offset,
              due,
              answered ? 'answered' : 'scheduled',
              stillGood,
              answered && stillGood === false ? Math.max(1, rating - 2) : null,
              answered ? new Date(due.getTime() + DAY / 3) : null,
            ],
          );
        }
      }
    }
  }
  log(`demo history: ${count} simulated reviews from ${reviewerCount} simulated reviewers`);
  return { reviews: count };
}

/** Wallets used by the planted ring in the attack demo. Simulated and labelled like everything else here. */
export function plantedRingWallets(n = 5): { nullifier: Hex; wallet: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    nullifier: keccak256(toBytes(`receipts-planted-ring-${i}`)),
    wallet: `0x${keccak256(toBytes(`receipts-planted-wallet-${i}`)).slice(26)}`,
  }));
}
