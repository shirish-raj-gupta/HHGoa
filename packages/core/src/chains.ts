import type { Address, Hex } from 'viem';

export const EAS_PREDEPLOY: Address = '0x4200000000000000000000000000000000000021';
export const SCHEMA_REGISTRY_PREDEPLOY: Address = '0x4200000000000000000000000000000000000020';

export interface ChainInfo {
  id: number;
  name: string;
  caip2: `eip155:${number}`;
  rpcUrl: string;
  /** Other public endpoints, tried in order when rpcUrl (or the one in .env) fails. */
  fallbackRpcUrls: string[];
  explorer: string;
  easScan: string | null;
  usdc: Address | null;
  eas: Address;
  schemaRegistry: Address;
  testnet: boolean;
}

export const CHAINS: Record<number, ChainInfo> = {
  8453: {
    id: 8453,
    name: 'Base',
    caip2: 'eip155:8453',
    rpcUrl: 'https://mainnet.base.org',
    fallbackRpcUrls: ['https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://base.gateway.tenderly.co'],
    explorer: 'https://basescan.org',
    easScan: 'https://base.easscan.org',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    eas: EAS_PREDEPLOY,
    schemaRegistry: SCHEMA_REGISTRY_PREDEPLOY,
    testnet: false,
  },
  84532: {
    id: 84532,
    name: 'Base Sepolia',
    caip2: 'eip155:84532',
    rpcUrl: 'https://sepolia.base.org',
    fallbackRpcUrls: ['https://base-sepolia-rpc.publicnode.com', 'https://base-sepolia.drpc.org', 'https://base-sepolia.gateway.tenderly.co', 'https://84532.rpc.thirdweb.com'],
    explorer: 'https://sepolia.basescan.org',
    easScan: 'https://base-sepolia.easscan.org',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    eas: EAS_PREDEPLOY,
    schemaRegistry: SCHEMA_REGISTRY_PREDEPLOY,
    testnet: true,
  },
  31337: {
    id: 31337,
    name: 'Local',
    caip2: 'eip155:31337',
    rpcUrl: 'http://127.0.0.1:8545',
    fallbackRpcUrls: [],
    explorer: '',
    easScan: null,
    usdc: null,
    eas: EAS_PREDEPLOY,
    schemaRegistry: SCHEMA_REGISTRY_PREDEPLOY,
    testnet: true,
  },
};

export function chainInfo(chainId: number): ChainInfo {
  const c = CHAINS[chainId];
  if (!c) throw new Error(`unsupported chain ${chainId}`);
  return c;
}

export function explorerTxUrl(chainId: number, hash: Hex | string): string | null {
  const c = CHAINS[chainId];
  return c?.explorer ? `${c.explorer}/tx/${hash}` : null;
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  const c = CHAINS[chainId];
  return c?.explorer ? `${c.explorer}/address/${address}` : null;
}

export function easScanAttestationUrl(chainId: number, uid: Hex | string): string | null {
  const c = CHAINS[chainId];
  return c?.easScan ? `${c.easScan}/attestation/view/${uid}` : null;
}
