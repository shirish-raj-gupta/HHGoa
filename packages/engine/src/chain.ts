import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  parseEventLogs,
  parseSignature,
  zeroAddress,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import {
  CHAINS,
  EAS_ABI,
  EAS_ATTEST_BY_DELEGATION_ABI,
  SCHEMA_REVOCABLE,
  attestRequest,
  attestTypedData,
  easScanAttestationUrl,
  explorerTxUrl,
  readEasDomain,
  type AttestRequest,
  type EasDomain,
  type SchemaName,
} from '@receipts/core';
import {
  MockUSDCAbi,
  PayoutDistributorAbi,
  PersonhoodRegistryAbi,
  ReceiptsReputationAbi,
  ReceiptsResolverAbi,
  getDeployment,
  type Deployment,
} from '@receipts/contracts';
import type { Env } from './config';
import type { Logger } from './log';

// Everything on-chain goes through here: delegated review attestations (the reviewer signs, the relayer pays gas),
// operator writes (personhood registry, merchant claims, reputation levels, payout roots) and reads.
// Modes: base-sepolia / base (real chains, deployment from packages/contracts/deployments), local (a complete EAS +
// Receipts deployment in memory, for offline development), off (reviews are stored but not anchored).

type Wallet = WalletClient<Transport, Chain | undefined, Account>;

export interface SignedDelegation {
  schema: SchemaName;
  request: AttestRequest;
  attester: Address;
  deadline: bigint;
  signature: Hex;
}

export class ChainError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'ChainError';
  }
}

export class ChainService {
  private domain: EasDomain | null = null;
  private queues = new Map<string, Promise<unknown>>();

  private constructor(
    readonly mode: Env['CHAIN'],
    readonly chainId: number,
    readonly publicClient: PublicClient | null,
    readonly relayer: Wallet | null,
    readonly operator: Wallet | null,
    readonly deployment: Deployment | null,
    private log: Logger,
    /** Local mode only: mint mock USDC. */
    private mintUsdc?: (to: Address, amount: bigint) => Promise<void>,
  ) {}

