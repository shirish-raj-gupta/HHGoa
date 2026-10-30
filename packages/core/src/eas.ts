import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  parseAbiParameters,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';

// Only ratings, hashes and nullifiers go on Base; review text and proof blobs stay off-chain behind a CID.

export const SCHEMA_STRINGS = {
  review:
    'bytes32 itemId, uint8 rating, bytes32 purchaseNullifier, bytes32 reviewerId, bytes32 proofHash, string contentCID, uint32 purchaseDay, uint8 rail, uint8 tier, string brand',
  followUp: 'uint16 dayOffset, bool stillGood, uint8 newRating, string contentCID',
  reply: 'string contentCID',
  merchant: 'bytes32 merchantId, uint8 claimMethod, bytes32 evidenceHash',
  reputation: 'address reviewer, uint8 level, uint32 reviews, uint16 reliabilityBps',
} as const;
export type SchemaName = keyof typeof SCHEMA_STRINGS;

/** Reviews, follow-ups and replies are undeletable; merchant claims and reputation levels can be corrected. */
export const SCHEMA_REVOCABLE: Record<SchemaName, boolean> = {
  review: false,
  followUp: false,
  reply: false,
  merchant: true,
  reputation: true,
};

/** SchemaRegistry UID: keccak256(abi.encodePacked(schema, resolver, revocable)). */
export function schemaUid(schema: string, resolver: Address, revocable: boolean): Hex {
  return keccak256(encodePacked(['string', 'address', 'bool'], [schema, resolver, revocable]));
}

export const MERCHANT_CLAIM_METHOD = { domain: 1, partner_portal: 2, upi: 3, gst: 4 } as const;
export type MerchantClaimMethod = keyof typeof MERCHANT_CLAIM_METHOD;

export interface ReviewAttestation {
  itemId: Hex;
  rating: number;
  purchaseNullifier: Hex;
  reviewerId: Hex;
  proofHash: Hex;
  contentCID: string;
  purchaseDay: number;
  rail: number;
  tier: number;
  brand: string;
}

export interface FollowUpAttestation {
  dayOffset: number;
  stillGood: boolean;
  newRating: number;
  contentCID: string;
}

export interface MerchantAttestation {
  merchantId: Hex;
  claimMethod: number;
  evidenceHash: Hex;
}

export interface ReputationAttestation {
  reviewer: Address;
  level: number;
  reviews: number;
  reliabilityBps: number;
}

const P = {
  review: parseAbiParameters(SCHEMA_STRINGS.review),
  followUp: parseAbiParameters(SCHEMA_STRINGS.followUp),
  reply: parseAbiParameters(SCHEMA_STRINGS.reply),
  merchant: parseAbiParameters(SCHEMA_STRINGS.merchant),
  reputation: parseAbiParameters(SCHEMA_STRINGS.reputation),
};

export function encodeReview(d: ReviewAttestation): Hex {
  return encodeAbiParameters(P.review, [
    d.itemId,
    d.rating,
    d.purchaseNullifier,
    d.reviewerId,
    d.proofHash,
    d.contentCID,
    d.purchaseDay,
    d.rail,
    d.tier,
    d.brand,
  ]);
}

export function decodeReview(data: Hex): ReviewAttestation {
  const [itemId, rating, purchaseNullifier, reviewerId, proofHash, contentCID, purchaseDay, rail, tier, brand] =
    decodeAbiParameters(P.review, data);
  return { itemId, rating, purchaseNullifier, reviewerId, proofHash, contentCID, purchaseDay, rail, tier, brand };
}

export function encodeFollowUp(d: FollowUpAttestation): Hex {
  return encodeAbiParameters(P.followUp, [d.dayOffset, d.stillGood, d.newRating, d.contentCID]);
}

export function decodeFollowUp(data: Hex): FollowUpAttestation {
  const [dayOffset, stillGood, newRating, contentCID] = decodeAbiParameters(P.followUp, data);
  return { dayOffset, stillGood, newRating, contentCID };
}

