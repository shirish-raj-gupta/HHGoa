import { createHash } from 'node:crypto';
import { UserError, type Engine } from './context';
import { getReceipt } from './reviews';

// Read-aloud with Smallest AI's Lightning text to speech (SMALLEST_API_KEY, on the server only). Only what Receipts has
// published is spoken, a review or an answer looked up by its id, never text a caller sends, so the key cannot be used
// as a free speech service. Each clip is kept in memory: a review always sounds the same, and is paid for once.

const ENDPOINT = 'https://api.smallest.ai/waves/v1/tts';
const MODEL = 'lightning_v3.1_pro';
const MAX_CHARS = 700;

// Lightning v3.1 Pro voices. Indian English and Hindi share one voice that switches between them; each other Indian
// language it covers has its own (Bengali has only men's voices).
const VOICES: Record<string, string> = {
  en: 'meher',
  hi: 'meher',
  mr: 'mrunal',
  ta: 'malar',
  ml: 'parvathy',
  te: 'sravani',
  kn: 'spoorthi',
  pa: 'jasleen',
  bn: 'rajib',
  or: 'sasmita',
  gu: 'krupa',
};

const cache = new Map<string, ArrayBuffer>();
const CACHE_MAX = 200;

export function speechEnabled(e: Engine): boolean {
  return !!e.env.SMALLEST_API_KEY;
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= MAX_CHARS ? t : `${t.slice(0, MAX_CHARS).replace(/\s+\S*$/, '')}…`;
}

async function synthesize(e: Engine, text: string, language: string): Promise<ArrayBuffer> {
  if (!e.env.SMALLEST_API_KEY) throw new UserError('Read-aloud is not set up on this server.', 503, 'not_configured');
  const key = createHash('sha256').update(`${MODEL}|${language}|${text}`).digest('hex');
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${e.env.SMALLEST_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text, voice_id: VOICES[language] ?? VOICES.en, model: MODEL, language, sample_rate: 24000, speed: 1, output_format: 'mp3' }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res?.ok) {
    e.log.warn('read-aloud failed', res ? `Smallest AI answered ${res.status}` : 'Smallest AI did not answer');
    throw new UserError('Read-aloud is unavailable just now. Try again in a moment.', 502, 'speech_failed');
  }
  const audio = await res.arrayBuffer();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, audio);
  return audio;
}

/** A published review: in the reviewer's own words and language where a voice speaks it, otherwise its English card.
 *  A simulated review says so first, as it does on the page. */
export async function speakReview(e: Engine, idOrUid: string): Promise<ArrayBuffer> {
  const r = await getReceipt(e, idOrUid);
  if (r.hidden) throw new UserError('The text of this review is hidden.', 404, 'hidden');
  const label = r.simulated ? 'A simulated demo review. ' : '';
  const lang = (r.language ?? 'en').split('-')[0]!.toLowerCase();
  if (r.transcript && lang !== 'en' && VOICES[lang]) return synthesize(e, clip(`${label}${r.transcript}`), lang);
  const card = r.summary_en ?? r.claims.join('. ');
  return synthesize(e, clip(`${label}${r.item.name} at ${r.merchant.name}. ${r.rating} out of 5. ${card}`), 'en');
}

/** An answer Receipts gave (the summary at its top), by its id. */
export async function speakAnswer(e: Engine, answerId: string): Promise<ArrayBuffer> {
  const row = await e.db.maybe<{ response: { summary?: string } | null }>('SELECT response FROM answers WHERE id = $1', [answerId]);
  const summary = row?.response?.summary;
  if (!summary) throw new UserError('answer not found', 404);
  return synthesize(e, clip(summary), 'en');
}
