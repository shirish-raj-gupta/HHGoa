import type { Env } from './config';

// Voice notes to text with Sarvam's speech-to-text (Saaras). 22 Indian languages plus English; codemix mode keeps
// Hinglish readable. Clips are capped at 15 seconds in the apps, well under the endpoint's 30-second guidance.

export interface Transcript {
  text: string;
  language: string | null;
  provider: 'sarvam';
}

export class VoiceUnavailable extends Error {
  constructor() {
    super('speech-to-text is not configured (SARVAM_API_KEY); type the review instead');
    this.name = 'VoiceUnavailable';
  }
}

export async function transcribe(
  env: Env,
  audio: Uint8Array,
  opts: { mime: string; languageHint?: string | null; keyterms?: string[] } = { mime: 'audio/webm' },
): Promise<Transcript> {
  if (!env.SARVAM_API_KEY) throw new VoiceUnavailable();
  const model = env.SARVAM_MODEL;
  const form = new FormData();
  const ext = opts.mime.includes('mp4') || opts.mime.includes('m4a') ? 'm4a' : opts.mime.includes('wav') ? 'wav' : opts.mime.includes('ogg') ? 'ogg' : 'webm';
  form.append('file', new Blob([new Uint8Array(audio)], { type: opts.mime }), `note.${ext}`);
  form.append('model', model);
  form.append('language_code', opts.languageHint ?? 'unknown');
  if (model === 'saaras:v3') form.append('mode', env.SARVAM_MODE);
  // saaras:v4 can be biased toward the dish and merchant names in the proven order.
  if (model.startsWith('saaras:v4') && opts.keyterms?.length) {
    form.append('keyterms', JSON.stringify(opts.keyterms.map((k) => k.slice(0, 64)).slice(0, 50)));
  }
  const res = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: { 'api-subscription-key': env.SARVAM_API_KEY },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Sarvam speech-to-text failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { transcript?: string; language_code?: string | null };
  return { text: (data.transcript ?? '').trim(), language: data.language_code ?? null, provider: 'sarvam' };
}