export function encodeReply(contentCID: string): Hex {
  return encodeAbiParameters(P.reply, [contentCID]);
}

export function decodeReply(data: Hex): { contentCID: string } {
  const [contentCID] = decodeAbiParameters(P.reply, data);
  return { contentCID };
}

export function encodeMerchant(d: MerchantAttestation): Hex {
  return encodeAbiParameters(P.merchant, [d.merchantId, d.claimMethod, d.evidenceHash]);
}

export function decodeMerchant(data: Hex): MerchantAttestation {
  const [merchantId, claimMethod, evidenceHash] = decodeAbiParameters(P.merchant, data);
  return { merchantId, claimMethod, evidenceHash };
}

export function encodeReputation(d: ReputationAttestation): Hex {
  return encodeAbiParameters(P.reputation, [d.reviewer, d.level, d.reviews, d.reliabilityBps]);
}

export function decodeReputation(data: Hex): ReputationAttestation {
  const [reviewer, level, reviews, reliabilityBps] = decodeAbiParameters(P.reputation, data);
  return { reviewer, level, reviews, reliabilityBps };
}

// ---------------------------------------------------------------------------------------------------------------
// Delegated attestations. The reviewer signs EIP-712 typed data; the relayer submits attestByDelegation and pays
// gas while the attester on record stays the reviewer. Base mainnet's EAS predeploy is 1.0.1 ("legacy" typed data);
// Base Sepolia's is 1.4.x ("modern", which adds attester, value and deadline). Detect at runtime, never assume.

export type EasFlavor = 'legacy' | 'modern';

export const ATTEST_TYPE_STRING: Record<EasFlavor, string> = {
  legacy: 'Attest(bytes32 schema,address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 nonce)',
  modern:
    'Attest(address attester,bytes32 schema,address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value,uint256 nonce,uint64 deadline)',
};

export const ATTEST_TYPEHASH: Record<EasFlavor, Hex> = {
  legacy: keccak256(toBytes(ATTEST_TYPE_STRING.legacy)),
  modern: keccak256(toBytes(ATTEST_TYPE_STRING.modern)),
};

