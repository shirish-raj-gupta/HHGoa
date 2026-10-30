import { z } from 'zod';

/** A city is one config row plus a places dataset, so the same build serves several cities. */
export const CityConfig = z.object({
  city: z.string().regex(/^[a-z_]+$/),
  name: z.string(),
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  center: z.tuple([z.number(), z.number()]),
  timezone: z.string(),
  /** Check each against the speech model's language list. */
  languages: z.array(z.string()),
  currency: z.string().default('INR'),
  places_source: z.string().default('google'),
  min_receipts_to_rank: z.number().int().positive().default(3),
  status: z.enum(['live', 'seeded', 'planned']).default('planned'),
  /** Named localities used to resolve "near Calangute" without a geocoder. [name, lat, lng] */
  localities: z.array(z.tuple([z.string(), z.number(), z.number()])).default([]),
});
export type CityConfig = z.infer<typeof CityConfig>;

export const CITIES: CityConfig[] = [
  {
    city: 'goa',
    name: 'Goa',
    bbox: [73.68, 14.89, 74.34, 15.8],
    center: [73.7554, 15.5439],
    timezone: 'Asia/Kolkata',
    languages: ['en-IN', 'hi-IN', 'mr-IN', 'kok-IN'],
    currency: 'INR',
    places_source: 'google',
    min_receipts_to_rank: 3,
    status: 'live',
    localities: [
      ['Calangute', 15.5439, 73.7554],
      ['Baga', 15.5553, 73.7517],
      ['Candolim', 15.5182, 73.7621],
      ['Anjuna', 15.5733, 73.7407],
      ['Vagator', 15.5973, 73.7448],
      ['Panaji', 15.4909, 73.8278],
      ['Panjim', 15.4909, 73.8278],
      ['Mapusa', 15.5915, 73.8089],
      ['Margao', 15.2832, 73.9862],
      ['Vasco', 15.3982, 73.8113],
      ['Colva', 15.2793, 73.9223],
      ['Palolem', 15.01, 74.0232],
      ['Morjim', 15.6283, 73.7344],
      ['Arambol', 15.6869, 73.7046],
      ['Dona Paula', 15.4558, 73.8045],
      ['Goa airport', 15.3808, 73.8314],
      ['Mopa airport', 15.7393, 73.8647],
    ],
  },
  {
    city: 'bengaluru',
    name: 'Bengaluru',
    bbox: [77.37, 12.73, 77.88, 13.17],
    center: [77.5946, 12.9716],
    timezone: 'Asia/Kolkata',
    languages: ['en-IN', 'kn-IN', 'hi-IN', 'ta-IN', 'te-IN'],
    currency: 'INR',
    places_source: 'google',
    min_receipts_to_rank: 3,
    status: 'seeded',
    localities: [
      ['Koramangala', 12.9352, 77.6245],
      ['Indiranagar', 12.9784, 77.6408],
      ['HSR Layout', 12.9116, 77.6474],
      ['Whitefield', 12.9698, 77.75],
      ['Jayanagar', 12.925, 77.5938],
      ['MG Road', 12.9756, 77.6067],
      ['Malleshwaram', 13.0035, 77.5647],
      ['Electronic City', 12.8452, 77.6602],
    ],
  },
  {
    city: 'mumbai',
    name: 'Mumbai',
    bbox: [72.77, 18.89, 73.03, 19.28],
    center: [72.8777, 19.076],
    timezone: 'Asia/Kolkata',
    languages: ['en-IN', 'hi-IN', 'mr-IN', 'gu-IN'],
    currency: 'INR',
    places_source: 'google',
    min_receipts_to_rank: 3,
    status: 'seeded',
    localities: [
      ['Bandra', 19.0596, 72.8295],
      ['Andheri', 19.1136, 72.8697],
      ['Powai', 19.1176, 72.906],
      ['Colaba', 18.9067, 72.8147],
      ['Lower Parel', 18.9953, 72.8306],
      ['Juhu', 19.1075, 72.8263],
      ['Dadar', 19.0178, 72.8478],
    ],
  },
  {
    city: 'delhi',
    name: 'Delhi',
    bbox: [76.84, 28.4, 77.35, 28.88],
    center: [77.209, 28.6139],
    timezone: 'Asia/Kolkata',
    languages: ['en-IN', 'hi-IN', 'pa-IN', 'ur-IN'],
    currency: 'INR',
    places_source: 'google',
    min_receipts_to_rank: 3,
    status: 'seeded',
    localities: [
      ['Connaught Place', 28.6315, 77.2167],
      ['Hauz Khas', 28.5494, 77.2001],
      ['Saket', 28.5245, 77.2066],
      ['Karol Bagh', 28.6519, 77.1909],
      ['Lajpat Nagar', 28.5677, 77.2433],
      ['Chandni Chowk', 28.6506, 77.2303],
      ['Dwarka', 28.5921, 77.046],
    ],
  },
];

/** Resolve "near Calangute" to coordinates and a city using the configured localities. */
export function findLocality(text: string, cities: CityConfig[] = CITIES): { city: string; name: string; lat: number; lng: number } | null {
  const t = text.toLowerCase();
  let best: { city: string; name: string; lat: number; lng: number } | null = null;
  for (const c of cities) {
    for (const [name, lat, lng] of c.localities) {
      if (t.includes(name.toLowerCase()) && (!best || name.length > best.name.length)) best = { city: c.city, name, lat, lng };
    }
    if (!best && t.includes(c.name.toLowerCase())) best = { city: c.city, name: c.name, lat: c.center[1], lng: c.center[0] };
  }
  return best;
}

export function cityForPoint(lat: number, lng: number, cities: CityConfig[] = CITIES): CityConfig | null {
  return cities.find((c) => lng >= c.bbox[0] && lat >= c.bbox[1] && lng <= c.bbox[2] && lat <= c.bbox[3]) ?? null;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
