import { keccak256, toBytes, getAddress, type Address, type Hex } from 'viem';
import { nullifierToBytes32, reviewerIdFromNullifier } from '@receipts/core';
import { UserError, type Engine } from './context';
import { loadAnonAadhaarCore } from './vendor/anon-aadhaar';

// Prove one human, once. Receipts stores a nullifier hash, the document type, the verification time and a wallet;
// never the Aadhaar number, a name, a photo or passport data. The verifier key then registers
// reviewerId -> wallet in PersonhoodRegistry; a second wallet for the same human is refused, and a fresh proof with
// the same nullifier from a new phone moves the binding instead.

export type IdType = 'self_passport' | 'self_eu_id' | 'self_aadhaar' | 'self_other' | 'anon_aadhaar' | 'mock' | 'simulated';

const ID_TYPE_CODE: Record<IdType, number> = {
  self_passport: 1,
  self_eu_id: 2,
  self_aadhaar: 3,
  self_other: 4,
  anon_aadhaar: 5,
  mock: 9,
  simulated: 10,
};

export interface ReviewerRow {
  id: Hex;
  wallet: string;
  id_type: IdType;
  nullifier_hash: Hex;
  level: number;
  reliability: number;
  registry_tx: string | null;
  simulated: boolean;
  created_at: string;
}

export async function reviewerByWallet(e: Engine, wallet: string): Promise<ReviewerRow | null> {
  return e.db.maybe<ReviewerRow>('SELECT * FROM reviewers WHERE wallet = $1', [wallet.toLowerCase()]);
}

export async function requireHuman(e: Engine, wallet: string): Promise<ReviewerRow> {
  const r = await reviewerByWallet(e, wallet);
  if (!r) throw new UserError('Prove you are one unique human first (one time).', 403, 'not_human');
  return r;
}

/** Register (or move) a verified human. Idempotent for the same wallet. */
export async function registerHuman(e: Engine, input: { nullifier: string; idType: IdType; wallet: string }): Promise<ReviewerRow & { rebound: boolean }> {
  const wallet = getAddress(input.wallet);
  const nullifierHash = nullifierToBytes32(input.nullifier);
  const reviewerId = reviewerIdFromNullifier(nullifierHash);
  const byNullifier = await e.db.maybe<ReviewerRow>('SELECT * FROM reviewers WHERE nullifier_hash = $1', [nullifierHash]);
  const byWallet = await reviewerByWallet(e, wallet);

  if (byNullifier && byNullifier.wallet === wallet.toLowerCase()) return { ...byNullifier, rebound: false };
  if (byWallet && byWallet.nullifier_hash !== nullifierHash) {
    throw new UserError('This wallet is already bound to another verified human.', 409, 'wallet_in_use');
  }

  if (byNullifier) {
    // Changing phones: same human, new wallet. Old reviews stay attributed to the same reviewerId.
    let tx: string | null = null;
    if (e.chain.canOperate) {
      tx = await e.chain.rebindHuman(nullifierHash, wallet);
      e.chain.migrateReputation(reviewerId).catch((err) => e.log.warn('reputation migrate failed', err));
    }
    const row = await e.db.one<ReviewerRow>('UPDATE reviewers SET wallet = $1, registry_tx = COALESCE($2, registry_tx) WHERE id = $3 RETURNING *', [
      wallet.toLowerCase(),
      tx,
      reviewerId,
    ]);
    await e.events.emit('human.rebound', { reviewerId });
    return { ...row, rebound: true };
  }

  let tx: string | null = null;
  if (e.chain.canOperate) {
    try {
      tx = await e.chain.registerHuman(nullifierHash, wallet, ID_TYPE_CODE[input.idType]);
    } catch (err) {
      // Already registered on-chain (e.g. the database was reset): carry on with the off-chain record.
      const onChain = await e.chain.reviewerIdOf(wallet).catch(() => null);
      if (onChain !== reviewerId) throw err;
    }
  }
  const row = await e.db.one<ReviewerRow>(
    `INSERT INTO reviewers (id, nullifier_hash, id_type, wallet, registry_tx, simulated) VALUES ($1, $2, $3, $4, $5, false) RETURNING *`,
    [reviewerId, nullifierHash, input.idType, wallet.toLowerCase(), tx],
  );
  await e.events.emit('human.verified', { reviewerId, idType: input.idType, tx });
  return { ...row, rebound: false };
}

/** Local chains restart with the process; re-register every real human so their reviews keep anchoring. */
export async function syncRegistry(e: Engine): Promise<number> {
  if (!e.chain.canOperate || e.chain.mode !== 'local') return 0;
  const rows = await e.db.query<ReviewerRow>(`SELECT * FROM reviewers WHERE NOT simulated`);
  let n = 0;
  for (const r of rows) {
    if (await e.chain.reviewerIdOf(r.wallet as Address)) continue;
    await e.chain.registerHuman(r.nullifier_hash, r.wallet as Address, ID_TYPE_CODE[r.id_type] ?? 9).catch(() => null);
    n++;
  }
  return n;
}

