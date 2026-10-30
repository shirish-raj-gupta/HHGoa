// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PersonhoodRegistry
/// @notice One unique human, one wallet. A human is identified by an app-scoped personhood nullifier (Self, or
///         Anon Aadhaar as a fallback); only the derived reviewerId is stored, never the nullifier itself.
/// @dev For the hackathon the Receipts verifier key registers humans after the off-chain proof check. Later, verify
///      Anon Aadhaar proofs on-chain with the anon-aadhaar contracts package.
contract PersonhoodRegistry is AccessControl {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant REVIEWER_DOMAIN = keccak256("receipts.reviewer.v1");

    struct Human {
        address wallet;
        uint8 idType;
        uint64 verifiedAt;
    }

    mapping(bytes32 reviewerId => Human) private _humans;

    /// @notice The reviewer's public ID for a wallet; zero when the wallet is not a registered human.
    mapping(address wallet => bytes32 reviewerId) public reviewerIdOf;

    event HumanRegistered(bytes32 indexed reviewerId, address indexed wallet, uint8 idType);
    event HumanRebound(bytes32 indexed reviewerId, address indexed oldWallet, address indexed newWallet);

    error AlreadyRegistered();
    error WalletInUse();
    error UnknownHuman();
    error ZeroAddress();

    constructor(address admin, address verifier) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, verifier);
    }

    /// @notice reviewerId = keccak256(abi.encode(REVIEWER_DOMAIN, nullifierHash)); matches the core package.
    function reviewerIdFor(bytes32 nullifierHash) public pure returns (bytes32) {
        return keccak256(abi.encode(REVIEWER_DOMAIN, nullifierHash));
    }

    /// @notice Register a verified human. A second wallet for the same nullifier is refused.
    function register(bytes32 nullifierHash, address wallet, uint8 idType)
        external
        onlyRole(VERIFIER_ROLE)
        returns (bytes32 reviewerId)
    {
        if (wallet == address(0)) revert ZeroAddress();
        reviewerId = reviewerIdFor(nullifierHash);
        if (_humans[reviewerId].wallet != address(0)) revert AlreadyRegistered();
        if (reviewerIdOf[wallet] != bytes32(0)) revert WalletInUse();
        _humans[reviewerId] = Human(wallet, idType, uint64(block.timestamp));
        reviewerIdOf[wallet] = reviewerId;
        emit HumanRegistered(reviewerId, wallet, idType);
    }

    /// @notice Changing phones: a fresh proof with the same nullifier moves the binding to a new wallet. Old reviews
    ///         stay attributed to the same reviewerId.
    function rebind(bytes32 nullifierHash, address newWallet) external onlyRole(VERIFIER_ROLE) {
        if (newWallet == address(0)) revert ZeroAddress();
        bytes32 reviewerId = reviewerIdFor(nullifierHash);
        Human storage h = _humans[reviewerId];
        if (h.wallet == address(0)) revert UnknownHuman();
        if (reviewerIdOf[newWallet] != bytes32(0)) revert WalletInUse();
        address old = h.wallet;
        delete reviewerIdOf[old];
        h.wallet = newWallet;
        h.verifiedAt = uint64(block.timestamp);
        reviewerIdOf[newWallet] = reviewerId;
        emit HumanRebound(reviewerId, old, newWallet);
    }

    function isHuman(address wallet) external view returns (bool) {
        return reviewerIdOf[wallet] != bytes32(0);
    }

    function walletOf(bytes32 reviewerId) external view returns (address) {
        return _humans[reviewerId].wallet;
    }

    function humanOf(bytes32 reviewerId) external view returns (Human memory) {
        return _humans[reviewerId];
    }
}
