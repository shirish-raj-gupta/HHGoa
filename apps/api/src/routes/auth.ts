import { Hono } from 'hono';
import { getAddress, verifyMessage, type Hex } from 'viem';
import { UserError, identity, randomToken, signSession, type Engine } from '@receipts/engine';
import { body, ok, rateLimit, type Env } from '../http';

// Wallet sign-in: the app asks for a nonce, the wallet signs a short message, the API returns a session token.
// The wallet address is the only public identity, and one account: the same session reviews purchases and runs a
// business (older apps still send a role; it is ignored).

function message(address: string, nonce: string, issued: string): string {
  return `Receipts sign-in\nWallet: ${address}\nNonce: ${nonce}\nIssued: ${issued}`;
}

export function authRoutes(e: Engine) {
  const app = new Hono<Env>();

  app.post('/nonce', rateLimit('nonce', 30), async (c) => {
    const { address } = await body<{ address: string }>(c);
    const nonce = randomToken(12);
    const issued = new Date().toISOString();
    await e.db.query('INSERT INTO auth_nonces (nonce) VALUES ($1)', [nonce]);
    return ok(c, { nonce, issued, message: message(getAddress(address), nonce, issued) });
  });

  app.post('/verify', rateLimit('verify', 30), async (c) => {
    const { address, nonce, issued, signature } = await body<{ address: string; nonce: string; issued: string; signature: Hex }>(c);
    const row = await e.db.maybe<{ used: boolean; created_at: Date }>('SELECT used, created_at FROM auth_nonces WHERE nonce = $1', [nonce]);
    if (!row || row.used || Date.now() - new Date(row.created_at).getTime() > 10 * 60_000) throw new UserError('Sign-in expired; try again.', 401, 'nonce');
    const wallet = getAddress(address);
    const text = message(wallet, nonce, issued);
    let valid = await verifyMessage({ address: wallet, message: text, signature }).catch(() => false);
    if (!valid && e.chain.publicClient) valid = await e.chain.publicClient.verifyMessage({ address: wallet, message: text, signature }).catch(() => false);
    if (!valid) throw new UserError('Signature does not match the wallet.', 401, 'bad_signature');
    await e.db.query('UPDATE auth_nonces SET used = true WHERE nonce = $1', [nonce]);
    const reviewer = await identity.reviewerByWallet(e, wallet);
    const token = await signSession({ sub: wallet.toLowerCase(), reviewerId: reviewer?.id }, e.env.SESSION_SECRET);
    return ok(c, { token, wallet: wallet.toLowerCase(), human: !!reviewer, reviewerId: reviewer?.id ?? null });
  });

  return app;
}