// Self ------------------------------------------------------------------------------------------------------

const SELF_ID_TYPE: Record<number, IdType> = { 1: 'self_passport', 2: 'self_eu_id', 3: 'self_aadhaar' };

/**
 * The Self app posts { attestationId, proof, publicSignals, userContextData } to SELF_ENDPOINT. The proof is made
 * on the phone; we verify it, read the app-scoped nullifier and the wallet that was encoded as the user ID.
 */
export async function verifySelf(e: Engine, body: { attestationId: number; proof: unknown; publicSignals: unknown[]; userContextData: string }) {
  const { SelfBackendVerifier, AllIds, DefaultConfigStore } = await import('@selfxyz/core');
  const verifier = new SelfBackendVerifier(
    e.env.SELF_SCOPE,
    e.env.SELF_ENDPOINT,
    e.env.SELF_MOCK_PASSPORT,
    AllIds,
    new DefaultConfigStore({ ofac: false }),
    'hex',
  );
  const result = await verifier.verify(body.attestationId as never, body.proof as never, body.publicSignals as never, body.userContextData);
  if (!result.isValidDetails.isValid) throw new UserError('The Self proof did not verify.', 422, 'self_invalid');
  const id = result.userData.userIdentifier.replace(/^0x/, '');
  const wallet = getAddress(`0x${id.slice(-40).padStart(40, '0')}`);
  return registerHuman(e, {
    nullifier: String(result.discloseOutput.nullifier),
    idType: SELF_ID_TYPE[Number(result.attestationId)] ?? 'self_other',
    wallet,
  });
}

// Anon Aadhaar (browser fallback) ----------------------------------------------------------------------------

interface AnonAadhaarCoreModule {
  init(args: { wasmURL: string; zkeyURL: string; vkeyURL: string; artifactsOrigin: number }): Promise<void>;
  artifactUrls: { v2: { wasm: string; zkey: string; vk: string } };
  ArtifactsOrigin: { server: number };
  deserialize(serialized: string): Promise<{ proof: { nullifierSeed: string; signalHash: string; timestamp: string; nullifier: string } }>;
  verify(pcd: unknown, useTestAadhaar?: boolean): Promise<boolean>;
  hash(message: bigint | string): string;
}

/**
 * The browser proves the mAadhaar secure QR. We verify the Groth16 proof, the app's nullifier seed, the wallet as
 * the signal, and that the QR was signed within the last hour (blocks farms of old photocopied QRs).
 */
export async function verifyAnonAadhaar(e: Engine, input: { pcd: string; wallet: string }) {
  // @anon-aadhaar/core ships TypeScript sources as its types; the plain-JS loader keeps them out of our typecheck.
  const core = (await loadAnonAadhaarCore()) as AnonAadhaarCoreModule;
  await core.init({
    wasmURL: core.artifactUrls.v2.wasm,
    zkeyURL: core.artifactUrls.v2.zkey,
    vkeyURL: core.artifactUrls.v2.vk,
    artifactsOrigin: core.ArtifactsOrigin.server,
  });
  const parsed = JSON.parse(input.pcd) as { pcd?: string };
  const pcd = await core.deserialize(parsed.pcd ?? input.pcd);
  const ok = await core.verify(pcd, e.env.ANON_AADHAAR_TEST_MODE);
  if (!ok) throw new UserError('The Anon Aadhaar proof did not verify.', 422, 'aadhaar_invalid');
  if (String(pcd.proof.nullifierSeed) !== e.env.ANON_AADHAAR_NULLIFIER_SEED) throw new UserError('Proof was made for another app.', 422, 'aadhaar_seed');
  if (String(pcd.proof.signalHash) !== String(core.hash(BigInt(getAddress(input.wallet))))) {
    throw new UserError('Proof is bound to a different wallet.', 422, 'aadhaar_signal');
  }
  const signedAt = Number(pcd.proof.timestamp);
  if (!signedAt || Date.now() / 1000 - signedAt > 3600) {
    throw new UserError('That Aadhaar QR is more than an hour old. Download a fresh one from the mAadhaar app.', 422, 'aadhaar_stale');
  }
  return registerHuman(e, { nullifier: String(pcd.proof.nullifier), idType: 'anon_aadhaar', wallet: input.wallet });
}

/** Rehearsals only (ALLOW_MOCK_IDENTITY): a deterministic, clearly labelled mock human for a wallet. */
export async function mockHuman(e: Engine, wallet: string) {
  if (!e.env.ALLOW_MOCK_IDENTITY) throw new UserError('Mock identity is disabled here.', 403, 'mock_disabled');
  const nullifier: Hex = keccak256(toBytes(`receipts-mock-human|${wallet.toLowerCase()}`));
  return registerHuman(e, { nullifier, idType: 'mock', wallet });
}
