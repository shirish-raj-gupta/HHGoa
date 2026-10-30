import { SCHEMA_REGISTRY_ABI, SCHEMA_REVOCABLE, SCHEMA_STRINGS, schemaUid, type SchemaName } from '@receipts/core';
import { zeroHash, type Abi, type Account, type Address, type Chain, type Hex, type Transport, type WalletClient } from 'viem';
import {
  PayoutDistributorAbi,
  PersonhoodRegistryAbi,
  ReceiptsGovernanceTokenAbi,
  ReceiptsGovernorAbi,
  ReceiptsReputationAbi,
  ReceiptsResolverAbi,
} from './abis.generated';
import {
  PayoutDistributorBytecode,
  PersonhoodRegistryBytecode,
  ReceiptsGovernanceTokenBytecode,
  ReceiptsGovernorBytecode,
  ReceiptsReputationBytecode,
  ReceiptsResolverBytecode,
} from './bytecode.generated';
import type { Deployment, SchemaUids } from './types';

export interface DeployConfig {
  eas: Address;
  schemaRegistry: Address;
  usdc: Address;
  /** Receives admin roles and ownership; defaults to the deployer. */
  admin?: Address;
  /** Registers humans and attests merchant claims. */
  verifier: Address;
  /** Attests reputation levels, mints and levels the reputation token. */
  trustEngine: Address;
  /** Posts daily payout roots. */
  rootPoster: Address;
  /** Deploy the testnet-only governance token and governor. */
  governance?: boolean;
}

type Wallet = WalletClient<Transport, Chain | undefined, Account>;

/** The few public-client calls the deployer needs; any viem public client (Base, Base Sepolia, local) fits. */
export interface ChainReader {
  waitForTransactionReceipt(args: { hash: Hex }): Promise<{ contractAddress?: Address | null; status: 'success' | 'reverted' }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readContract(args: any): Promise<any>;
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
}

async function deploy(wallet: Wallet, pub: ChainReader, abi: Abi, bytecode: Hex, args: unknown[], log: (m: string) => void, name: string): Promise<Address> {
  const hash = await wallet.deployContract({ abi, bytecode, args, account: wallet.account, chain: wallet.chain ?? null } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error(`${name}: no contract address`);
  log(`${name}: ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

async function send(wallet: Wallet, pub: ChainReader, params: { address: Address; abi: Abi; functionName: string; args: unknown[] }): Promise<void> {
  const hash = await wallet.writeContract({ ...params, account: wallet.account, chain: wallet.chain ?? null } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${params.functionName} reverted`);
}

/** The testnet-only governance token and governor; can also be added to an existing deployment later. */
export async function deployGovernance(wallet: Wallet, pub: ChainReader, admin: Address, log: (m: string) => void = console.log): Promise<{ governanceToken: Address; governor: Address }> {
  const governanceToken = await deploy(wallet, pub, ReceiptsGovernanceTokenAbi, ReceiptsGovernanceTokenBytecode, [admin], log, 'ReceiptsGovernanceToken (testnet)');
  const governor = await deploy(wallet, pub, ReceiptsGovernorAbi, ReceiptsGovernorBytecode, [governanceToken], log, 'ReceiptsGovernor (testnet)');
  return { governanceToken, governor };
}

/** Deploy every Receipts contract, register the five EAS schemas against the resolver, and wire roles. */
export async function deployReceipts(wallet: Wallet, pub: ChainReader, cfg: DeployConfig, log: (m: string) => void = console.log): Promise<Deployment> {
  const deployer = wallet.account.address;
  const admin = cfg.admin ?? deployer;
  const chainId = await pub.getChainId();

  const personhoodRegistry = await deploy(wallet, pub, PersonhoodRegistryAbi, PersonhoodRegistryBytecode, [admin, cfg.verifier], log, 'PersonhoodRegistry');
  const resolver = await deploy(
    wallet,
    pub,
    ReceiptsResolverAbi,
    ReceiptsResolverBytecode,
    [cfg.eas, personhoodRegistry, deployer, cfg.verifier, cfg.trustEngine],
    log,
    'ReceiptsResolver',
  );
  const payoutDistributor = await deploy(wallet, pub, PayoutDistributorAbi, PayoutDistributorBytecode, [cfg.usdc, admin, cfg.rootPoster], log, 'PayoutDistributor');
  const reputation = await deploy(wallet, pub, ReceiptsReputationAbi, ReceiptsReputationBytecode, [personhoodRegistry, admin, cfg.trustEngine], log, 'ReceiptsReputation');

  const { governanceToken, governor } = cfg.governance ? await deployGovernance(wallet, pub, admin, log) : {};

  const schemas = {} as SchemaUids;
  for (const name of Object.keys(SCHEMA_STRINGS) as SchemaName[]) {
    const uid = schemaUid(SCHEMA_STRINGS[name], resolver, SCHEMA_REVOCABLE[name]);
    const existing = await pub.readContract({ address: cfg.schemaRegistry, abi: SCHEMA_REGISTRY_ABI, functionName: 'getSchema', args: [uid] });
    if (existing.uid === zeroHash) {
      await send(wallet, pub, {
        address: cfg.schemaRegistry,
        abi: SCHEMA_REGISTRY_ABI as unknown as Abi,
        functionName: 'register',
        args: [SCHEMA_STRINGS[name], resolver, SCHEMA_REVOCABLE[name]],
      });
    }
    schemas[name] = uid;
    log(`schema ${name}: ${uid}`);
  }

  await send(wallet, pub, {
    address: resolver,
    abi: ReceiptsResolverAbi as unknown as Abi,
    functionName: 'setSchemas',
    args: [schemas.review, schemas.followUp, schemas.reply, schemas.merchant, schemas.reputation],
  });
  if (admin !== deployer) {
    await send(wallet, pub, { address: resolver, abi: ReceiptsResolverAbi as unknown as Abi, functionName: 'transferOwnership', args: [admin] });
  }

  const blockNumber = await pub.getBlockNumber();
  return {
    chainId,
    eas: cfg.eas,
    schemaRegistry: cfg.schemaRegistry,
    usdc: cfg.usdc,
    personhoodRegistry,
    resolver,
    payoutDistributor,
    reputation,
    governanceToken,
    governor,
    schemas,
    roles: { verifier: cfg.verifier, trustEngine: cfg.trustEngine, rootPoster: cfg.rootPoster, admin },
    deployer,
    deployedAt: new Date().toISOString(),
    blockNumber: blockNumber.toString(),
  };
}
