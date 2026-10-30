// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SchemaResolver} from "@ethereum-attestation-service/eas-contracts/contracts/resolver/SchemaResolver.sol";
import {IEAS, Attestation} from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";
import {PersonhoodRegistry} from "./PersonhoodRegistry.sol";

/// @title ReceiptsResolver
/// @notice EAS schema resolver for every Receipts schema. A review exists only if its attester is a registered
///         human, the reviewerId in the data is theirs, and the purchase nullifier has never been used. Follow-ups
///         come only from the original reviewer inside the check-in window; replies only from verified merchants.
/// @dev Register each schema with this resolver, then call setSchemas with the UIDs.
contract ReceiptsResolver is SchemaResolver, Ownable {
    PersonhoodRegistry public immutable registry;

    bytes32 public reviewSchema;
    bytes32 public followUpSchema;
    bytes32 public replySchema;
    bytes32 public merchantSchema;
    bytes32 public reputationSchema;

    /// @notice Receipts' merchant verifier: the only attester of MerchantV1.
    address public verifier;
    /// @notice The trust engine: the only attester of ReputationV1.
    address public trustEngine;

    /// @notice One purchase, one review: the review UID that used each purchase nullifier.
    mapping(bytes32 nullifier => bytes32 reviewUid) public reviewOfNullifier;
    mapping(bytes32 reviewUid => mapping(uint16 dayOffset => bool)) public followUpDone;
    /// @notice Verified merchant wallets, set by MerchantV1 attestations.
    mapping(address wallet => bytes32 merchantId) public merchantOf;

    event SchemasSet(bytes32 review, bytes32 followUp, bytes32 reply, bytes32 merchant, bytes32 reputation);
    event VerifierSet(address verifier);
    event TrustEngineSet(address trustEngine);
    event ReviewRecorded(bytes32 indexed uid, bytes32 indexed reviewerId, bytes32 indexed itemId, uint8 rating, bytes32 nullifier);
    event FollowUpRecorded(bytes32 indexed reviewUid, bytes32 uid, uint16 dayOffset, bool stillGood);
    event ReplyRecorded(bytes32 indexed reviewUid, bytes32 uid, bytes32 indexed merchantId);
    event MerchantVerified(bytes32 indexed merchantId, address indexed wallet, uint8 claimMethod);
    event MerchantUnverified(bytes32 indexed merchantId, address indexed wallet);

    error UnknownSchema();
    error BadRating();
    error NotHuman();
    error ReviewerMismatch();
    error NullifierUsed();
    error ZeroNullifier();
    error NotAReview();
    error NotOriginalReviewer();
    error OutsideWindow(uint256 elapsed, uint256 lower, uint256 upper);
    error FollowUpAlreadyAnswered();
    error NotVerifiedMerchant();
    error NotVerifier();
    error NotTrustEngine();
    error MalformedData();

    constructor(IEAS eas, PersonhoodRegistry registry_, address owner_, address verifier_, address trustEngine_)
        SchemaResolver(eas)
        Ownable(owner_)
    {
        registry = registry_;
        verifier = verifier_;
        trustEngine = trustEngine_;
    }

    function setSchemas(bytes32 review, bytes32 followUp, bytes32 reply, bytes32 merchant, bytes32 reputation)
        external
        onlyOwner
    {
        reviewSchema = review;
        followUpSchema = followUp;
        replySchema = reply;
        merchantSchema = merchant;
        reputationSchema = reputation;
        emit SchemasSet(review, followUp, reply, merchant, reputation);
    }

    function setVerifier(address verifier_) external onlyOwner {
        verifier = verifier_;
        emit VerifierSet(verifier_);
    }

    function setTrustEngine(address trustEngine_) external onlyOwner {
        trustEngine = trustEngine_;
        emit TrustEngineSet(trustEngine_);
    }

    /// @notice Window for a follow-up at dayOffset days: [D - max(1, D/6), D + max(2, D/3)] days after the review.
    ///         30 -> days 25..40, 1 -> 0..3. Matches followUpWindowDays in the core package.
    function followUpWindow(uint16 dayOffset) public pure returns (uint256 lower, uint256 upper) {
        uint256 d = dayOffset;
        uint256 lowerSlack = d / 6 > 1 ? d / 6 : 1;
        uint256 upperSlack = d / 3 > 2 ? d / 3 : 2;
        lower = d > lowerSlack ? (d - lowerSlack) * 1 days : 0;
        upper = (d + upperSlack) * 1 days;
    }

    function onAttest(Attestation calldata attestation, uint256 /* value */ ) internal override returns (bool) {
        bytes32 schema = attestation.schema;
        if (schema == bytes32(0)) revert UnknownSchema();
        if (schema == reviewSchema) return _onReview(attestation);
        if (schema == followUpSchema) return _onFollowUp(attestation);
        if (schema == replySchema) return _onReply(attestation);
        if (schema == merchantSchema) return _onMerchant(attestation);
        if (schema == reputationSchema) {
            if (attestation.attester != trustEngine) revert NotTrustEngine();
            return true;
        }
        revert UnknownSchema();
    }

    function onRevoke(Attestation calldata attestation, uint256 /* value */ ) internal override returns (bool) {
        if (attestation.schema == merchantSchema) {
            bytes32 merchantId = merchantOf[attestation.recipient];
            delete merchantOf[attestation.recipient];
            emit MerchantUnverified(merchantId, attestation.recipient);
            return true;
        }
        // Reputation levels are corrected by revoking and re-attesting. Reviews, follow-ups and replies are
        // registered as non-revocable, so EAS never reaches this point for them.
        return attestation.schema == reputationSchema;
    }

    // ReviewV1: bytes32 itemId, uint8 rating, bytes32 purchaseNullifier, bytes32 reviewerId, bytes32 proofHash,
    //           string contentCID, uint32 purchaseDay, uint8 rail, uint8 tier, string brand
    function _onReview(Attestation calldata a) private returns (bool) {
        if (a.data.length < 320) revert MalformedData();
        (bytes32 itemId, uint8 rating, bytes32 nullifier, bytes32 reviewerId) =
            abi.decode(a.data[0:128], (bytes32, uint8, bytes32, bytes32));
        if (rating < 1 || rating > 5) revert BadRating();
        bytes32 attesterId = registry.reviewerIdOf(a.attester);
        if (attesterId == bytes32(0)) revert NotHuman();
        if (attesterId != reviewerId) revert ReviewerMismatch();
        if (nullifier == bytes32(0)) revert ZeroNullifier();
        if (reviewOfNullifier[nullifier] != bytes32(0)) revert NullifierUsed();
        reviewOfNullifier[nullifier] = a.uid;
        emit ReviewRecorded(a.uid, reviewerId, itemId, rating, nullifier);
        return true;
    }

    // FollowUpV1: uint16 dayOffset, bool stillGood, uint8 newRating, string contentCID (refUID = review)
    function _onFollowUp(Attestation calldata a) private returns (bool) {
        if (a.data.length < 128) revert MalformedData();
        (uint16 dayOffset, bool stillGood, uint8 newRating) = abi.decode(a.data[0:96], (uint16, bool, uint8));
        if (newRating > 5) revert BadRating();
        Attestation memory review = _eas.getAttestation(a.refUID);
        if (review.schema != reviewSchema || review.uid == bytes32(0)) revert NotAReview();
        // The original reviewer, compared by reviewerId so a reviewer who changed phones can still answer.
        bytes32 attesterId = registry.reviewerIdOf(a.attester);
        if (attesterId == bytes32(0) || attesterId != _reviewerIdOf(review.data)) revert NotOriginalReviewer();
        (uint256 lower, uint256 upper) = followUpWindow(dayOffset);
        uint256 elapsed = block.timestamp - review.time;
        if (elapsed < lower || elapsed > upper) revert OutsideWindow(elapsed, lower, upper);
        if (followUpDone[a.refUID][dayOffset]) revert FollowUpAlreadyAnswered();
        followUpDone[a.refUID][dayOffset] = true;
        emit FollowUpRecorded(a.refUID, a.uid, dayOffset, stillGood);
        return true;
    }

    // ReplyV1: string contentCID (refUID = review; attester = verified merchant wallet)
    function _onReply(Attestation calldata a) private returns (bool) {
        bytes32 merchantId = merchantOf[a.attester];
        if (merchantId == bytes32(0)) revert NotVerifiedMerchant();
        Attestation memory review = _eas.getAttestation(a.refUID);
        if (review.schema != reviewSchema || review.uid == bytes32(0)) revert NotAReview();
        emit ReplyRecorded(a.refUID, a.uid, merchantId);
        return true;
    }

    // MerchantV1: bytes32 merchantId, uint8 claimMethod, bytes32 evidenceHash (attester = verifier, recipient = wallet)
    function _onMerchant(Attestation calldata a) private returns (bool) {
        if (a.attester != verifier) revert NotVerifier();
        if (a.recipient == address(0) || a.data.length < 96) revert MalformedData();
        (bytes32 merchantId, uint8 claimMethod,) = abi.decode(a.data, (bytes32, uint8, bytes32));
        merchantOf[a.recipient] = merchantId;
        emit MerchantVerified(merchantId, a.recipient, claimMethod);
        return true;
    }

    /// @dev reviewerId is the fourth static word of ReviewV1 data.
    function _reviewerIdOf(bytes memory reviewData) private pure returns (bytes32 reviewerId) {
        if (reviewData.length < 128) return bytes32(0);
        assembly {
            reviewerId := mload(add(reviewData, 128))
        }
    }
}
