import type { Answer, AnswerOption, Rail, ReviewDocument } from '@receipts/core';

// Response shapes of the Receipts API, as the apps use them. The API is the source of truth (apps/api/src/routes);
// fields the apps never read are left out.

export type { Answer, AnswerOption, Rail };

export type Hex = `0x${string}`;

export interface ServerConfig {
  chain: { mode: 'local' | 'base' | 'base-sepolia' | 'off'; chainId: number; anchored: boolean; explorer: string | null; easScan: string | null; deployment: Record<string, string> | null };
  x402: { on: boolean; network?: string; payTo?: string; prices: Record<string, number> };
  identity: { selfScope: string; selfEndpoint: string | null; selfStaging: boolean; anonAadhaarSeed: string | null; anonAadhaarTest: boolean; mockAllowed: boolean };
  proofs: { reclaim: boolean; simulatedAllowed: boolean };
  /** Place search and maps from Google (the key stays on the server). */
  places: { google: boolean };
  voice: { sarvam: boolean; model: string };
  llm: { provider: 'anthropic' | 'gemini' | 'openai-compat' | 'offline'; model: string | null };
  demoMode: boolean;
  rails: Record<Rail, { label: string; proves: string; how: string }>;
  categories: { id: string; name: string; rails: Rail[]; aspects: string[]; itemNoun: string; prompt: { en: string; hi: string } }[];
  cities: { id: string; name: string; center: [number, number]; status: 'live' | 'seeded' | 'planned'; localities: string[] }[];
}

export interface Brand {
  id: string;
  name: string;
  group: string;
  categories: string[];
  defaultRail: Rail;
  /** provider: what a Reclaim proof for this rail carries (null when the rail has no Reclaim provider). */
  rails: { rail: Rail; status: string; provider?: { proves: string | null; alsoShares: string | null; community: boolean; tier: 'A' | 'B' | null } | null }[];
}

export interface SignInResult {
  token: string;
  wallet: string;
  human: boolean;
  reviewerId: string | null;
}

export interface HumanResult {
  verified: true;
  reviewerId: string;
  token: string;
  mock?: boolean;
  message: string;
}

export interface Me {
  wallet: string;
  human: boolean;
  reviewer: { id: string; level: number; reliability: number; idType: string; since: string } | null;
}

export interface PurchaseView {
  id: string;
  rail: Rail;
  tier: 'A' | 'B';
  brandId: string;
  category: string | null;
  merchantId: Hex;
  merchant: string;
  items: { itemId: Hex; name: string; quantity: number; priceMinor: number | null }[];
  amountMinor: number;
  currency: string;
  purchasedOn: string;
  status: string;
  simulated: boolean;
  reviewed: boolean;
  reviewable: { ok: boolean; reason?: string };
  /** Where the merchant is, if known (from Google Maps once a UPI payment is pinned); payeeName is what the payment showed. */
  place: { address: string | null; mapsUrl: string | null; lat: number | null; lng: number | null; fromGoogle: boolean };
  payeeName: string | null;
}

/** A place from Google Maps. */
export interface GooglePlace {
  placeId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  kind: string | null;
  primaryType: string | null;
  mapsUrl: string | null;
  open: boolean;
}

export type StartedProof =
  | { proofRequestId: string; kind: 'reclaim'; reclaim: { requestJson: string; requestUrl: string; qrUrl: string; qrOpens: 'portal' | 'app' } }
  | { proofRequestId: string; kind: Rail; blueprint: string | null; instructions: string };

export interface ProofRequestStatus {
  id: string;
  rail: string;
  status: 'pending' | 'verified' | 'failed' | string;
  purchase: PurchaseView | null;
  error: string | null;
}

export interface SimulatedPurchaseInput {
  rail?: Rail;
  brandId?: string;
  category?: string;
  merchantName: string;
  cityId?: string;
  lat?: number;
  lng?: number;
  items: { name: string; priceMinor?: number; quantity?: number }[];
  amountMinor?: number;
}

export interface ReviewCard {
  draftId: string;
  status: string;
  purchase: PurchaseView;
  transcript: string | null;
  rating: number | null;
  item: { itemId: Hex; name: string } | null;
  itemChoices: { itemId: Hex; name: string }[];
  aspects: Record<string, number>;
  claims: string[];
  summary_en: string | null;
  language: string | null;
  warnings: string[];
  generatedBy: 'llm' | 'rules' | null;
  prompt: { en: string; hi: string };
}

