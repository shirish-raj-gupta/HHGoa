import { typedDataFromJson, type MerchantReceipt } from '@receipts/core';
import type {
  Answer,
  AttackResult,
  Badge,
  Brand,
  ClaimStarted,
  Earnings,
  FinalizedDraft,
  FollowupItem,
  Hex,
  HumanResult,
  Insights,
  ItemReputation,
  LeaderboardRow,
  Listing,
  Me,
  MerchantAccount,
  MerchantClaimMethod,
  MerchantReputation,
  MyReview,
  Place,
  ProofRequestStatus,
  PublishResult,
  Rail,
  ReceiptView,
  ReceiptsEvent,
  ReviewCard,
  ServerConfig,
  SignInResult,
  Signing,
  SimulatedPurchaseInput,
  StartedProof,
  Stats,
  VerifyResult,
} from './types';
import type { AdminClaim, AdminHeldReview, AdminOverview, GoogleListing, GooglePlace, PurchaseView } from './types';

export * from './types';

// The typed client for the web, merchant and mobile apps. Agents use MCP or the x402 endpoints instead.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Anything that can sign for the user's wallet: a viem account, a wallet client adapter, an embedded wallet. */
export interface WalletSigner {
  address: string;
  signMessage(args: { message: string }): Promise<Hex>;
  signTypedData(typedData: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }): Promise<Hex>;
}

/** Sign what the API asked for: EIP-712 typed data when the review is anchored on-chain, otherwise a message. */
export async function signFor(signer: WalletSigner, signing: Signing): Promise<Hex> {
  if (signing.kind === 'message') return signer.signMessage({ message: signing.message });
  return signer.signTypedData(typedDataFromJson(signing.typedData) as never);
}

export interface ClientOptions {
  baseUrl: string;
  token?: string | null;
  adminToken?: string | null;
  fetch?: typeof fetch;
  /** Called whenever the session token changes (sign-in, human verification), so the app can persist it. */
  onToken?(token: string | null): void;
}

