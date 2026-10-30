import { beforeAll, describe, expect, it } from 'vitest';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { keccak256, parseEventLogs, parseSignature, toBytes, zeroAddress, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  EAS_ABI,
  EAS_ATTEST_BY_DELEGATION_ABI,
  attestRequest,
  attestTypedData,
  encodeFollowUp,
  encodeMerchant,
  encodeReply,
  encodeReview,
  purchaseNullifier,
  readEasDomain,
  reviewerIdFromNullifier,
  type EasDomain,
} from '@receipts/core';
import {
  MockUSDCAbi,
  PayoutDistributorAbi,
  PersonhoodRegistryAbi,
  ReceiptsReputationAbi,
  ReceiptsResolverAbi,
} from '../ts/abis.generated';
import { startLocalChain, type LocalChain } from '../ts/local';

let c: LocalChain;
let domain: EasDomain;
const acct = (k: Hex) => privateKeyToAccount(k);
const ALL_ERRORS = [...ReceiptsResolverAbi, ...PersonhoodRegistryAbi, ...PayoutDistributorAbi, ...ReceiptsReputationAbi].filter(
  (x) => x.type === 'error',
) as Abi;

const humanNullifierA = keccak256(toBytes('self-nullifier-A'));
const humanNullifierB = keccak256(toBytes('self-nullifier-B'));

async function expectRevert(p: Promise<unknown>, name: string) {
  await expect(p).rejects.toThrow(new RegExp(name));
}