/** What the wallet signs: EIP-712 typed data (JSON, bigints as strings) when anchoring, else a plain message. */
export type Signing = { kind: 'eas'; typedData: string } | { kind: 'message'; message: string };

export interface FinalizedDraft {
  draftId: string;
  document: ReviewDocument;
  contentCid: string;
  signing: Signing;
}

export interface PublishResult {
  reviewId: string;
  uid: Hex | null;
  txHash: Hex | null;
  receiptUrl: string;
  anchored: boolean;
  /** Published, and the signed attestation waits to be anchored (the relayer was out of gas or Base did not answer). */
  anchorPending?: boolean;
  status: string;
  explorerTx: string | null;
}

export interface ReceiptView {
  id: string;
  uid: Hex | null;
  url: string;
  anchored: boolean;
  chainId: number | null;
  txHash: Hex | null;
  explorerTx: string | null;
  easUrl: string | null;
  contentCid: string;
  status: string;
  simulated: boolean;
  rating: number;
  category: { id: string; name: string };
  item: { id: string; name: string; score: number | null; verifiedReviews: number };
  merchant: {
    id: string;
    name: string;
    city: string | null;
    claimed: boolean;
    simulated: boolean;
    place: { address: string | null; mapsUrl: string | null; lat: number | null; lng: number | null; fromGoogle: boolean };
  };
  aspects: Record<string, number>;
  claims: string[];
  summary_en: string | null;
  transcript: string | null;
  language: string | null;
  diet: string | null;
  hidden: string | null;
  purchase: { rail: Rail; railLabel: string; proves: string; how: string; tier: 'A' | 'B'; brand: string; purchased: string; status: string; proofHash: string; trustAssumption: string | null };
  reviewer: { id: string; level: number; reliability: number; uniqueHuman: boolean; verifiedWith: string; simulated: boolean };
  trustWeight: number | null;
  followups: { kind: string; still_good: boolean | null; new_rating: number | null; answered_at: string | null; eas_uid: string | null; easUrl: string | null; [k: string]: unknown }[];
  replies: { text: string; eas_uid: string | null; easUrl: string | null; created_at: string; [k: string]: unknown }[];
  disclosure: string;
  commissionDisclosure: string | null;
  publishedAt: string;
  createdAt: string;
}

export interface VerifyCheck {
  check: string;
  pass: boolean | null;
  detail: string;
}

export interface VerifyResult {
  id: string;
  uid: string | null;
  allPass: boolean;
  checks: VerifyCheck[];
}

export interface MyReview {
  id: string;
  eas_uid: string | null;
  rating: number;
  status: string;
  created_at: string;
  simulated: boolean;
  item: string;
  merchant: string;
  category_id: string;
}

export interface FollowupItem {
  id: string;
  kind: string;
  due_at: string;
  window_end: string | null;
  status: string;
  review_id: string;
  eas_uid: string | null;
  rating: number;
  category_id: string;
  item: string;
  merchant: string;
}

export interface ClaimInfo {
  epoch: number | null;
  root?: string;
  cumulative: string;
  cumulativeBase?: string;
  claimed: string;
  claimable: string;
  proof: Hex[];
  distributor?: string | null;
  chainId?: number;
}

export interface Earnings {
  reviewerId: string;
  level: number;
  totals: { accrued: string; settled: string; paidInr: string; capped: string };
  today: string;
  dailyCap: string;
  claim: ClaimInfo;
  payoutMethod: { kind: 'usdc' | 'upi'; address: string } | null;
  /** Rupees: whether RazorpayX payouts are on, and what a withdrawal would send now (Razorpay's minimum is ₹1). */
  inr: { on: boolean; paise: number; minimumPaise: number };
  recent: { amount: string; source: string; status: string; created_at: string; query: string | null; item: string | null; merchant: string | null }[];
  payouts: { kind: string; amount_usdc: string | null; amount_paise: string | null; destination: string; tx_hash: string | null; status: string; test_mode: boolean; created_at: string }[];
  disclosure: string;
}

export interface LeaderboardRow {
  reviewer: string;
  reviewerId: string;
  level: number;
  reviews: number;
  earnedUsdc: string;
  simulated: boolean;
}

export interface Stats {
  receipts: number;
  simulatedReceipts: number;
  humans: number;
  brands: number;
  categories: number;
  cities: number;
  rails: number;
  paidQueries: number;
  paidUsdc: string;
  earnedByReviewersUsdc: string;
  paidOutInr: number;
  claims: number;
  flags: number;
  merchantsClaimed: number;
  followupsAnswered: number;
}

