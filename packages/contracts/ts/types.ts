import type { Address, Hex } from 'viem';

export interface SchemaUids {
  review: Hex;
  followUp: Hex;
  reply: Hex;
  merchant: Hex;
  reputation: Hex;
}

export interface Deployment {
  chainId: number;
  eas: Address;
  schemaRegistry: Address;
  usdc: Address;
  personhoodRegistry: Address;
  resolver: Address;
  payoutDistributor: Address;
  reputation: Address;
  /** Testnet only. */
  governanceToken?: Address;
  governor?: Address;
  schemas: SchemaUids;
  roles: { verifier: Address; trustEngine: Address; rootPoster: Address; admin: Address };
  deployer: Address;
  deployedAt: string;
  blockNumber: string;
}
