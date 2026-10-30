// A complete Receipts chain in memory: EAS + SchemaRegistry (from the official eas-contracts artifacts), a mock
// USDC and every Receipts contract. Used by the contract tests, the API e2e script and CHAIN=local dev mode.
import { createRequire } from 'node:module';
import { createMemoryClient } from 'tevm';
import { createPublicClient, createWalletClient, custom, defineChain, toHex, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MockUSDCAbi } from './abis.generated';
import { MockUSDCBytecode } from './bytecode.generated';
import { deployReceipts } from './deploy';
import type { Deployment } from './types';

const require = createRequire(import.meta.url);
const EAS_ARTIFACT = require('@ethereum-attestation-service/eas-contracts/artifacts/contracts/EAS.sol/EAS.json') as { abi: Abi; bytecode: Hex };
const REGISTRY_ARTIFACT = require('@ethereum-attestation-service/eas-contracts/artifacts/contracts/SchemaRegistry.sol/SchemaRegistry.json') as {
  abi: Abi;
  bytecode: Hex;
};

/** Anvil's well-known development keys. Local chains only; never fund these anywhere real. */
export const LOCAL_KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  relayer: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  operator: '0x5de4111afa1a4b94908f83103eb1d1706367c2e68ca870fc3fb9a804cdab365a',
  reviewerA: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  reviewerB: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  merchant: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  agent: '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
} as const satisfies Record<string, Hex>;

export type LocalChain = Awaited<ReturnType<typeof startLocalChain>>;

export async function startLocalChain(opts: { log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  const memory = createMemoryClient({ miningConfig: { type: 'auto' }, loggingLevel: 'warn' });
  await memory.tevmReady();
  const chainId = await memory.getChainId();
  const chain = defineChain({
    id: chainId,
    name: 'Receipts local',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['http://127.0.0.1:0'] } },
  });
  // tevm estimates gas net of refunds and without the 63/64 rule, so nested EAS -> resolver calls and storage
  // deletes run out of gas. Pad every estimate on the local chain.
  const transport = custom({
    request: async (args: { method: string; params?: unknown }) => {
      const res = await memory.request(args as never);
      if (args.method === 'eth_estimateGas') return toHex((BigInt(res as string) * 3n) / 2n + 100_000n);
      return res;
    },
  });
  const publicClient = createPublicClient({ chain, transport });
  const wallet = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain, transport });

  for (const key of Object.values(LOCAL_KEYS)) {
    await memory.setBalance({ address: privateKeyToAccount(key).address, value: 10n ** 22n });
  }

  const deployer = wallet(LOCAL_KEYS.deployer);
  const operator = privateKeyToAccount(LOCAL_KEYS.operator).address;
  const deployRaw = async (abi: Abi, bytecode: Hex, args: unknown[]): Promise<Address> => {
    const hash = await deployer.deployContract({ abi, bytecode, args } as never);
    const r = await publicClient.waitForTransactionReceipt({ hash });
    return r.contractAddress!;
  };

  const schemaRegistry = await deployRaw(REGISTRY_ARTIFACT.abi, REGISTRY_ARTIFACT.bytecode, []);
  const eas = await deployRaw(EAS_ARTIFACT.abi, EAS_ARTIFACT.bytecode, [schemaRegistry]);
  const usdc = await deployRaw(MockUSDCAbi as unknown as Abi, MockUSDCBytecode, []);
  log(`local EAS ${eas}, SchemaRegistry ${schemaRegistry}, MockUSDC ${usdc}`);

  const deployment: Deployment = await deployReceipts(
    deployer,
    publicClient,
    { eas, schemaRegistry, usdc, verifier: operator, trustEngine: operator, rootPoster: operator, governance: true },
    log,
  );
  return { memory, chain, chainId, transport, publicClient, wallet, deployment, keys: LOCAL_KEYS };
}
