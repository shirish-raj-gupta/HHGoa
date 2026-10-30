import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { merchantIdFor } from '@receipts/core';
import type { Db } from '../client';

// Places imported from OpenStreetMap by scripts/osm-import.ts. OpenStreetMap data is © OpenStreetMap
// contributors under the ODbL: attribute it wherever places are shown, and check the share-alike terms before
// publishing a combined places database.

export interface OsmPlace {
  osm_id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  address?: string;
}

const DATA_DIR = fileURLToPath(new URL('../../data/places', import.meta.url));

export async function seedPlaces(db: Db, cityIds: string[]): Promise<number> {
  let n = 0;
  for (const city of cityIds) {
    const file = join(DATA_DIR, `${city}.json`);
    if (!existsSync(file)) continue;
    const places = JSON.parse(readFileSync(file, 'utf8')) as OsmPlace[];
    for (const p of places) {
      const id = merchantIdFor({ brandId: 'local', cityId: city, externalId: `osm:${p.osm_id}`, name: p.name });
      await db.query(
        `INSERT INTO merchants (id, brand_id, city_id, category_id, name, address, geom, source, osm_id)
         VALUES ($1, 'local', $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, 'osm', $8)
         ON CONFLICT (id) DO NOTHING`,
        [id, city, p.category, p.name, p.address ?? null, p.lng, p.lat, p.osm_id],
      );
      n++;
    }
  }
  return n;
}
