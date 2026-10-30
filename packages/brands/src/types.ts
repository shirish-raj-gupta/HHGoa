import type { Rail } from '@receipts/core';

export type RailStatus = 'live' | 'testing' | 'planned' | 'blocked';

export interface BrandRail {
  rail: Rail;
  status: RailStatus;
  /** Rails 1 and 3: Reclaim provider ID, or the env var that holds it (set during prep after testing on two phones). */
  providerId?: string;
  providerEnv?: string;
  /** Rail 2: ZK Email blueprint slug, e.g. "receipts/swiggy-order@v1", or the env var that holds it. */
  blueprint?: string;
  blueprintEnv?: string;
  /** Rail 4: affiliate network and campaign; only campaigns that allow incentive (cashback) traffic. */
  network?: 'cuelinks' | 'admitad' | 'inrdeals' | 'direct';
  campaignId?: string;
  incentiveAllowed?: boolean;
  /** Where "Buy via Receipts" sends the click before the network appends its own tracking. */
  deeplinkTemplate?: string;
  notes?: string;
  lastTestedAt?: string;
}

/** How to read fields out of an order email once its DKIM signature has verified (forwarded-as-attachment path). */
export interface EmailParser {
  /** Organisational domains allowed as the DKIM d= and From domain. */
  dkimDomains: string[];
  orderId: RegExp[];
  total: RegExp[];
  /** Restaurant, store, hotel or airline segment. First capture group. */
  merchant?: RegExp[];
  /** Line items. Groups: qty, name, price; or name, price. */
  items?: RegExp[];
  /** Travel: date the trip ends, for event-based follow-ups and the publish delay. */
  travelDate?: RegExp[];
}

export interface Brand {
  id: string;
  name: string;
  group:
    | 'food_delivery'
    | 'quick_commerce'
    | 'marketplace'
    | 'd2c'
    | 'travel'
    | 'local'
    | 'landlord'
    | 'subscription'
    | 'agents'
    | 'ondc';
  domains: string[];
  categories: string[];
  defaultRail: Rail;
  rails: BrandRail[];
  email?: EmailParser;
}
