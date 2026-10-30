import { canonicalJson, cidOfBytes } from '@receipts/core';
import type { Db } from '@receipts/db';
import type { Env } from './config';
import { decrypt, encrypt } from './crypto';
import type { Logger } from './log';

// Content-addressed storage. Every review JSON and encrypted proof blob is stored by its CIDv1 (raw, sha2-256)
// in Postgres and, when PINATA_JWT is set, pinned to IPFS. Anyone can recompute the CID from the bytes.

export class Storage {
  private pinata: unknown | null = null;

  constructor(
    private db: Db,
    private env: Env,
    private key: Buffer,
    private log: Logger,
  ) {}

  private async pinClient() {
    if (!this.env.PINATA_JWT) return null;
    if (!this.pinata) {
      const { PinataSDK } = await import('pinata');
      this.pinata = new PinataSDK({ pinataJwt: this.env.PINATA_JWT, pinataGateway: this.env.PINATA_GATEWAY });
    }
    return this.pinata as { upload: { public: { file(f: File): Promise<{ cid: string }> } } };
  }

  async putBytes(bytes: Uint8Array, contentType: string): Promise<string> {
    const cid = await cidOfBytes(bytes);
    await this.db.query('INSERT INTO content (cid, bytes, content_type) VALUES ($1, $2, $3) ON CONFLICT (cid) DO NOTHING', [cid, bytes, contentType]);
    return cid;
  }

  async putJson(value: unknown): Promise<{ cid: string; json: string }> {
    const json = canonicalJson(value);
    const cid = await this.putBytes(new TextEncoder().encode(json), 'application/json');
    return { cid, json };
  }

  /** Pin to IPFS. Best effort: the content stays served from /v1/content/:cid either way. */
  async pin(cid: string): Promise<boolean> {
    const client = await this.pinClient();
    if (!client) return false;
    const row = await this.db.maybe<{ bytes: Buffer; content_type: string; pinned: boolean }>('SELECT bytes, content_type, pinned FROM content WHERE cid = $1', [cid]);
    if (!row || row.pinned) return !!row?.pinned;
    try {
      const file = new File([new Uint8Array(row.bytes)], `${cid}.json`, { type: row.content_type });
      const res = await client.upload.public.file(file);
      if (res.cid !== cid) this.log.warn('pinning service returned a different CID (chunking differs); our CID stays canonical', { ours: cid, theirs: res.cid });
      await this.db.query('UPDATE content SET pinned = true WHERE cid = $1', [cid]);
      return true;
    } catch (e) {
      this.log.warn('IPFS pin failed', e);
      return false;
    }
  }

  async get(cid: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const row = await this.db.maybe<{ bytes: Buffer; content_type: string }>('SELECT bytes, content_type FROM content WHERE cid = $1', [cid]);
    if (row) return { bytes: Buffer.from(row.bytes), contentType: row.content_type };
    if (this.env.PINATA_GATEWAY) {
      const res = await fetch(`https://${this.env.PINATA_GATEWAY}/ipfs/${cid}`).catch(() => null);
      if (res?.ok) return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
    }
    return null;
  }

  async getJson<T>(cid: string): Promise<T | null> {
    const c = await this.get(cid);
    return c ? (JSON.parse(c.bytes.toString('utf8')) as T) : null;
  }

  /** Proof blobs are encrypted before storage: auditors can re-verify on request, nobody can browse them. */
  async putEncrypted(value: unknown): Promise<string> {
    return this.putBytes(encrypt(new TextEncoder().encode(canonicalJson(value)), this.key), 'application/octet-stream');
  }

  async getDecrypted<T>(cid: string): Promise<T | null> {
    const c = await this.get(cid);
    return c ? (JSON.parse(decrypt(c.bytes, this.key).toString('utf8')) as T) : null;
  }

  encryptBytes(bytes: Uint8Array): Buffer {
    return encrypt(bytes, this.key);
  }

  decryptBytes(bytes: Uint8Array): Buffer {
    return decrypt(bytes, this.key);
  }
}