/** The reviewer signs, the relayer submits. Returns the attestation UID. */
async function attestDelegated(signerKey: Hex, schema: Hex, data: Hex, opts: { refUID?: Hex; revocable?: boolean; recipient?: Address } = {}) {
  const signer = acct(signerKey);
  const req = attestRequest(schema, data, { revocable: opts.revocable ?? false, refUID: opts.refUID, recipient: opts.recipient });
  const nonce = await c.publicClient.readContract({ address: c.deployment.eas, abi: EAS_ABI, functionName: 'getNonce', args: [signer.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const td = attestTypedData(domain, req, { attester: signer.address, nonce, deadline });
  const sig = parseSignature(await signer.signTypedData(td as never));
  const relayer = c.wallet(c.keys.relayer);
  const signature = { v: Number(sig.v ?? BigInt(sig.yParity! + 27)), r: sig.r, s: sig.s };
  const hash =
    domain.flavor === 'modern'
      ? await relayer.writeContract({
          address: c.deployment.eas,
          abi: EAS_ATTEST_BY_DELEGATION_ABI.modern,
          functionName: 'attestByDelegation',
          args: [{ schema, data: req, signature, attester: signer.address, deadline }],
        })
      : await relayer.writeContract({
          address: c.deployment.eas,
          abi: EAS_ATTEST_BY_DELEGATION_ABI.legacy,
          functionName: 'attestByDelegation',
          args: [{ schema, data: req, signature, attester: signer.address }],
        });
  const receipt = await c.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('attestation reverted');
  const [log] = parseEventLogs({ abi: EAS_ABI, logs: receipt.logs, eventName: 'Attested' });
  expect(log!.args.attester).toBe(signer.address);
  return log!.args.uid as Hex;
}

function reviewData(reviewerId: Hex, nullifier: Hex, rating = 4) {
  return encodeReview({
    itemId: keccak256(toBytes('item:veg-dum-biryani')),
    rating,
    purchaseNullifier: nullifier,
    reviewerId,
    proofHash: keccak256(toBytes('proof')),
    contentCID: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
    purchaseDay: 20755,
    rail: 1,
    tier: 1,
    brand: 'swiggy',
  });
}

beforeAll(async () => {
  c = await startLocalChain();
  domain = await readEasDomain(c.publicClient, c.deployment.eas);
  const operator = c.wallet(c.keys.operator);
  for (const [n, k] of [
    [humanNullifierA, c.keys.reviewerA],
    [humanNullifierB, c.keys.reviewerB],
  ] as const) {
    const hash = await operator.writeContract({
      address: c.deployment.personhoodRegistry,
      abi: PersonhoodRegistryAbi,
      functionName: 'register',
      args: [n, acct(k).address, 1],
    });
    await c.publicClient.waitForTransactionReceipt({ hash });
  }
}, 120_000);

describe('PersonhoodRegistry', () => {
  it('derives the same reviewerId as @receipts/core', async () => {
    const id = await c.publicClient.readContract({
      address: c.deployment.personhoodRegistry,
      abi: PersonhoodRegistryAbi,
      functionName: 'reviewerIdOf',
      args: [acct(c.keys.reviewerA).address],
    });
    expect(id).toBe(reviewerIdFromNullifier(humanNullifierA));
  });

  it('refuses a second wallet for the same human', async () => {
    await expectRevert(
      c.wallet(c.keys.operator).writeContract({
        address: c.deployment.personhoodRegistry,
        abi: PersonhoodRegistryAbi,
        functionName: 'register',
        args: [humanNullifierA, acct(c.keys.merchant).address, 1],
      }),
      'AlreadyRegistered',
    );
  });
});

describe('ReceiptsResolver via EAS delegated attestations', () => {
  const nullifier = purchaseNullifier('swiggy', 'order-1001');
  let reviewUid: Hex;

  it('detects the local EAS as the modern flavor', () => {
    expect(domain.flavor).toBe('modern');
    expect(domain.version).toBe('1.4.0');
  });

  it('a registered human publishes a review; the relayer pays gas, the reviewer stays the attester', async () => {
    reviewUid = await attestDelegated(c.keys.reviewerA, c.deployment.schemas.review, reviewData(reviewerIdFromNullifier(humanNullifierA), nullifier));
    const used = await c.publicClient.readContract({
      address: c.deployment.resolver,
      abi: ReceiptsResolverAbi,
      functionName: 'reviewOfNullifier',
      args: [nullifier],
    });
    expect(used).toBe(reviewUid);
  });

  it('one purchase, one review: a used nullifier is refused', async () => {
    await expectRevert(
      attestDelegated(c.keys.reviewerB, c.deployment.schemas.review, reviewData(reviewerIdFromNullifier(humanNullifierB), nullifier)),
      'NullifierUsed|reverted',
    );
  });

  it('refuses wallets that are not registered humans, and reviewerIds that are not theirs', async () => {
    await expectRevert(
      attestDelegated(c.keys.merchant, c.deployment.schemas.review, reviewData(reviewerIdFromNullifier(humanNullifierA), purchaseNullifier('swiggy', 'x'))),
      'NotHuman|reverted',
    );
    await expectRevert(
      attestDelegated(c.keys.reviewerB, c.deployment.schemas.review, reviewData(reviewerIdFromNullifier(humanNullifierA), purchaseNullifier('swiggy', 'y'))),
      'ReviewerMismatch|reverted',
    );
  });

  it('next-day follow-up from the original reviewer only, once, inside its window', async () => {
    const data = encodeFollowUp({ dayOffset: 1, stillGood: true, newRating: 0, contentCID: 'bafkreifollowup' });
    await expectRevert(attestDelegated(c.keys.reviewerB, c.deployment.schemas.followUp, data, { refUID: reviewUid }), 'NotOriginalReviewer|reverted');
    const uid = await attestDelegated(c.keys.reviewerA, c.deployment.schemas.followUp, data, { refUID: reviewUid });
    expect(uid).toMatch(/^0x/);
    await expectRevert(attestDelegated(c.keys.reviewerA, c.deployment.schemas.followUp, data, { refUID: reviewUid }), 'FollowUpAlreadyAnswered|reverted');
    const day30 = encodeFollowUp({ dayOffset: 30, stillGood: true, newRating: 0, contentCID: 'bafkreiday30' });
    await expectRevert(attestDelegated(c.keys.reviewerA, c.deployment.schemas.followUp, day30, { refUID: reviewUid }), 'OutsideWindow|reverted');
  });

  it('replies come only from verified merchant wallets', async () => {
    const merchant = acct(c.keys.merchant).address;
    await expectRevert(
      attestDelegated(c.keys.merchant, c.deployment.schemas.reply, encodeReply('bafkreireply'), { refUID: reviewUid }),
      'NotVerifiedMerchant|reverted',
    );
    // The Receipts verifier attests the merchant claim (MerchantV1, recipient = merchant wallet).
    await attestDelegated(
      c.keys.operator,
      c.deployment.schemas.merchant,
      encodeMerchant({ merchantId: keccak256(toBytes('merchant:cafe')), claimMethod: 3, evidenceHash: keccak256(toBytes('upi-1-rupee')) }),
      { revocable: true, recipient: merchant },
    );
    const uid = await attestDelegated(c.keys.merchant, c.deployment.schemas.reply, encodeReply('bafkreireply'), { refUID: reviewUid });
    expect(uid).toMatch(/^0x/);
  });

  it('getAttestation returns the review with the reviewer as attester', async () => {
    const a = await c.publicClient.readContract({ address: c.deployment.eas, abi: EAS_ABI, functionName: 'getAttestation', args: [reviewUid] });
    expect(a.attester).toBe(acct(c.keys.reviewerA).address);
    expect(a.revocable).toBe(false);
  });
});

describe('PayoutDistributor', () => {
  it('posts a cumulative root, pays claims gaslessly and to a chosen wallet, and refuses insolvent roots', async () => {
    const a = acct(c.keys.reviewerA).address;
    const b = acct(c.keys.reviewerB).address;
    const operator = c.wallet(c.keys.operator);
    const deployer = c.wallet(c.keys.deployer);
    const relayer = c.wallet(c.keys.relayer);
    const d = c.deployment.payoutDistributor;
    const wait = async (hash: Hex) => {
      const r = await c.publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('transaction reverted');
      return r;
    };

    await wait(await deployer.writeContract({ address: c.deployment.usdc, abi: MockUSDCAbi, functionName: 'mint', args: [d, 5_000n] }));
    const tree = StandardMerkleTree.of(
      [
        [a, '3500'],
        [b, '1050'],
      ],
      ['address', 'uint256'],
    );
    await expectRevert(
      operator.writeContract({ address: d, abi: PayoutDistributorAbi, functionName: 'postRoot', args: [tree.root as Hex, 1n, 9_999n] }),
      'Insolvent|reverted',
    );
    await wait(await operator.writeContract({ address: d, abi: PayoutDistributorAbi, functionName: 'postRoot', args: [tree.root as Hex, 1n, 4_550n] }));

    const proofA = tree.getProof([a, '3500']) as Hex[];
    await wait(await relayer.writeContract({ address: d, abi: PayoutDistributorAbi, functionName: 'claim', args: [a, 3500n, proofA] }));
    expect(await c.publicClient.readContract({ address: c.deployment.usdc, abi: MockUSDCAbi, functionName: 'balanceOf', args: [a] })).toBe(3500n);
    await expectRevert(relayer.writeContract({ address: d, abi: PayoutDistributorAbi, functionName: 'claim', args: [a, 3500n, proofA] }), 'NothingToClaim|reverted');

    // Reviewer B sends their earnings to another wallet (e.g. Cake Wallet) with a signature; the relayer pays gas.
    const cake = acct(c.keys.agent).address;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const signature = await acct(c.keys.reviewerB).signTypedData({
      domain: { name: 'Receipts Payouts', version: '1', chainId: c.chainId, verifyingContract: d },
      types: {
        ClaimTo: [
          { name: 'account', type: 'address' },
          { name: 'cumulativeAmount', type: 'uint256' },
          { name: 'to', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'ClaimTo',
      message: { account: b, cumulativeAmount: 1050n, to: cake, deadline },
    });
    const proofB = tree.getProof([b, '1050']) as Hex[];
    await wait(await relayer.writeContract({ address: d, abi: PayoutDistributorAbi, functionName: 'claimFor', args: [b, 1050n, proofB, cake, deadline, signature] }));
    expect(await c.publicClient.readContract({ address: c.deployment.usdc, abi: MockUSDCAbi, functionName: 'balanceOf', args: [cake] })).toBe(1050n);
  });
});

describe('ReceiptsReputation', () => {
  it('mints one non-transferable credential per human and follows wallet changes', async () => {
    const a = acct(c.keys.reviewerA).address;
    const operator = c.wallet(c.keys.operator);
    const rep = c.deployment.reputation;
    const wait = async (hash: Hex) => {
      const r = await c.publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('transaction reverted');
      return r;
    };

    await wait(await operator.writeContract({ address: rep, abi: ReceiptsReputationAbi, functionName: 'mint', args: [a] }));
    expect(await c.publicClient.readContract({ address: rep, abi: ReceiptsReputationAbi, functionName: 'levelOf', args: [a] })).toBe(1);
    await expectRevert(operator.writeContract({ address: rep, abi: ReceiptsReputationAbi, functionName: 'mint', args: [a] }), 'AlreadyMinted|reverted');
    await expectRevert(
      c.wallet(c.keys.reviewerA).writeContract({ address: rep, abi: ReceiptsReputationAbi, functionName: 'transferFrom', args: [a, zeroAddress === a ? a : acct(c.keys.merchant).address, 1n] }),
      'Soulbound|reverted',
    );
    await wait(
      await operator.writeContract({ address: rep, abi: ReceiptsReputationAbi, functionName: 'setLevel', args: [reviewerIdFromNullifier(humanNullifierA), 3] }),
    );
    expect(await c.publicClient.readContract({ address: rep, abi: ReceiptsReputationAbi, functionName: 'levelOf', args: [a] })).toBe(3);

    // Changing phones: the registry rebinds the human; the credential follows.
    const newWallet = acct(c.keys.agent).address;
    await wait(
      await operator.writeContract({ address: c.deployment.personhoodRegistry, abi: PersonhoodRegistryAbi, functionName: 'rebind', args: [humanNullifierA, newWallet] }),
    );
    expect(await c.publicClient.readContract({ address: rep, abi: ReceiptsReputationAbi, functionName: 'levelOf', args: [newWallet] })).toBe(3);
    await wait(
      await c.wallet(c.keys.relayer).writeContract({ address: rep, abi: ReceiptsReputationAbi, functionName: 'migrate', args: [reviewerIdFromNullifier(humanNullifierA)] }),
    );
    expect(await c.publicClient.readContract({ address: rep, abi: ReceiptsReputationAbi, functionName: 'ownerOf', args: [1n] })).toBe(newWallet);
    expect(ALL_ERRORS.length).toBeGreaterThan(5);
  });
});
