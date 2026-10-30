import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

// AES-256-GCM for proof blobs and voice notes (iv | tag | ciphertext), HMAC for API keys, JWT for sessions.

export function deriveKey(secretOrKey: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(secretOrKey)) return Buffer.from(secretOrKey, 'hex');
  const b64 = Buffer.from(secretOrKey, 'base64');
  if (b64.length === 32) return b64;
  return createHash('sha256').update(`receipts-data-key|${secretOrKey}`).digest();
}

export function encrypt(plain: Uint8Array, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decrypt(blob: Uint8Array, key: Buffer): Buffer {
  const buf = Buffer.from(blob);
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/** One session per wallet, for reviewing and for running a business alike: what a wallet may touch is decided by
 *  ownership checks in the engine, not by the kind of session. */
export interface SessionClaims {
  sub: string;
  reviewerId?: string;
}

export async function signSession(claims: SessionClaims, secret: string, ttl = '30d'): Promise<string> {
  return new SignJWT({ reviewerId: claims.reviewerId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret));
}

export async function verifySession(token: string, secret: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return { sub: String(payload.sub), reviewerId: payload.reviewerId as string | undefined };
  } catch {
    return null;
  }
}
