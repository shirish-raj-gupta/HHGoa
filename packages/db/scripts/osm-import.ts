// Import places for each city's bounding box from OpenStreetMap (Overpass API) into data/places/<city>.json.
//   pnpm --filter @receipts/db osm            # all cities
//   pnpm --filter @receipts/db osm goa
// Data © OpenStreetMap contributors, ODbL. Attribute it wherever places are shown.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CITIES } from '@receipts/core';
import type { OsmPlace } from '../src/seed/places';

const OVERPASS = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const OUT = fileURLToPath(new URL('../data/places', import.meta.url));

const TAGS: { filter: string; category: string }[] = [
  { filter: '["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]', category: 'food' },
  { filter: '["tourism"~"^(hotel|guest_house|hostel|motel|apartment)$"]', category: 'travel' },
  { filter: '["shop"~"^(supermarket|convenience|greengrocer|bakery)$"]', category: 'groceries' },
  { filter: '["shop"~"^(hairdresser|beauty|laundry|tailor|bicycle|motorcycle|car_repair|mobile_phone)$"]', category: 'local_services' },
  { filter: '["amenity"~"^(motorcycle_rental|bicycle_rental|car_rental)$"]', category: 'local_services' },
];

const wanted = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

for (const city of CITIES.filter((c) => wanted.length === 0 || wanted.includes(c.city))) {
  const [w, s, e, n] = city.bbox;
  const body = TAGS.map((t) => `nwr${t.filter}["name"](${s},${w},${n},${e});`).join('\n');
  const query = `[out:json][timeout:120];(\n${body}\n);out center tags;`;
  console.log(`querying Overpass for ${city.name}...`);
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'receipts-hackathon/0.1 (places import)' },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) {
    console.error(`${city.name}: Overpass returned ${res.status}`);
    continue;
  }
  const data = (await res.json()) as { elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] };
  const places: OsmPlace[] = [];
  for (const el of data.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const tags = el.tags ?? {};
    if (!lat || !lng || !tags.name) continue;
    const category =
      TAGS.find((t) => {
        const m = /\["(\w+)"~"\^\((.+)\)\$"\]/.exec(t.filter);
        return m && m[2]!.split('|').includes(tags[m[1]!] ?? '');
      })?.category ?? 'food';
    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'] ?? tags['addr:city']].filter(Boolean).join(', ');
    places.push({ osm_id: `${el.type}/${el.id}`, name: tags.name, category, lat, lng, address: address || undefined });
  }
  writeFileSync(join(OUT, `${city.city}.json`), JSON.stringify(places, null, 1));
  console.log(`${city.name}: ${places.length} places`);
  await new Promise((r) => setTimeout(r, 5000));
}
