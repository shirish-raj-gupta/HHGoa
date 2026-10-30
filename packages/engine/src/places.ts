import {
  cityForPoint,
  embedText,
  itemIdFor,
  merchantIdFor,
  normalizeName,
  toPgVector,
  type PurchaseClaim,
} from '@receipts/core';
import { getCategory } from '@receipts/categories';
import type { Hex } from 'viem';
import { UserError, type Engine } from './context';
import { cityBox, cityFor } from './cities';
import { placeDetails, searchPlaces, type GooglePlace } from './google';

// Merchants and items are created from proofs. A merchant is keyed by brand + city + the brand's outlet ID (or name);
// an item is a dish, product variant, room type, service or building at one merchant.

const NON_VEG = /\b(chicken|mutton|lamb|fish|prawn|prawns|shrimp|crab|beef|pork|keema|meat|seafood|squid|kebab)\b/i;

export function inferDiet(name: string): 'veg' | 'non_veg' | 'egg' | null {
  if (NON_VEG.test(name)) return 'non_veg';
  if (/\begg\b|omelette|omelet/i.test(name)) return 'egg';
  if (/\b(veg|vegetarian|paneer|dal|aloo|gobi|chana|rajma|dosa|idli|veg\.)\b/i.test(name) && !/non[\s-]?veg/i.test(name)) return 'veg';
  return null;
}

/** The pseudo-item a merchant-level review attaches to: "Store", "Service", "Building", "Overall". */
export function merchantLevelItem(category: string): string {
  const noun = getCategory(category).item_noun;
  if (['store', 'service', 'building', 'plan', 'api'].includes(noun)) return noun.charAt(0).toUpperCase() + noun.slice(1);
  return 'Overall';
}

interface Located {
  lat: number;
  lng: number;
  address?: string | null;
  placeId?: string | null;
  mapsUrl?: string | null;
}

/** Where a merchant from a proof is: a listing we already placed under the same name, else Google Maps when its top
 *  matches carry the same name (never for simulated data). Null when unsure: a wrong pin is worse than none. */
async function locate(e: Engine, name: string, cityId: string | null, simulated: boolean): Promise<Located | null> {
  if (!cityId) return null;
  const norm = normalizeName(name);
  const row = await e.db.maybe<{ lat: number; lng: number }>(
    `SELECT ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng FROM merchants
      WHERE city_id = $1 AND geom IS NOT NULL AND lower(regexp_replace(name, '[^a-zA-Z0-9]+', ' ', 'g')) = $2
      ORDER BY (google_place_id IS NOT NULL) DESC LIMIT 1`,
    [cityId, norm],
  );
  if (row) return { lat: Number(row.lat), lng: Number(row.lng) };
  if (simulated || !e.env.GOOGLE_MAPS_API_KEY || norm.length < 4) return null;
  const places = await searchPlaces(e, { query: name, cityId, max: 3 }).catch(() => []);
  const hit = places.find((p) => {
    const g = normalizeName(p.name);
    return g === norm || g.startsWith(`${norm} `) || norm.startsWith(`${g} `);
  });
  return hit ? { lat: hit.lat, lng: hit.lng, address: hit.address, placeId: hit.placeId, mapsUrl: hit.mapsUrl } : null;
}

export async function upsertMerchant(e: Engine, claim: PurchaseClaim, category: string): Promise<Hex> {
  const m = claim.merchant;
  if (m.upiVpa) {
    const byVpa = await e.db.maybe<{ id: Hex }>('SELECT id FROM merchants WHERE upi_vpa = $1 LIMIT 1', [m.upiVpa.toLowerCase()]);
    if (byVpa) return byVpa.id;
  }
  const point = m.lat !== undefined && m.lng !== undefined ? { lat: m.lat, lng: m.lng } : null;
  const cityId = m.cityId ?? (point ? cityForPoint(point.lat, point.lng)?.city ?? null : null);
  const id = merchantIdFor({ brandId: claim.brandId, cityId, externalId: m.externalId ?? (m.wallet ? `wallet:${m.wallet}` : null), name: m.name });
  const geo: Located | null = point ?? (await locate(e, m.name, cityId, claim.simulated));
  await e.db.query(
    `INSERT INTO merchants (id, brand_id, city_id, category_id, name, external_id, upi_vpa, wallet, address, geom, source, simulated, google_place_id, maps_url, google_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             CASE WHEN $10::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($11::float8, $10::float8), 4326)::geography END,
             'proof', $12, $13, $14, CASE WHEN $13::text IS NULL THEN NULL ELSE now() END)
     ON CONFLICT (id) DO UPDATE SET
       upi_vpa = COALESCE(merchants.upi_vpa, EXCLUDED.upi_vpa),
       wallet = COALESCE(merchants.wallet, EXCLUDED.wallet),
       address = COALESCE(merchants.address, EXCLUDED.address),
       geom = COALESCE(merchants.geom, EXCLUDED.geom),
       city_id = COALESCE(merchants.city_id, EXCLUDED.city_id),
       google_place_id = COALESCE(merchants.google_place_id, EXCLUDED.google_place_id),
       maps_url = COALESCE(merchants.maps_url, EXCLUDED.maps_url),
       google_synced_at = COALESCE(merchants.google_synced_at, EXCLUDED.google_synced_at)`,
    [
      id,
      claim.brandId,
      cityId,
      category,
      m.name,
      m.externalId ?? null,
      m.upiVpa?.toLowerCase() ?? null,
      m.wallet?.toLowerCase() ?? null,
      m.address ?? geo?.address ?? null,
      geo?.lat ?? null,
      geo?.lng ?? null,
      claim.simulated,
      geo?.placeId ?? null,
      geo?.mapsUrl ?? null,
    ],
  );
  return id;
}

