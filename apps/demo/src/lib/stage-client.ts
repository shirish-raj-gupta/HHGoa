'use client';

import { BASE_PATH } from './env';

// Browser side of the stage routes: the operator token (when the stage has one) and the SSE reader for /api/run.

const TOKEN_KEY = 'receipts.demoToken';

export function getToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(t: string) {
  try {
    window.localStorage.setItem(TOKEN_KEY, t);
  } catch {
    // private window: the token lasts for this page only
  }
}

export class StageAuthError extends Error {}

function headers(): Record<string, string> {
  const t = getToken();
  return { 'content-type': 'application/json', ...(t ? { 'x-demo-token': t } : {}) };
}

export async function operator<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_PATH}${path}`, { method: 'POST', headers: headers(), body: '{}' });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) throw new StageAuthError(data.error ?? 'operator token needed');
  if (!res.ok) throw new Error(data.error ?? `${path} failed (${res.status})`);
  return data;
}

/** POST /api/run and hand each server-sent event to onEvent as it arrives. */
export async function runStage(question: string, onEvent: (event: string, data: unknown) => void, signal?: AbortSignal) {
  const res = await fetch(`${BASE_PATH}/api/run`, { method: 'POST', headers: headers(), body: JSON.stringify({ question }), signal });
  if (res.status === 401) throw new StageAuthError('operator token needed');
  if (!res.ok || !res.body) throw new Error(`run failed (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}