export interface ReceiptsEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface Place {
  id: string;
  name: string;
  city_id: string | null;
  category_id: string | null;
  score: number | null;
  verified_reviews: number;
  simulated: boolean;
  lat: number | null;
  lng: number | null;
}

export interface Badge {
  merchantId: string;
  name: string;
  score: number | null;
  verifiedReviews: number;
  claimed: boolean;
  durability: number | null;
  url: string;
  label: string;
}

export interface AttackResult {
  before: { score: number | null; [k: string]: unknown };
  after: { score: number | null; [k: string]: unknown };
  naiveAverage: { before: number; after: number };
  flags: { id?: string; signal: string; [k: string]: unknown }[];
  [k: string]: unknown;
}

// Merchants ---------------------------------------------------------------------------------------------------

export type MerchantClaimMethod = 'upi' | 'domain' | 'gst' | 'partner_portal';

export interface Listing {
  id: string;
  name: string;
  city_id: string | null;
  category_id: string | null;
  has_upi: boolean;
  claimed: boolean;
  verified_reviews: number;
  simulated: boolean;
}

/** A business search hit on Google Maps, and the Receipts listing it already is (if any). */
export interface GoogleListing {
  place: GooglePlace;
  listingId: string | null;
  claimed: boolean;
}

export interface MerchantAccount {
  id: string;
  merchant_id: string;
  wallet: string;
  plan: string;
  claim_method: string;
  eas_uid: string | null;
  name: string;
  city_id: string | null;
  score: number | null;
  verified_reviews: number;
  [k: string]: unknown;
}

export interface ClaimStarted {
  claimId: string;
  method: MerchantClaimMethod;
  challenge: string;
  payUrl: string | null;
  instructions: string;
}

export interface Insights {
  account: { plan: string; claimMethod: string; easUid: string | null };
  merchant: { id: string; name: string; score: number | null; verified_reviews: number; durability: number | null; city_id: string | null; address: string | null; maps_url: string | null };
  weekly: { week: string; reviews: number; avg_rating: number }[];
  aspects: { aspect: string; avg: number; mentions: number }[];
  rails: { rail: Rail; reviews: number }[];
  questions: { query: string; created_at: string; payment_method: string }[];
  alerts: { id: string; signal: string; status: string; created_at: string; members: unknown }[];
  reviews: { id: string; eas_uid: string | null; rating: number; claims: string[]; summary_en: string | null; created_at: string; rail: Rail; simulated: boolean; item: string; reply: string | null }[];
  receipts: { issued: number; claimed: number };
}

// Reputation ------------------------------------------------------------------------------------------------

export interface ItemReputation {
  item_id: string;
  item: string;
  merchant: string;
  merchant_id: string;
  category: string;
  score: number | null;
  ranked: boolean;
  verified_reviews: number;
  rating_histogram: { stars: number; count: number }[];
  aspects: Record<string, number>;
  durability: number | null;
  still_good_next_day: number | null;
  price_paid_inr: { min: number; max: number } | null;
  top_claims: { text: string; receipts: string[] }[];
  few_receipts: boolean;
  simulated: boolean;
  disclosure: string;
}

export interface MerchantReputation {
  merchant_id: string;
  merchant: string;
  city: string | null;
  category: string | null;
  score: number | null;
  verified_reviews: number;
  durability: number | null;
  reply_rate: number | null;
  claimed: boolean;
  items: { item_id: string; item: string; score: number | null; verified_reviews: number }[];
  simulated: boolean;
  disclosure: string;
}

// Admin console -----------------------------------------------------------------------------------------------

export interface AdminOverview {
  queues: { claims: number; held: number; flags: number; anchors: number };
  totals: { businesses: number; reviews: number; providers: number };
  chain: { mode: string; anchoring: boolean };
  keys: { reclaim: boolean; google: boolean; llm: string; adminToken: boolean };
}

export interface AdminClaim {
  id: string;
  method: string;
  wallet: string;
  status: string;
  challenge: string;
  evidence: Record<string, unknown> | null;
  created_at: string;
  merchant_id: string;
  merchant: string;
  address: string | null;
  city_id: string | null;
  maps_url: string | null;
  claimed: boolean;
}

export interface AdminHeldReview {
  id: string;
  rating: number;
  claims: string[];
  summary_en: string | null;
  created_at: string;
  simulated: boolean;
  item: string;
  merchant: string;
}
