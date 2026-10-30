import { CITIES } from '@receipts/core';
import { UserError, type Engine } from './context';

// Every city in India, not just the configured four. A business picks its city from Google's suggestions (or types
// it), and a listing in a city we have not seen yet makes that city from Google's map of it: the locality, its state
// and its viewport (Geocoding API). Configured cities (packages/core/src/city.ts) keep their own settings.

export type Box = [minLng: number, minLat: number, maxLng: number, maxLat: number];

/** India, for maps and searches when no city is given. */
export const INDIA: Box = [68.1, 6.5, 97.4, 35.7];

const inBox = (b: Box, lat: number, lng: number) => lng >= b[0] && lat >= b[1] && lng <= b[2] && lat <= b[3];
export const inIndia = (lat: number, lng: number) => inBox(INDIA, lat, lng);

// Speech languages by state, for Sarvam; English and Hindi everywhere.
const STATE_LANGUAGES: Record<string, string[]> = {
  Karnataka: ['kn-IN'],
  'Tamil Nadu': ['ta-IN'],
  Kerala: ['ml-IN'],
  Keralam: ['ml-IN'],
  Maharashtra: ['mr-IN'],
  Goa: ['kok-IN', 'mr-IN'],
  Gujarat: ['gu-IN'],
  'West Bengal': ['bn-IN'],
  Telangana: ['te-IN'],
  'Andhra Pradesh': ['te-IN'],
  Punjab: ['pa-IN'],
  Odisha: ['od-IN'],
};

interface GeocodeResult {
  address_components: { long_name: string; types: string[] }[];
  geometry: { location: { lat: number; lng: number }; viewport: { northeast: { lat: number; lng: number }; southwest: { lat: number; lng: number } } };
}

async function geocode(e: Engine, params: Record<string, string>): Promise<GeocodeResult | null> {
  if (!e.env.GOOGLE_MAPS_API_KEY) return null;
  const q = new URLSearchParams({ ...params, region: 'in', key: e.env.GOOGLE_MAPS_API_KEY });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${q}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const json = res?.ok ? ((await res.json()) as { status: string; results: GeocodeResult[] }) : null;
  return json?.status === 'OK' ? (json.results[0] ?? null) : null;
}

const part = (r: GeocodeResult, ...types: string[]) => types.map((t) => r.address_components.find((c) => c.types.includes(t))?.long_name).find(Boolean) ?? null;
const boxOf = (r: GeocodeResult): Box => {
  const v = r.geometry.viewport;
  return [v.southwest.lng, v.southwest.lat, v.northeast.lng, v.northeast.lat];
};

const nearCache = new Map<string, { box: Box; name: string } | null>();

/** The area a typed city name covers ("Pune", "Hubli, Karnataka"), from Google; null when Google does not know it. */
export async function resolveNear(e: Engine, text: string): Promise<{ box: Box; name: string } | null> {
  const key = text.trim().toLowerCase();
  if (!key) return null;
  if (nearCache.has(key)) return nearCache.get(key)!;
  const r = await geocode(e, { address: `${text.trim()}, India` });
  const out = r && inIndia(r.geometry.location.lat, r.geometry.location.lng) ? { box: boxOf(r), name: part(r, 'locality', 'administrative_area_level_3', 'administrative_area_level_2') ?? text.trim() } : null;
  nearCache.set(key, out);
  return out;
}

/** A city's search area: a configured city, or one made earlier from Google. */
export async function cityBox(e: Engine, cityId: string | null | undefined): Promise<Box | null> {
  if (!cityId) return null;
  const configured = CITIES.find((c) => c.city === cityId);
  if (configured) return configured.bbox;
  const row = await e.db.maybe<{ bbox: number[] }>('SELECT bbox FROM cities WHERE id = $1', [cityId]);
  return row ? (row.bbox.map(Number) as Box) : null;
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');

/** The city a point is in: a configured city, a city made earlier, or a new one made from Google's map of it.
 *  Points outside India are refused; null when Google cannot name the place. */
export async function cityFor(e: Engine, lat: number, lng: number): Promise<string | null> {
  if (!inIndia(lat, lng)) throw new UserError('Receipts covers places in India for now.', 400, 'outside_india');
  const configured = CITIES.find((c) => inBox(c.bbox, lat, lng));
  if (configured) return configured.city;
  const known = await e.db.maybe<{ id: string }>(
    `SELECT id FROM cities WHERE source = 'google' AND bbox[1] <= $2 AND bbox[2] <= $1 AND bbox[3] >= $2 AND bbox[4] >= $1
      ORDER BY (bbox[3] - bbox[1]) * (bbox[4] - bbox[2]) LIMIT 1`,
    [lat, lng],
  );
  if (known) return known.id;
  const r =
    (await geocode(e, { latlng: `${lat},${lng}`, result_type: 'locality' })) ??
    (await geocode(e, { latlng: `${lat},${lng}`, result_type: 'administrative_area_level_3|administrative_area_level_2' }));
  if (!r) return null;
  const name = part(r, 'locality', 'administrative_area_level_3', 'administrative_area_level_2');
  const state = part(r, 'administrative_area_level_1');
  if (!name) return null;
  let id = slug(name);
  const clash = await e.db.maybe<{ state: string | null }>('SELECT state FROM cities WHERE id = $1', [id]);
  if (clash && clash.state !== state) id = `${id}_${slug(state ?? 'india')}`;
  const box = boxOf(r);
  await e.db.query(
    `INSERT INTO cities (id, name, bbox, center, timezone, languages, status, state, source)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 'Asia/Kolkata', $6, 'open', $7, 'google')
     ON CONFLICT (id) DO NOTHING`,
    [id, name, box, r.geometry.location.lng, r.geometry.location.lat, ['en-IN', 'hi-IN', ...(STATE_LANGUAGES[state ?? ''] ?? [])], state],
  );
  return id;
}

/** City suggestions for a search box: configured and known cities by name, then Google's (any city in India). */
export async function suggestCities(e: Engine, q: string): Promise<{ id: string | null; name: string; state: string | null }[]> {
  const text = q.trim();
  if (text.length < 2) return CITIES.map((c) => ({ id: c.city, name: c.name, state: null }));
  const ours = await e.db.query<{ id: string; name: string; state: string | null }>(
    `SELECT id, name, state FROM cities WHERE name ILIKE $1 ORDER BY (source = 'config') DESC, name LIMIT 5`,
    [`${text.replace(/[%_]/g, '')}%`],
  );
  let theirs: { id: null; name: string; state: string | null }[] = [];
  if (e.env.GOOGLE_MAPS_API_KEY) {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': e.env.GOOGLE_MAPS_API_KEY },
      body: JSON.stringify({ input: text.slice(0, 60), includedPrimaryTypes: ['(cities)'], includedRegionCodes: ['in'], languageCode: 'en' }),
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    const json = res?.ok ? ((await res.json()) as { suggestions?: { placePrediction?: { structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }[] }) : null;
    theirs = (json?.suggestions ?? [])
      .map((s) => s.placePrediction?.structuredFormat)
      .filter((f) => f?.mainText?.text)
      .map((f) => ({ id: null, name: f!.mainText!.text!, state: f!.secondaryText?.text?.replace(/,\s*India$/, '') ?? null }));
  }
  const seen = new Set(ours.map((c) => c.name.toLowerCase()));
  return [...ours, ...theirs.filter((c) => !seen.has(c.name.toLowerCase()))].slice(0, 8);
}
