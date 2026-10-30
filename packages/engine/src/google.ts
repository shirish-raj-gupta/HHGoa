import { CITIES, type CityConfig } from '@receipts/core';
import { inIndia, type Box } from './cities';
import { UserError, type Engine } from './context';

// Google Maps Platform, server-side only (GOOGLE_MAPS_API_KEY never reaches a browser): Places API (New) text search
// and details, and Static Maps images proxied through our API. Every place shown says it is from Google Maps, and
// links to it. Place IDs may be stored indefinitely; names, addresses and locations are refreshed within 30 days.

export interface GooglePlace {
  placeId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** Google's own words for the kind of place ("South Indian restaurant"). */
  kind: string | null;
  primaryType: string | null;
  mapsUrl: string | null;
  open: boolean;
}

const FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'primaryType', 'primaryTypeDisplayName', 'googleMapsUri', 'businessStatus'];

interface RawPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  googleMapsUri?: string;
  businessStatus?: string;
}

function key(e: Engine): string {
  if (!e.env.GOOGLE_MAPS_API_KEY) throw new UserError('Place search is not set up on this server (GOOGLE_MAPS_API_KEY).', 400, 'not_configured');
  return e.env.GOOGLE_MAPS_API_KEY;
}

function toPlace(p: RawPlace): GooglePlace | null {
  if (!p.id || !p.location) return null;
  return {
    placeId: p.id,
    name: p.displayName?.text ?? 'Unnamed place',
    address: p.formattedAddress ?? null,
    lat: p.location.latitude,
    lng: p.location.longitude,
    kind: p.primaryTypeDisplayName?.text ?? null,
    primaryType: p.primaryType ?? null,
    mapsUrl: p.googleMapsUri ?? null,
    open: p.businessStatus !== 'CLOSED_PERMANENTLY',
  };
}

async function google<T>(e: Engine, url: string, init: { method?: string; body?: unknown; fields: string }): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key(e), 'X-Goog-FieldMask': init.fields },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
    e.log.warn(`google places ${res.status}`, detail);
    throw new UserError(`Google Maps did not answer (${res.status}). Try again in a moment.`, 502, 'google');
  }
  return (await res.json()) as T;
}

/** Places matching a text inside an area (a city's box, or a configured city), or anywhere in India. */
export async function searchPlaces(e: Engine, input: { query: string; cityId?: string | null; box?: Box | null; max?: number }): Promise<GooglePlace[]> {
  const box: Box | null = input.box ?? CITIES.find((c: CityConfig) => c.city === input.cityId)?.bbox ?? null;
  const body: Record<string, unknown> = { textQuery: input.query.slice(0, 200), maxResultCount: Math.min(input.max ?? 6, 10), languageCode: 'en', regionCode: 'IN' };
  if (box) {
    const [minLng, minLat, maxLng, maxLat] = box;
    body.locationRestriction = { rectangle: { low: { latitude: minLat, longitude: minLng }, high: { latitude: maxLat, longitude: maxLng } } };
  }
  const res = await google<{ places?: RawPlace[] }>(e, 'https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    body,
    fields: FIELDS.map((f) => `places.${f}`).join(','),
  });
  return (res.places ?? []).map(toPlace).filter((p): p is GooglePlace => !!p && p.open);
}

/** One place by ID, fresh from Google: what we trust when a reviewer or a business picks a place. */
export async function placeDetails(e: Engine, placeId: string): Promise<GooglePlace> {
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) throw new UserError('That is not a Google place ID.', 400);
  const raw = await google<RawPlace>(e, `https://places.googleapis.com/v1/places/${placeId}`, { fields: FIELDS.join(',') });
  const place = toPlace(raw);
  if (!place) throw new UserError('Google Maps has no location for that place.', 404);
  return place;
}

/** A small map image around a point, fetched with our key. Only points in India, so the proxy cannot be used as a
 *  free map service for anywhere else. */
export async function staticMap(e: Engine, input: { lat: number; lng: number; zoom?: number }): Promise<ArrayBuffer> {
  const { lat, lng } = input;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inIndia(lat, lng)) throw new UserError('Maps are only drawn for places in India.', 400);
  const zoom = Math.min(18, Math.max(12, Math.round(input.zoom ?? 16)));
  const q = new URLSearchParams({ center: `${lat},${lng}`, zoom: String(zoom), size: '320x180', scale: '2', markers: `color:0x02142d|${lat},${lng}`, key: key(e) });
  const res = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${q}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) throw new UserError('Google Maps did not return a map.', 502, 'google');
  return res.arrayBuffer();
}

/** Our category for a Google place type (for a listing a business adds from Google). */
export function categoryForPlaceType(type: string | null | undefined): string {
  const t = type ?? '';
  if (/restaurant|cafe|bakery|bar$|food|meal|coffee|tea|ice_cream|dessert|pizza|sandwich|juice/.test(t)) return 'food';
  if (/grocery|supermarket|convenience|market/.test(t)) return 'groceries';
  if (/lodging|hotel|hostel|guest_house|resort|motel|bed_and_breakfast|travel_agency|car_rental/.test(t)) return 'travel';
  if (/store|shop|mall|pharmacy/.test(t)) return 'products';
  return 'local_services';
}
