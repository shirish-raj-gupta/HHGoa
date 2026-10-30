import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';

/** Deterministic JSON: sorted object keys, no whitespace, undefined dropped. Same bytes everywhere. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return value.toString();
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortDeep(v)));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = sortDeep(v);
  }
  return out;
}

/**
 * CIDv1, raw codec, sha2-256: the same CID IPFS gives a single-block file added with CIDv1 (raw leaves).
 * Anyone can recompute it from the bytes, so the on-chain contentCID pins the exact review JSON.
 */
export async function cidOfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await sha256.digest(bytes);
  return CID.create(1, raw.code, digest).toString();
}

export async function contentAddress(value: unknown): Promise<{ cid: string; json: string; bytes: Uint8Array }> {
  const json = canonicalJson(value);
  const bytes = new TextEncoder().encode(json);
  return { cid: await cidOfBytes(bytes), json, bytes };
}

export function isCid(value: string): boolean {
  try {
    CID.parse(value);
    return true;
  } catch {
    return false;
  }
}