  static async create(env: Env, log: Logger): Promise<ChainService> {
    if (env.CHAIN === 'off') return new ChainService('off', 0, null, null, null, null, log);

    if (env.CHAIN === 'local') {
      const { startLocalChain } = await import('@receipts/contracts/local');
      const t0 = Date.now();
      const local = await startLocalChain();
      log.info(`local chain ${local.chainId} ready in ${Date.now() - t0}ms (in memory; restarts with the process)`);
      const relayer = local.wallet(local.keys.relayer) as unknown as Wallet;
      const operator = local.wallet(local.keys.operator) as unknown as Wallet;
      const deployer = local.wallet(local.keys.deployer);
      const mint = async (to: Address, amount: bigint) => {
        const hash = await deployer.writeContract({ address: local.deployment.usdc, abi: MockUSDCAbi, functionName: 'mint', args: [to, amount] });
        await local.publicClient.waitForTransactionReceipt({ hash });
      };
      return new ChainService('local', local.chainId, local.publicClient as unknown as PublicClient, relayer, operator, local.deployment, log, mint);
    }

    const chain = env.CHAIN === 'base' ? base : baseSepolia;
    const rpc = env.CHAIN === 'base' ? env.BASE_RPC_URL : env.BASE_SEPOLIA_RPC_URL;
    // Public RPCs drop requests now and then ("fetch failed"), so every call retries and then moves on to the next
    // endpoint: the one in .env first, then the chain's public fallbacks.
    const urls = [...new Set([rpc ?? CHAINS[chain.id]!.rpcUrl, CHAINS[chain.id]!.rpcUrl, ...CHAINS[chain.id]!.fallbackRpcUrls])];
    const transport = fallback(
      urls.map((url) => http(url, { timeout: 12_000, retryCount: 2, retryDelay: 400 })),
      { rank: false, retryCount: 1 },
    );
    const publicClient = createPublicClient({ chain, transport }) as PublicClient;
    const deployment = getDeployment(chain.id);
    if (!deployment) log.warn(`no deployment for chain ${chain.id}: run "pnpm contracts:deploy". Reviews will not be anchored until then.`);
    const relayer = env.RELAYER_PRIVATE_KEY ? createWalletClient({ account: privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex), chain, transport }) : null;
    const opKey = env.OPERATOR_PRIVATE_KEY ?? env.RELAYER_PRIVATE_KEY;
    const operator = opKey ? createWalletClient({ account: privateKeyToAccount(opKey as Hex), chain, transport }) : null;
    if (!relayer) log.warn('RELAYER_PRIVATE_KEY is not set: nothing can be written on-chain');
    return new ChainService(env.CHAIN, chain.id, publicClient, relayer, operator, deployment, log);
  }

  /** Reviews can be anchored. */
  get enabled(): boolean {
    return !!(this.publicClient && this.relayer && this.deployment);
  }

  get canOperate(): boolean {
    return !!(this.publicClient && this.operator && this.deployment);
  }

  explorerTx(hash: string | null | undefined): string | null {
    return hash ? explorerTxUrl(this.chainId, hash) : null;
  }

  easUrl(uid: string | null | undefined): string | null {
    return uid ? easScanAttestationUrl(this.chainId, uid) : null;
  }

  private need(): { pub: PublicClient; d: Deployment } {
    if (!this.publicClient || !this.deployment) throw new ChainError(`chain is not available (mode ${this.mode}, deployment ${this.deployment ? 'ok' : 'missing'})`);
    return { pub: this.publicClient, d: this.deployment };
  }

  /** One transaction at a time per account, so concurrent requests never reuse a nonce. */
  private serial<T>(wallet: Wallet, fn: () => Promise<T>): Promise<T> {
    const key = wallet.account.address;
    const prev = this.queues.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.queues.set(key, run);
    return run;
  }

  private async write(wallet: Wallet | null, params: { address: Address; abi: Abi; functionName: string; args: unknown[] }): Promise<{ hash: Hex; logs: { address: Address; data: Hex; topics: Hex[] }[] }> {
    if (!wallet) throw new ChainError('no signing key configured for this write');
    const { pub } = this.need();
    return this.serial(wallet, async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const hash = await wallet.writeContract({ ...params, account: wallet.account, chain: wallet.chain ?? null } as never);
          const receipt = await pub.waitForTransactionReceipt({ hash });
          if (receipt.status !== 'success') throw new ChainError(`${params.functionName} reverted (${hash})`);
          return { hash, logs: receipt.logs as never };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (attempt < 2 && /nonce too low|replacement transaction underpriced|already known/i.test(msg)) continue;
          throw e instanceof ChainError ? e : new ChainError(shortError(msg), e);
        }
      }
    });
  }

  async easDomain(): Promise<EasDomain> {
    if (!this.domain) {
      const { pub, d } = this.need();
      this.domain = await readEasDomain(pub, d.eas);
      this.log.info(`EAS at ${d.eas}: ${this.domain.flavor} typed data, version ${this.domain.version}`);
    }
    return this.domain;
  }

  schemaUid(name: SchemaName): Hex {
    const { d } = this.need();
    return d.schemas[name];
  }

  /** What the reviewer (or merchant) signs so the relayer can attest on their behalf. */
  async delegationTypedData(name: SchemaName, data: Hex, opts: { attester: Address; refUID?: Hex; recipient?: Address; ttlSeconds?: number }) {
    const { pub, d } = this.need();
    const domain = await this.easDomain();
    const request = attestRequest(this.schemaUid(name), data, { revocable: SCHEMA_REVOCABLE[name], refUID: opts.refUID, recipient: opts.recipient });
    const nonce = await pub.readContract({ address: d.eas, abi: EAS_ABI, functionName: 'getNonce', args: [opts.attester] });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 3600));
    const typedData = attestTypedData(domain, request, { attester: opts.attester, nonce, deadline });
    return { typedData, request, deadline };
  }

  /** The relayer submits a signed delegated attestation and pays gas; the attester on record stays the signer. */
  async submitDelegated(s: SignedDelegation): Promise<{ uid: Hex; txHash: Hex }> {
    const { d } = this.need();
    const domain = await this.easDomain();
    const sig = parseSignature(s.signature);
    const signature = { v: Number(sig.v ?? BigInt((sig.yParity ?? 0) + 27)), r: sig.r, s: sig.s };
    const { hash, logs } =
      domain.flavor === 'modern'
        ? await this.write(this.relayer, {
            address: d.eas,
            abi: EAS_ATTEST_BY_DELEGATION_ABI.modern as unknown as Abi,
            functionName: 'attestByDelegation',
            args: [{ schema: s.request.schema, data: s.request, signature, attester: s.attester, deadline: s.deadline }],
          })
        : await this.write(this.relayer, {
            address: d.eas,
            abi: EAS_ATTEST_BY_DELEGATION_ABI.legacy as unknown as Abi,
            functionName: 'attestByDelegation',
            args: [{ schema: s.request.schema, data: s.request, signature, attester: s.attester }],
          });
    return { uid: this.uidFromLogs(logs), txHash: hash };
  }

  /** Receipts itself attests (MerchantV1 as the verifier, ReputationV1 as the trust engine). */
  async attestAsOperator(name: SchemaName, data: Hex, opts: { recipient?: Address; refUID?: Hex } = {}): Promise<{ uid: Hex; txHash: Hex }> {
    const { d } = this.need();
    const request = attestRequest(this.schemaUid(name), data, { revocable: SCHEMA_REVOCABLE[name], refUID: opts.refUID, recipient: opts.recipient });
    const { hash, logs } = await this.write(this.operator, {
      address: d.eas,
      abi: EAS_ABI as unknown as Abi,
      functionName: 'attest',
      args: [{ schema: request.schema, data: { recipient: request.recipient, expirationTime: 0n, revocable: request.revocable, refUID: request.refUID, data: request.data, value: 0n } }],
    });
    return { uid: this.uidFromLogs(logs), txHash: hash };
  }

  private uidFromLogs(logs: { address: Address; data: Hex; topics: Hex[] }[]): Hex {
    const parsed = parseEventLogs({ abi: EAS_ABI, logs: logs as never, eventName: 'Attested' });
    const uid = parsed[0]?.args.uid;
    if (!uid) throw new ChainError('attestation transaction emitted no Attested event');
    return uid;
  }

  async getAttestation(uid: Hex) {
    const { pub, d } = this.need();
    const a = await pub.readContract({ address: d.eas, abi: EAS_ABI, functionName: 'getAttestation', args: [uid] });
    return a.uid === `0x${'0'.repeat(64)}` ? null : a;
  }

  async reviewOfNullifier(nullifier: Hex): Promise<Hex | null> {
    const { pub, d } = this.need();
    const uid = (await pub.readContract({ address: d.resolver, abi: ReceiptsResolverAbi, functionName: 'reviewOfNullifier', args: [nullifier] })) as Hex;
    return /^0x0+$/.test(uid) ? null : uid;
  }

  // Personhood registry ---------------------------------------------------------------------------------------

  async reviewerIdOf(wallet: Address): Promise<Hex | null> {
    const { pub, d } = this.need();
    const id = (await pub.readContract({ address: d.personhoodRegistry, abi: PersonhoodRegistryAbi, functionName: 'reviewerIdOf', args: [wallet] })) as Hex;
    return /^0x0+$/.test(id) ? null : id;
  }

  async walletOfReviewer(reviewerId: Hex): Promise<Address | null> {
    const { pub, d } = this.need();
    const w = (await pub.readContract({ address: d.personhoodRegistry, abi: PersonhoodRegistryAbi, functionName: 'walletOf', args: [reviewerId] })) as Address;
    return w === zeroAddress ? null : w;
  }

  async registerHuman(nullifierHash: Hex, wallet: Address, idType: number): Promise<Hex> {
    const { d } = this.need();
    const { hash } = await this.write(this.operator, {
      address: d.personhoodRegistry,
      abi: PersonhoodRegistryAbi as unknown as Abi,
      functionName: 'register',
      args: [nullifierHash, wallet, idType],
    });
    return hash;
  }

  async rebindHuman(nullifierHash: Hex, wallet: Address): Promise<Hex> {
    const { d } = this.need();
    const { hash } = await this.write(this.operator, {
      address: d.personhoodRegistry,
      abi: PersonhoodRegistryAbi as unknown as Abi,
      functionName: 'rebind',
      args: [nullifierHash, wallet],
    });
    return hash;
  }

  // Reputation token ------------------------------------------------------------------------------------------

  async reputationOf(wallet: Address): Promise<number> {
    const { pub, d } = this.need();
    return Number(await pub.readContract({ address: d.reputation, abi: ReceiptsReputationAbi, functionName: 'levelOf', args: [wallet] }));
  }

  async mintReputation(wallet: Address): Promise<Hex> {
    const { d } = this.need();
    return (await this.write(this.operator, { address: d.reputation, abi: ReceiptsReputationAbi as unknown as Abi, functionName: 'mint', args: [wallet] })).hash;
  }

  async setReputationLevel(reviewerId: Hex, level: number): Promise<Hex> {
    const { d } = this.need();
    return (await this.write(this.operator, { address: d.reputation, abi: ReceiptsReputationAbi as unknown as Abi, functionName: 'setLevel', args: [reviewerId, level] })).hash;
  }

  async migrateReputation(reviewerId: Hex): Promise<Hex> {
    const { d } = this.need();
    return (await this.write(this.relayer, { address: d.reputation, abi: ReceiptsReputationAbi as unknown as Abi, functionName: 'migrate', args: [reviewerId] })).hash;
  }

  // Payouts ---------------------------------------------------------------------------------------------------

  async usdcBalance(address: Address): Promise<bigint> {
    const { pub, d } = this.need();
    return (await pub.readContract({ address: d.usdc, abi: MockUSDCAbi, functionName: 'balanceOf', args: [address] })) as bigint;
  }

  /** Make sure the distributor holds enough USDC for a root: mint on the local chain, transfer from the operator elsewhere. */
  async fundDistributor(required: bigint): Promise<Hex | null> {
    const { d } = this.need();
    const [held, claimed] = await Promise.all([this.usdcBalance(d.payoutDistributor), this.totalClaimed()]);
    const missing = required - (held + claimed);
    if (missing <= 0n) return null;
    if (this.mintUsdc) {
      await this.mintUsdc(d.payoutDistributor, missing);
      return null;
    }
    const { hash } = await this.write(this.operator, { address: d.usdc, abi: MockUSDCAbi as unknown as Abi, functionName: 'transfer', args: [d.payoutDistributor, missing] });
    return hash;
  }

  async totalClaimed(): Promise<bigint> {
    const { pub, d } = this.need();
    return (await pub.readContract({ address: d.payoutDistributor, abi: PayoutDistributorAbi, functionName: 'totalClaimed' })) as bigint;
  }

  async distributorState(): Promise<{ root: Hex; epoch: bigint }> {
    const { pub, d } = this.need();
    const [root, epoch] = await Promise.all([
      pub.readContract({ address: d.payoutDistributor, abi: PayoutDistributorAbi, functionName: 'merkleRoot' }) as Promise<Hex>,
      pub.readContract({ address: d.payoutDistributor, abi: PayoutDistributorAbi, functionName: 'epoch' }) as Promise<bigint>,
    ]);
    return { root, epoch };
  }

  async postRoot(root: Hex, epoch: bigint, totalCumulative: bigint): Promise<Hex> {
    const { d } = this.need();
    return (await this.write(this.operator, {
      address: d.payoutDistributor,
      abi: PayoutDistributorAbi as unknown as Abi,
      functionName: 'postRoot',
      args: [root, epoch, totalCumulative],
    })).hash;
  }

  async claimedOf(account: Address): Promise<bigint> {
    const { pub, d } = this.need();
    return (await pub.readContract({ address: d.payoutDistributor, abi: PayoutDistributorAbi, functionName: 'claimed', args: [account] })) as bigint;
  }

  /** Gasless: the relayer claims for the reviewer, funds go to the reviewer's own wallet. */
  async relayClaim(account: Address, cumulative: bigint, proof: Hex[]): Promise<Hex> {
    const { d } = this.need();
    return (await this.write(this.relayer, { address: d.payoutDistributor, abi: PayoutDistributorAbi as unknown as Abi, functionName: 'claim', args: [account, cumulative, proof] })).hash;
  }

  /** Gasless claim to a wallet the reviewer chose (e.g. Cake Wallet), authorised by their signature. */
  async relayClaimTo(account: Address, cumulative: bigint, proof: Hex[], to: Address, deadline: bigint, signature: Hex): Promise<Hex> {
    const { d } = this.need();
    return (await this.write(this.relayer, {
      address: d.payoutDistributor,
      abi: PayoutDistributorAbi as unknown as Abi,
      functionName: 'claimFor',
      args: [account, cumulative, proof, to, deadline, signature],
    })).hash;
  }

  claimToTypedData(account: Address, cumulative: bigint, to: Address, deadline: bigint) {
    const { d } = this.need();
    return {
      domain: { name: 'Receipts Payouts', version: '1', chainId: this.chainId, verifyingContract: d.payoutDistributor },
      types: {
        ClaimTo: [
          { name: 'account', type: 'address' },
          { name: 'cumulativeAmount', type: 'uint256' },
          { name: 'to', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'ClaimTo' as const,
      message: { account, cumulativeAmount: cumulative, to, deadline },
    };
  }
}

function shortError(msg: string): string {
  const reason = /reverted with the following (?:reason|signature):\s*\n?(.+)/i.exec(msg)?.[1] ?? /Error: ([A-Za-z]+\(.*?\))/.exec(msg)?.[1];
  return (reason ?? msg.split('\n')[0] ?? msg).slice(0, 300);
}