export class ReceiptsClient {
  readonly baseUrl: string;
  private token: string | null;
  private adminToken: string | null;
  private fetchImpl: typeof fetch;
  private onToken?: (token: string | null) => void;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token ?? null;
    this.adminToken = opts.adminToken ?? null;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.onToken = opts.onToken;
  }

  get sessionToken(): string | null {
    return this.token;
  }

  setToken(token: string | null) {
    this.token = token;
    this.onToken?.(token);
  }

  async request<T>(method: string, path: string, body?: unknown, init: { headers?: Record<string, string>; raw?: BodyInit; admin?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (init.admin && this.adminToken) headers['x-admin-token'] = this.adminToken;
    let payload: BodyInit | undefined = init.raw;
    if (body !== undefined && payload === undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: payload });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const err = (data ?? {}) as { error?: string; code?: string };
      throw new ApiError(res.status, err.error ?? `${method} ${path} failed (${res.status})`, err.code);
    }
    return data as T;
  }

  private get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  private post<T>(path: string, body: unknown = {}) {
    return this.request<T>('POST', path, body);
  }

  // Sign-in -------------------------------------------------------------------------------------------------

  /** Wallet sign-in: nonce, sign, session token. The token is stored on the client. One session per wallet serves
   *  the reviewer apps and the business app alike. */
  async signIn(signer: WalletSigner): Promise<SignInResult> {
    const n = await this.post<{ nonce: string; issued: string; message: string }>('/v1/auth/nonce', { address: signer.address });
    const signature = await signer.signMessage({ message: n.message });
    const res = await this.post<SignInResult>('/v1/auth/verify', { address: signer.address, nonce: n.nonce, issued: n.issued, signature });
    this.setToken(res.token);
    return res;
  }

  signOut() {
    this.setToken(null);
  }

  me() {
    return this.get<Me>('/v1/me');
  }

  // One human ----------------------------------------------------------------------------------------------

  identity = {
    anonAadhaar: async (pcd: string) => this.withToken(await this.post<HumanResult>('/v1/identity/anon-aadhaar', { pcd })),
    mock: async () => this.withToken(await this.post<HumanResult>('/v1/identity/mock')),
    /** After the Self app verifies (its callback goes to the API), pick up the human session. */
    status: async () => {
      const s = await this.get<{ human: boolean; reviewerId: string | null; idType: string | null; token: string | null }>('/v1/identity/status');
      if (s.token) this.setToken(s.token);
      return s;
    },
  };

  private withToken<T extends { token: string }>(res: T): T {
    this.setToken(res.token);
    return res;
  }

  // Proofs --------------------------------------------------------------------------------------------------

  proofs = {
    start: (rail: Rail, input: { brandId?: string; cityId?: string } = {}) => this.post<StartedProof>(`/v1/proofs/${rail}`, { ...input, start: true }),
    status: (proofRequestId: string) => this.get<ProofRequestStatus>(`/v1/proofs/requests/${proofRequestId}`),
    /** Wait for a Reclaim proof to arrive at the API callback. */
    waitFor: async (proofRequestId: string, opts: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {}) => {
      const until = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
      while (Date.now() < until) {
        if (opts.signal?.aborted) throw new ApiError(499, 'cancelled');
        const s = await this.proofs.status(proofRequestId);
        if (s.status !== 'pending') return s;
        await new Promise((r) => setTimeout(r, opts.intervalMs ?? 2000));
      }
      throw new ApiError(408, 'The proof did not arrive in time. Try again.');
    },
    email: (input: { emlBase64?: string; packedProof?: string; brandId?: string; cityId?: string; category?: string }) => this.post<PurchaseView>('/v1/proofs/order_email', input),
    merchantReceipt: (qr: string) => this.post<PurchaseView>('/v1/proofs/merchant_receipt', { qr }),
    onchain: (input: { txHash: Hex; sessionId?: string; payerSignature?: Hex; merchantName?: string; itemName?: string }) => this.post<PurchaseView>('/v1/proofs/onchain_payment', input),
    ondc: (input: { body: string; authorization: string; publicKeyBase64?: string }) => this.post<PurchaseView>('/v1/proofs/network_order', input),
    /** The labelled dev rail (only when the server allows simulated proofs). */
    simulated: (input: SimulatedPurchaseInput) => this.post<PurchaseView>('/v1/proofs/simulated', input),
  };

  purchases = {
    list: () => this.get<PurchaseView[]>('/v1/purchases'),
    get: (id: string) => this.get<PurchaseView>(`/v1/purchases/${id}`),
    /** Google Maps places that could be the shop a UPI payment went to (the payee's name, or `q`). */
    places: (id: string, q?: string) => this.get<GooglePlace[]>(`/v1/purchases/${id}/places${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    /** Pin a UPI payment to the shop it went to. */
    pinPlace: (id: string, placeId: string) => this.post<PurchaseView>(`/v1/purchases/${id}/place`, { placeId }),
  };

  // Reviews -------------------------------------------------------------------------------------------------

  reviews = {
    create: (purchaseId: string, itemId?: Hex) => this.post<ReviewCard>('/v1/reviews', { purchaseId, itemId }),
    get: (draftId: string) => this.get<ReviewCard>(`/v1/reviews/${draftId}`),
    voice: (draftId: string, audio: Blob, opts: { lang?: string } = {}) =>
      this.request<ReviewCard>('POST', `/v1/reviews/${draftId}/audio${opts.lang ? `?lang=${encodeURIComponent(opts.lang)}` : ''}`, undefined, {
        raw: audio,
        headers: { 'content-type': audio.type || 'audio/webm' },
      }),
    text: (draftId: string, text: string, language?: string) => this.post<ReviewCard>(`/v1/reviews/${draftId}/text`, { text, language }),
    finalize: (draftId: string, edits: { rating?: number; itemId?: Hex; claims?: string[] } = {}) => this.post<FinalizedDraft>(`/v1/reviews/${draftId}/finalize`, edits),
    publish: (draftId: string, signature: Hex) => this.post<PublishResult>(`/v1/reviews/${draftId}/publish`, { signature }),
    /** finalize → sign in the wallet → publish */
    signAndPublish: async (draftId: string, signer: WalletSigner, edits: { rating?: number; itemId?: Hex; claims?: string[] } = {}) => {
      const fin = await this.reviews.finalize(draftId, edits);
      const signature = await signFor(signer, fin.signing);
      return { ...(await this.reviews.publish(draftId, signature)), contentCid: fin.contentCid };
    },
    mine: () => this.get<MyReview[]>('/v1/me/reviews'),
  };

  followups = {
    inbox: () => this.get<FollowupItem[]>('/v1/followups'),
    prepare: (id: string, input: { stillGood: boolean; newRating?: number; note?: string }) => this.post<{ followupId: string; signing: Signing }>(`/v1/followups/${id}`, input),
    answer: (id: string, signature: Hex) => this.post<{ followupId: string; uid: Hex | null; txHash: Hex | null; explorerTx: string | null }>(`/v1/followups/${id}/answer`, { signature }),
    signAndAnswer: async (id: string, signer: WalletSigner, input: { stillGood: boolean; newRating?: number; note?: string }) => {
      const prep = await this.followups.prepare(id, input);
      return this.followups.answer(id, await signFor(signer, prep.signing));
    },
  };

  // Money ---------------------------------------------------------------------------------------------------

  money = {
    earnings: () => this.get<Earnings>('/v1/earnings'),
    setPayoutMethod: (kind: 'usdc' | 'upi', address: string) => this.post<{ kind: string; address: string }>('/v1/payout-methods', { kind, address }),
    /** Gasless claim to the signed-in wallet. */
    claim: () => this.post<{ tx: Hex; explorerTx: string | null; amount: string; to: string }>('/v1/payouts/claim'),
    /** Gasless claim to another wallet the reviewer controls: sign the typed data, then the relayer submits it. */
    claimTo: async (to: string, signer: WalletSigner) => {
      const { typedData, deadline } = await this.post<{ typedData: string; deadline: string }>('/v1/payouts/claim-to', { to });
      const signature = await signer.signTypedData(typedDataFromJson(typedData) as never);
      return this.post<{ tx: Hex; explorerTx: string | null; amount: string; to: string }>('/v1/payouts/claim', { to, deadline, signature });
    },
    withdrawInr: () => this.post<{ payoutId: string; providerRef: string; status: string; rupees: number; testMode: boolean }>('/v1/payouts/inr'),
  };

  pushTargets = {
    add: (kind: 'expo' | 'webpush' | 'whatsapp' | 'email', target: Record<string, unknown>) => this.post<{ id: string }>('/v1/push-targets', { kind, target }),
  };

  // Public ---------------------------------------------------------------------------------------------------

  config() {
    return this.get<ServerConfig>('/v1/config');
  }
  brands() {
    return this.get<Brand[]>('/v1/brands');
  }
  ask(q: string, opts: { category?: string; lat?: number; lng?: number } = {}) {
    return this.post<Answer>('/v1/ask', { q, ...opts });
  }
  receipt(uidOrId: string) {
    return this.get<ReceiptView>(`/v1/receipts/${encodeURIComponent(uidOrId)}`);
  }
  verify(uidOrId: string) {
    return this.get<VerifyResult>(`/v1/receipts/${encodeURIComponent(uidOrId)}/verify`);
  }
  coverage(opts: { area?: string; brand?: string } = {}) {
    const q = new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as [string, string][]);
    return this.get<Record<string, unknown>>(`/v1/coverage${q.size ? `?${q}` : ''}`);
  }
  item(id: string) {
    return this.get<ItemReputation>(`/v1/items/${id}`);
  }
  merchant(id: string) {
    return this.get<MerchantReputation>(`/v1/merchants/${id}`);
  }
  badge(merchantId: string) {
    return this.get<Badge>(`/v1/merchants/${merchantId}/badge`);
  }
  /** City suggestions: configured and known cities, then any city in India from Google. */
  cities(q: string) {
    return this.get<{ id: string | null; name: string; state: string | null }[]>(`/v1/cities/search?q=${encodeURIComponent(q)}`);
  }
  /** The signed receipt behind a bill QR's short code. */
  receiptCode(code: string) {
    return this.get<{ payload: string }>(`/v1/receipt-codes/${encodeURIComponent(code)}`);
  }
  /** A Google map image around a point (proxied by the API, which holds the key). */
  /** An mp3 of a published review or answer, read aloud (when the server has read-aloud on). */
  speechUrl(kind: 'reviews' | 'answers', id: string) {
    return `${this.baseUrl}/v1/speech/${kind}/${encodeURIComponent(id)}`;
  }
  staticMapUrl(lat: number, lng: number, zoom = 16) {
    return `${this.baseUrl}/v1/maps/static?lat=${lat}&lng=${lng}&zoom=${zoom}`;
  }
  places(opts: { city?: string; q?: string } = {}) {
    const q = new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as [string, string][]);
    return this.get<Place[]>(`/v1/places${q.size ? `?${q}` : ''}`);
  }
  leaderboard(limit = 20) {
    return this.get<LeaderboardRow[]>(`/v1/leaderboard?limit=${limit}`);
  }
  stats() {
    return this.get<Stats>('/v1/stats');
  }
  events(limit = 50, after = 0) {
    return this.get<ReceiptsEvent[]>(`/v1/events?limit=${limit}&after=${after}`);
  }
  /** Server-sent events: the live stage feed (reviews, payments, flags, claims). */
  eventsStreamUrl() {
    return `${this.baseUrl}/v1/events/stream`;
  }
  /** Shop-through link: "Buy via Receipts" (the commission is disclosed on the landing page). */
  shopUrl(itemId: string, opts: { wallet?: string; answerId?: string } = {}) {
    const q = new URLSearchParams();
    if (opts.wallet) q.set('w', opts.wallet);
    if (opts.answerId) q.set('a', opts.answerId);
    return `${this.baseUrl}/go/${itemId}${q.size ? `?${q}` : ''}`;
  }
  contentUrl(cid: string) {
    return `${this.baseUrl}/v1/content/${cid}`;
  }

  // Merchants ------------------------------------------------------------------------------------------------

  merchants = {
    search: (q: string, where: { city?: string; near?: string } = {}) => this.get<Listing[]>(`/v1/merchants/search?${whereQuery(q, where)}`),
    /** The business on Google Maps, with the Receipts listing each place already is (if any). Any city in India. */
    searchGoogle: (q: string, where: { city?: string; near?: string } = {}) => this.get<GoogleListing[]>(`/v1/merchants/search/google?${whereQuery(q, where)}`),
    /** The listing for a Google place, made from Google's details if Receipts has none yet. */
    fromGoogle: (placeId: string) => this.post<Listing>('/v1/merchants/from-google', { placeId }),
    mine: () => this.get<MerchantAccount[]>('/v1/merchants/mine'),
    claim: (merchantId: string, method: MerchantClaimMethod, extra: { domain?: string; gstin?: string } = {}) => this.post<ClaimStarted>('/v1/merchants/claim', { merchantId, method, ...extra }),
    checkClaim: (claimId: string) => this.post<{ claimId: string; status: 'pending' | 'verified' | 'approved_pending' | string; [k: string]: unknown }>(`/v1/merchants/claims/${claimId}/check`),
    insights: (merchantId: string) => this.get<Insights>(`/v1/merchants/${merchantId}/insights`),
    prepareReply: (merchantId: string, reviewId: string, text: string) => this.post<{ replyId: string; signing: Signing }>(`/v1/merchants/${merchantId}/replies`, { reviewId, text }),
    publishReply: (replyId: string, signature: Hex) => this.post<{ replyId: string; uid: Hex | null; txHash: Hex | null; easUrl: string | null; explorerTx: string | null }>(`/v1/merchants/replies/${replyId}/publish`, { signature }),
    /** Replies are public and signed by the merchant's wallet; there is no way to edit or hide a review. */
    signAndReply: async (merchantId: string, reviewId: string, text: string, signer: WalletSigner) => {
      const prep = await this.merchants.prepareReply(merchantId, reviewId, text);
      return this.merchants.publishReply(prep.replyId, await signFor(signer, prep.signing));
    },
    recordReceipt: (merchantId: string, receipt: MerchantReceipt) => this.post<{ qr: string; payload: string }>(`/v1/merchants/${merchantId}/receipts`, receipt),
    flag: (reviewId: string, reason: 'unlawful' | 'personal_data', note?: string) => this.post<{ flagId: string; status: string; note: string }>('/v1/merchants/flags', { reviewId, reason, note }),
    checkout: (merchantId: string, email: string, name?: string) => this.post<{ checkoutUrl: string | null; sessionId: string }>(`/v1/merchants/${merchantId}/billing/checkout`, { email, name }),
  };

  // Stage and operator controls (ADMIN_TOKEN) -----------------------------------------------------------------

  admin = {
    attack: () => this.request<AttackResult>('POST', '/v1/admin/attack', {}, { admin: true }),
    resetAttack: () => this.request<Record<string, unknown>>('POST', '/v1/admin/attack/reset', {}, { admin: true }),
    trust: () => this.request<Record<string, unknown>>('POST', '/v1/admin/trust', {}, { admin: true }),
    epoch: () => this.request<Record<string, unknown>>('POST', '/v1/admin/epoch', {}, { admin: true }),
    graphSync: () => this.request<Record<string, unknown>>('POST', '/v1/admin/graph-sync', {}, { admin: true }),
    flags: () => this.request<Record<string, unknown>[]>('GET', '/v1/admin/flags', undefined, { admin: true }),
    investigate: (flagId: string) => this.request<Record<string, unknown>>('POST', `/v1/admin/flags/${flagId}/investigate`, {}, { admin: true }),
    decide: (flagId: string, decision: 'confirm' | 'clear', by?: string) => this.request<Record<string, unknown>>('POST', `/v1/admin/flags/${flagId}/decide`, { decision, by }, { admin: true }),
    approveClaim: (claimId: string) => this.request<Record<string, unknown>>('POST', `/v1/admin/claims/${claimId}/approve`, {}, { admin: true }),
    testConversion: (clickId: string, amountInr: number, status?: 'pending' | 'confirmed' | 'cancelled') =>
      this.request<Record<string, unknown>>('POST', '/v1/admin/shop/test-conversion', { clickId, amountInr, status }, { admin: true }),
    fastForwardFollowup: (followupId: string, stillGood: boolean, newRating?: number) =>
      this.request<Record<string, unknown>>('POST', `/v1/admin/followups/${followupId}/fast-forward`, { stillGood, newRating }, { admin: true }),
    // The admin console
    /** Never fails for a missing or wrong token: `signedIn` says whether this token opens the console. */
    whoami: () => this.request<{ ok: boolean; open: boolean; signedIn: boolean }>('GET', '/v1/admin/whoami', undefined, { admin: true }),
    overview: () => this.request<AdminOverview>('GET', '/v1/admin/overview', undefined, { admin: true }),
    claims: (status: 'open' | 'verified' | 'failed' = 'open') => this.request<AdminClaim[]>('GET', `/v1/admin/claims?status=${status}`, undefined, { admin: true }),
    rejectClaim: (claimId: string, note: string) => this.request<Record<string, unknown>>('POST', `/v1/admin/claims/${claimId}/reject`, { note }, { admin: true }),
    heldReviews: () => this.request<AdminHeldReview[]>('GET', '/v1/admin/reviews/held', undefined, { admin: true }),
    releaseReview: (reviewId: string) => this.request<Record<string, unknown>>('POST', `/v1/admin/reviews/${reviewId}/release`, {}, { admin: true }),
    anchorNow: () => this.request<{ anchored: number; waiting: number; expired: number }>('POST', '/v1/admin/anchor', {}, { admin: true }),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 300) };
  }
}

/** Rupees from minor units (paise). */
export function inr(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '—';
  return `₹${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: minor % 100 === 0 ? 0 : 2 })}`;
}

export function shortAddr(a: string | null | undefined): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

/** q plus a city: a known city ID, or a city name typed by hand (any city in India). */
function whereQuery(q: string, where: { city?: string; near?: string }): string {
  const p = new URLSearchParams({ q });
  if (where.city) p.set('city', where.city);
  else if (where.near?.trim()) p.set('near', where.near.trim());
  return p.toString();
}
