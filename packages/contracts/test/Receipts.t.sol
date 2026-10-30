// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

// Foundry tests. Setup: `forge install foundry-rs/forge-std --no-git`, then `forge test` in packages/contracts.
// The same behaviours are covered by test/contracts.test.ts (vitest on an in-memory EVM), which runs without Foundry.

import {Test} from "forge-std/Test.sol";
import {SchemaRegistry} from "@ethereum-attestation-service/eas-contracts/contracts/SchemaRegistry.sol";
import {EAS} from "@ethereum-attestation-service/eas-contracts/contracts/EAS.sol";
import {
    IEAS,
    AttestationRequest,
    AttestationRequestData
} from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";
import {ISchemaResolver} from "@ethereum-attestation-service/eas-contracts/contracts/resolver/ISchemaResolver.sol";
import {PersonhoodRegistry} from "../src/PersonhoodRegistry.sol";
import {ReceiptsResolver} from "../src/ReceiptsResolver.sol";
import {PayoutDistributor} from "../src/PayoutDistributor.sol";
import {ReceiptsReputation} from "../src/ReceiptsReputation.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract ReceiptsTest is Test {
    string constant REVIEW =
        "bytes32 itemId, uint8 rating, bytes32 purchaseNullifier, bytes32 reviewerId, bytes32 proofHash, string contentCID, uint32 purchaseDay, uint8 rail, uint8 tier, string brand";
    string constant FOLLOWUP = "uint16 dayOffset, bool stillGood, uint8 newRating, string contentCID";
    string constant REPLY = "string contentCID";
    string constant MERCHANT = "bytes32 merchantId, uint8 claimMethod, bytes32 evidenceHash";
    string constant REPUTATION = "address reviewer, uint8 level, uint32 reviews, uint16 reliabilityBps";

    SchemaRegistry schemas;
    EAS eas;
    PersonhoodRegistry humans;
    ReceiptsResolver resolver;
    PayoutDistributor distributor;
    ReceiptsReputation reputation;
    MockUSDC usdc;

    address operator = makeAddr("operator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address cafe = makeAddr("cafe");

    bytes32 reviewSchema;
    bytes32 followUpSchema;
    bytes32 replySchema;
    bytes32 merchantSchema;
    bytes32 reputationSchema;

    function setUp() public {
        schemas = new SchemaRegistry();
        eas = new EAS(schemas);
        humans = new PersonhoodRegistry(address(this), operator);
        resolver = new ReceiptsResolver(IEAS(address(eas)), humans, address(this), operator, operator);
        ISchemaResolver r = ISchemaResolver(address(resolver));
        reviewSchema = schemas.register(REVIEW, r, false);
        followUpSchema = schemas.register(FOLLOWUP, r, false);
        replySchema = schemas.register(REPLY, r, false);
        merchantSchema = schemas.register(MERCHANT, r, true);
        reputationSchema = schemas.register(REPUTATION, r, true);
        resolver.setSchemas(reviewSchema, followUpSchema, replySchema, merchantSchema, reputationSchema);

        usdc = new MockUSDC();
        distributor = new PayoutDistributor(usdc, address(this), operator);
        reputation = new ReceiptsReputation(humans, address(this), operator);

        vm.startPrank(operator);
        humans.register(keccak256("alice"), alice, 1);
        humans.register(keccak256("bob"), bob, 1);
        vm.stopPrank();
    }

    function _req(bytes32 schema, bytes memory data, bytes32 refUID, address recipient, bool revocable)
        internal
        pure
        returns (AttestationRequest memory)
    {
        return AttestationRequest({
            schema: schema,
            data: AttestationRequestData({
                recipient: recipient,
                expirationTime: 0,
                revocable: revocable,
                refUID: refUID,
                data: data,
                value: 0
            })
        });
    }

    function _reviewData(bytes32 reviewerId, bytes32 nullifier, uint8 rating) internal pure returns (bytes memory) {
        return abi.encode(
            keccak256("item"), rating, nullifier, reviewerId, keccak256("proof"), "bafkrei", uint32(20755), uint8(1), uint8(1), "swiggy"
        );
    }

    function _review(address who, bytes32 nullifier) internal returns (bytes32) {
        bytes memory data = _reviewData(humans.reviewerIdOf(who), nullifier, 4);
        vm.prank(who);
        return eas.attest(_req(reviewSchema, data, bytes32(0), address(0), false));
    }

    function test_reviewIdMatchesCorePackage() public view {
        assertEq(humans.reviewerIdOf(alice), keccak256(abi.encode(keccak256("receipts.reviewer.v1"), keccak256("alice"))));
    }

    function test_onePurchaseOneReview() public {
        bytes32 uid = _review(alice, keccak256("order-1"));
        assertEq(resolver.reviewOfNullifier(keccak256("order-1")), uid);

        bytes memory data = _reviewData(humans.reviewerIdOf(bob), keccak256("order-1"), 5);
        vm.expectRevert(ReceiptsResolver.NullifierUsed.selector);
        vm.prank(bob);
        eas.attest(_req(reviewSchema, data, bytes32(0), address(0), false));
    }

    function test_onlyRegisteredHumansWithTheirOwnId() public {
        bytes memory data = _reviewData(humans.reviewerIdOf(alice), keccak256("order-2"), 5);
        vm.expectRevert(ReceiptsResolver.NotHuman.selector);
        vm.prank(cafe);
        eas.attest(_req(reviewSchema, data, bytes32(0), address(0), false));

        vm.expectRevert(ReceiptsResolver.ReviewerMismatch.selector);
        vm.prank(bob);
        eas.attest(_req(reviewSchema, data, bytes32(0), address(0), false));
    }

    function test_followUpWindowAndAuthor() public {
        bytes32 uid = _review(alice, keccak256("order-3"));
        bytes memory nextDay = abi.encode(uint16(1), true, uint8(0), "bafkreifollowup");

        vm.expectRevert(ReceiptsResolver.NotOriginalReviewer.selector);
        vm.prank(bob);
        eas.attest(_req(followUpSchema, nextDay, uid, address(0), false));

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        eas.attest(_req(followUpSchema, nextDay, uid, address(0), false));
        assertTrue(resolver.followUpDone(uid, 1));

        // Day 30 is answerable only between day 25 and day 40.
        bytes memory day30 = abi.encode(uint16(30), true, uint8(0), "bafkreiday30");
        vm.expectRevert();
        vm.prank(alice);
        eas.attest(_req(followUpSchema, day30, uid, address(0), false));
        vm.warp(block.timestamp + 27 days);
        vm.prank(alice);
        eas.attest(_req(followUpSchema, day30, uid, address(0), false));
    }

    function test_repliesOnlyFromVerifiedMerchants() public {
        bytes32 uid = _review(alice, keccak256("order-4"));
        vm.expectRevert(ReceiptsResolver.NotVerifiedMerchant.selector);
        vm.prank(cafe);
        eas.attest(_req(replySchema, abi.encode("bafkreireply"), uid, address(0), false));

        vm.prank(operator);
        eas.attest(_req(merchantSchema, abi.encode(keccak256("cafe"), uint8(3), keccak256("upi")), bytes32(0), cafe, true));
        assertEq(resolver.merchantOf(cafe), keccak256("cafe"));

        vm.prank(cafe);
        eas.attest(_req(replySchema, abi.encode("bafkreireply"), uid, address(0), false));
    }

    function _leaf(address a, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a, amount))));
    }

    function test_cumulativePayouts() public {
        bytes32 la = _leaf(alice, 3500);
        bytes32 lb = _leaf(bob, 1050);
        bytes32 root = la < lb ? keccak256(abi.encodePacked(la, lb)) : keccak256(abi.encodePacked(lb, la));
        usdc.mint(address(distributor), 5000);

        vm.expectRevert();
        vm.prank(operator);
        distributor.postRoot(root, 1, 9999);

        vm.prank(operator);
        distributor.postRoot(root, 1, 4550);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = lb;
        distributor.claim(alice, 3500, proof);
        assertEq(usdc.balanceOf(alice), 3500);

        vm.expectRevert(PayoutDistributor.NothingToClaim.selector);
        distributor.claim(alice, 3500, proof);
    }

    function test_reputationIsSoulboundAndFollowsTheHuman() public {
        vm.prank(operator);
        uint256 tokenId = reputation.mint(alice);
        assertEq(reputation.levelOf(alice), 1);

        vm.expectRevert(ReceiptsReputation.Soulbound.selector);
        vm.prank(alice);
        reputation.transferFrom(alice, bob, tokenId);

        address newPhone = makeAddr("newPhone");
        vm.prank(operator);
        humans.rebind(keccak256("alice"), newPhone);
        reputation.migrate(humans.reviewerIdOf(newPhone));
        assertEq(reputation.ownerOf(tokenId), newPhone);
        assertEq(reputation.levelOf(newPhone), 1);
    }
}