export const ATTEST_TYPES = {
  legacy: {
    Attest: [
      { name: 'schema', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'expirationTime', type: 'uint64' },
      { name: 'revocable', type: 'bool' },
      { name: 'refUID', type: 'bytes32' },
      { name: 'data', type: 'bytes' },
      { name: 'nonce', type: 'uint256' },
    ],
  },
  modern: {
    Attest: [
      { name: 'attester', type: 'address' },
      { name: 'schema', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'expirationTime', type: 'uint64' },
      { name: 'revocable', type: 'bool' },
      { name: 'refUID', type: 'bytes32' },
      { name: 'data', type: 'bytes' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint64' },
    ],
  },
} as const;

export interface EasDomain {
  flavor: EasFlavor;
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

export interface AttestRequest {
  schema: Hex;
  recipient: Address;
  expirationTime: bigint;
  revocable: boolean;
  refUID: Hex;
  data: Hex;
  value: bigint;
}

export const ZERO_UID: Hex = `0x${'0'.repeat(64)}`;

export function attestRequest(schema: Hex, data: Hex, opts: { recipient?: Address; refUID?: Hex; revocable: boolean }): AttestRequest {
  return {
    schema,
    recipient: opts.recipient ?? zeroAddress,
    expirationTime: 0n,
    revocable: opts.revocable,
    refUID: opts.refUID ?? ZERO_UID,
    data,
    value: 0n,
  };
}

export function attestTypedData(domain: EasDomain, req: AttestRequest, p: { attester: Address; nonce: bigint; deadline: bigint }) {
  const d = { name: domain.name, version: domain.version, chainId: domain.chainId, verifyingContract: domain.verifyingContract };
  if (domain.flavor === 'legacy') {
    return {
      domain: d,
      types: ATTEST_TYPES.legacy,
      primaryType: 'Attest' as const,
      message: {
        schema: req.schema,
        recipient: req.recipient,
        expirationTime: req.expirationTime,
        revocable: req.revocable,
        refUID: req.refUID,
        data: req.data,
        nonce: p.nonce,
      },
    };
  }
  return {
    domain: d,
    types: ATTEST_TYPES.modern,
    primaryType: 'Attest' as const,
    message: {
      attester: p.attester,
      schema: req.schema,
      recipient: req.recipient,
      expirationTime: req.expirationTime,
      revocable: req.revocable,
      refUID: req.refUID,
      data: req.data,
      value: req.value,
      nonce: p.nonce,
      deadline: p.deadline,
    },
  };
}

export type AttestTypedData = ReturnType<typeof attestTypedData>;

/** bigints do not survive JSON; typed data crosses the wire with them as decimal strings. */
export function typedDataToJson(td: { domain: unknown; types: unknown; primaryType: string; message: Record<string, unknown> }): string {
  return JSON.stringify(td, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

const BIGINT_FIELDS = new Set(['expirationTime', 'value', 'nonce', 'deadline', 'amountMinor', 'issuedAt', 'cumulativeAmount']);

export function typedDataFromJson<T = AttestTypedData>(json: string | object): T {
  const obj = typeof json === 'string' ? JSON.parse(json) : structuredClone(json);
  for (const [k, v] of Object.entries(obj.message ?? {})) {
    if (BIGINT_FIELDS.has(k) && (typeof v === 'string' || typeof v === 'number')) obj.message[k] = BigInt(v);
  }
  return obj as T;
}

export function eip712DomainSeparator(name: string, version: string, chainId: number, verifyingContract: Address): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'), [
      keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
      keccak256(toBytes(name)),
      keccak256(toBytes(version)),
      BigInt(chainId),
      verifyingContract,
    ]),
  );
}

type ReadClient = Pick<PublicClient, 'readContract' | 'getChainId'>;

/**
 * Work out the exact EIP-712 domain and typed-data flavor of an EAS deployment by matching its on-chain type hash
 * and domain separator. Works for the 1.0.1 predeploy on Base, 1.4.x on Base Sepolia and local deployments.
 */
export async function readEasDomain(client: ReadClient, eas: Address): Promise<EasDomain> {
  const chainId = await client.getChainId();
  const [typeHash, separator] = await Promise.all([
    client.readContract({ address: eas, abi: EAS_ABI, functionName: 'getAttestTypeHash' }),
    client.readContract({ address: eas, abi: EAS_ABI, functionName: 'getDomainSeparator' }),
  ]);
  const flavor: EasFlavor | null =
    typeHash === ATTEST_TYPEHASH.modern ? 'modern' : typeHash === ATTEST_TYPEHASH.legacy ? 'legacy' : null;
  if (!flavor) throw new Error(`unknown EAS attest type hash ${typeHash}`);
  let reported: string | null = null;
  let fromDomain: string | null = null;
  let name = 'EAS';
  try {
    reported = await client.readContract({ address: eas, abi: EAS_ABI, functionName: 'version' });
  } catch {}
  try {
    const d = await client.readContract({ address: eas, abi: EAS_ABI, functionName: 'eip712Domain' });
    name = d[1] || name;
    fromDomain = d[2] || null;
  } catch {}
  for (const version of easVersionCandidates(reported, fromDomain)) {
    if (eip712DomainSeparator(name, version, chainId, eas) === separator) {
      return { flavor, name, version, chainId, verifyingContract: eas };
    }
  }
  throw new Error(`could not match the EAS EIP-712 domain separator at ${eas} (version ${reported})`);
}