// Which shop a UPI payment went to. The payment proves the payee (often a legal name, like "SHREE GANESH ENTERPRISES"),
// not where it is, so the reviewer picks the shop on Google Maps. The first pin wins: later payments to the same UPI ID
// find the merchant already placed, and a business that claims the listing can correct it.

interface PinnablePurchase {
  rail: string;
  wallet: string;
  merchant_id: Hex;
  merchant_name: string;
  payee_name: string | null;
  city_id: string | null;
  google_place_id: string | null;
  reviewed: boolean;
}

async function pinnablePurchase(e: Engine, purchaseId: string, wallet: string): Promise<PinnablePurchase> {
  const p = await e.db.maybe<PinnablePurchase>(
    `SELECT p.rail, p.wallet, p.merchant_id, m.name AS merchant_name, m.payee_name, m.city_id, m.google_place_id,
            EXISTS (SELECT 1 FROM reviews r WHERE r.purchase_id = p.id) AS reviewed
       FROM purchases p JOIN merchants m ON m.id = p.merchant_id WHERE p.id = $1`,
    [purchaseId],
  );
  if (!p || p.wallet !== wallet.toLowerCase()) throw new UserError('purchase not found', 404);
  if (p.rail !== 'payment_proof') throw new UserError('This purchase already names its merchant; only a payment needs its shop pinned.', 400, 'not_a_payment');
  return p;
}

/** Google Maps places that could be the shop this payment went to (the payee's name, or what the reviewer typed). */
export async function placeCandidates(e: Engine, purchaseId: string, wallet: string, query?: string): Promise<GooglePlace[]> {
  const p = await pinnablePurchase(e, purchaseId, wallet);
  const payee = (p.payee_name || p.merchant_name).replace(/s*(demo)s*$/i, '');
  return searchPlaces(e, { query: query?.trim() || payee, box: await cityBox(e, p.city_id) });
}

/** Pin the payment's merchant to a Google place, checked with Google rather than taken from the browser. */
export async function pinPlace(e: Engine, purchaseId: string, wallet: string, placeId: string): Promise<void> {
  const p = await pinnablePurchase(e, purchaseId, wallet);
  if (p.reviewed) throw new UserError('This purchase is already reviewed.', 409, 'reviewed');
  if (p.google_place_id) return;
  const place = await placeDetails(e, placeId);
  await e.db.query(
    `UPDATE merchants SET payee_name = COALESCE(payee_name, name), name = $2, address = $3,
            geom = ST_SetSRID(ST_MakePoint($5::float8, $4::float8), 4326)::geography, city_id = COALESCE($6, city_id),
            google_place_id = $7, maps_url = $8, google_synced_at = now()
      WHERE id = $1 AND google_place_id IS NULL`,
    [p.merchant_id, place.name, place.address, place.lat, place.lng, await cityFor(e, place.lat, place.lng).catch(() => null), place.placeId, place.mapsUrl],
  );
}

/** Keep what we copied from Google fresh: Google allows place IDs to be stored, the rest for up to 30 days. */
export async function refreshGooglePlaces(e: Engine): Promise<number> {
  if (!e.env.GOOGLE_MAPS_API_KEY) return 0;
  const stale = await e.db.query<{ id: string; google_place_id: string }>(
    `SELECT id, google_place_id FROM merchants WHERE google_place_id IS NOT NULL AND (google_synced_at IS NULL OR google_synced_at < now() - interval '25 days') LIMIT 50`,
  );
  for (const m of stale) {
    const place = await placeDetails(e, m.google_place_id).catch(() => null);
    if (!place) continue;
    await e.db.query(
      `UPDATE merchants SET name = $2, address = $3, geom = ST_SetSRID(ST_MakePoint($5::float8, $4::float8), 4326)::geography, maps_url = $6, google_synced_at = now() WHERE id = $1`,
      [m.id, place.name, place.address, place.lat, place.lng, place.mapsUrl],
    );
  }
  return stale.length;
}

export async function upsertItem(
  e: Engine,
  input: { merchantId: Hex; category: string; name: string; variant?: string | null; priceMinor?: number | null; diet?: string | null },
): Promise<Hex> {
  const id = itemIdFor(input.merchantId, input.name, input.variant);
  const diet = input.diet ?? (input.category === 'food' ? inferDiet(input.name) : null);
  await e.db.query(
    `INSERT INTO items (id, merchant_id, category_id, canonical_name, variant, embedding, diet, price_min_minor, price_max_minor)
     VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $8)
     ON CONFLICT (id) DO UPDATE SET
       price_min_minor = LEAST(COALESCE(items.price_min_minor, EXCLUDED.price_min_minor), COALESCE(EXCLUDED.price_min_minor, items.price_min_minor)),
       price_max_minor = GREATEST(COALESCE(items.price_max_minor, EXCLUDED.price_max_minor), COALESCE(EXCLUDED.price_max_minor, items.price_max_minor)),
       diet = COALESCE(items.diet, EXCLUDED.diet),
       updated_at = now()`,
    [id, input.merchantId, input.category, input.name.trim(), input.variant ?? null, toPgVector(embedText(input.name)), diet, input.priceMinor ?? null],
  );
  return id;
}
