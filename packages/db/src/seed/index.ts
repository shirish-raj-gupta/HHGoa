import { CITIES } from '@receipts/core';
import type { Db } from '../client';
import { seedBase } from './base';
import { seedDemoHistory } from './demo';
import { seedPlaces } from './places';

export { seedBase } from './base';
export { seedPlaces, type OsmPlace } from './places';
export { seedDemoHistory, plantedRingWallets, demoWallet, DEMO_MERCHANTS } from './demo';

export interface SeedOptions {
  /** Labelled simulated history (fictional merchants only). On by default outside production. */
  demoHistory?: boolean;
  places?: boolean;
  log?: (m: string) => void;
}

export async function seedAll(db: Db, opts: SeedOptions = {}): Promise<void> {
  const log = opts.log ?? console.log;
  await seedBase(db);
  log('seeded cities, categories and the brand registry');
  if (opts.places ?? true) {
    const n = await seedPlaces(db, CITIES.map((c) => c.city));
    if (n) log(`seeded ${n} OpenStreetMap places`);
  }
  const already = await db.maybe<{ n: string }>('SELECT count(*)::text AS n FROM reviews WHERE simulated');
  if ((opts.demoHistory ?? true) && Number(already?.n ?? 0) === 0) await seedDemoHistory(db, { log });
}