/** Versions to try when matching getDomainSeparator(); the reported version() can carry a pre-release suffix. */
export function easVersionCandidates(reported: string | null, fromEip5267: string | null): string[] {
  const list = [fromEip5267, reported, reported?.split('-')[0], '1.4.1', '1.4.0', '1.3.0', '1.2.0', '1.1.0', '1.0.1', '1.0.0', '0.26'];
  return [...new Set(list.filter((v): v is string => !!v))];
}

const ATTESTATION_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'uid', type: 'bytes32' },
    { name: 'schema', type: 'bytes32' },
    { name: 'time', type: 'uint64' },
    { name: 'expirationTime', type: 'uint64' },
    { name: 'revocationTime', type: 'uint64' },
    { name: 'refUID', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'attester', type: 'address' },
    { name: 'revocable', type: 'bool' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

const REQUEST_DATA_TUPLE = {
  name: 'data',
  type: 'tuple',
  components: [
    { name: 'recipient', type: 'address' },
    { name: 'expirationTime', type: 'uint64' },
    { name: 'revocable', type: 'bool' },
    { name: 'refUID', type: 'bytes32' },
    { name: 'data', type: 'bytes' },
    { name: 'value', type: 'uint256' },
  ],
} as const;

const SIGNATURE_TUPLE = {
  name: 'signature',
  type: 'tuple',
  components: [
    { name: 'v', type: 'uint8' },
    { name: 'r', type: 'bytes32' },
    { name: 's', type: 'bytes32' },
  ],
} as const;

export const EAS_ABI = [
  { type: 'function', name: 'getAttestation', stateMutability: 'view', inputs: [{ name: 'uid', type: 'bytes32' }], outputs: [ATTESTATION_TUPLE] },
  { type: 'function', name: 'isAttestationValid', stateMutability: 'view', inputs: [{ name: 'uid', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'getNonce', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getAttestTypeHash', stateMutability: 'pure', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'getDomainSeparator', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'getName', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  {
    type: 'function',
    name: 'eip712Domain',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'extensions', type: 'uint256[]' },
    ],
  },
  {
    type: 'function',
    name: 'attest',
    stateMutability: 'payable',
    inputs: [{ name: 'request', type: 'tuple', components: [{ name: 'schema', type: 'bytes32' }, REQUEST_DATA_TUPLE] }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'event',
    name: 'Attested',
    inputs: [
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'attester', type: 'address', indexed: true },
      { name: 'uid', type: 'bytes32', indexed: false },
      { name: 'schemaUID', type: 'bytes32', indexed: true },
    ],
  },
] as const;

export const EAS_ATTEST_BY_DELEGATION_ABI = {
  legacy: [
    {
      type: 'function',
      name: 'attestByDelegation',
      stateMutability: 'payable',
      inputs: [
        {
          name: 'delegatedRequest',
          type: 'tuple',
          components: [{ name: 'schema', type: 'bytes32' }, REQUEST_DATA_TUPLE, SIGNATURE_TUPLE, { name: 'attester', type: 'address' }],
        },
      ],
      outputs: [{ type: 'bytes32' }],
    },
  ],
  modern: [
    {
      type: 'function',
      name: 'attestByDelegation',
      stateMutability: 'payable',
      inputs: [
        {
          name: 'delegatedRequest',
          type: 'tuple',
          components: [
            { name: 'schema', type: 'bytes32' },
            REQUEST_DATA_TUPLE,
            SIGNATURE_TUPLE,
            { name: 'attester', type: 'address' },
            { name: 'deadline', type: 'uint64' },
          ],
        },
      ],
      outputs: [{ type: 'bytes32' }],
    },
  ],
} as const;

export const SCHEMA_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'schema', type: 'string' },
      { name: 'resolver', type: 'address' },
      { name: 'revocable', type: 'bool' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getSchema',
    stateMutability: 'view',
    inputs: [{ name: 'uid', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'uid', type: 'bytes32' },
          { name: 'resolver', type: 'address' },
          { name: 'revocable', type: 'bool' },
          { name: 'schema', type: 'string' },
        ],
      },
    ],
  },
] as const;
