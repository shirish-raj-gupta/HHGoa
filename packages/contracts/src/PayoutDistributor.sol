// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title PayoutDistributor
/// @notice Cumulative Merkle distributor for reviewer earnings in USDC. Receipts posts one root per daily epoch;
///         leaves are (account, cumulativeAmount), so nobody loses an epoch they did not claim.
/// @dev Leaves use the OpenZeppelin StandardMerkleTree encoding with types ["address", "uint256"].
contract PayoutDistributor is AccessControl, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant ROOT_POSTER_ROLE = keccak256("ROOT_POSTER_ROLE");
    bytes32 public constant CLAIM_TO_TYPEHASH =
        keccak256("ClaimTo(address account,uint256 cumulativeAmount,address to,uint256 deadline)");

    IERC20 public immutable token;
    bytes32 public merkleRoot;
    uint256 public epoch;
    /// @notice Sum of every cumulative amount in the current root.
    uint256 public totalCumulative;
    uint256 public totalClaimed;
    mapping(address account => uint256) public claimed;

    event RootPosted(uint256 indexed epoch, bytes32 root, uint256 totalCumulative);
    event Claimed(address indexed account, address indexed to, uint256 amount, uint256 cumulativeAmount);

    error StaleEpoch();
    error Insolvent(uint256 available, uint256 required);
    error InvalidProof();
    error NothingToClaim();
    error Expired();
    error BadSignature();

    constructor(IERC20 token_, address admin, address poster) EIP712("Receipts Payouts", "1") {
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ROOT_POSTER_ROLE, poster);
    }

    /// @notice Post the root for a new epoch. Refused unless the contract can pay everything the root promises.
    function postRoot(bytes32 root, uint256 newEpoch, uint256 newTotalCumulative) external onlyRole(ROOT_POSTER_ROLE) {
        if (newEpoch <= epoch) revert StaleEpoch();
        uint256 available = token.balanceOf(address(this)) + totalClaimed;
        if (available < newTotalCumulative) revert Insolvent(available, newTotalCumulative);
        merkleRoot = root;
        epoch = newEpoch;
        totalCumulative = newTotalCumulative;
        emit RootPosted(newEpoch, root, newTotalCumulative);
    }

    /// @notice Anyone (usually the relayer, so reviewers never need gas) can claim; funds always go to `account`.
    function claim(address account, uint256 cumulativeAmount, bytes32[] calldata proof) external returns (uint256) {
        return _claim(account, account, cumulativeAmount, proof);
    }

    /// @notice Gasless claim to a wallet the reviewer chose (e.g. Cake Wallet), authorised by their EIP-712 signature.
    function claimFor(
        address account,
        uint256 cumulativeAmount,
        bytes32[] calldata proof,
        address to,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256) {
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(CLAIM_TO_TYPEHASH, account, cumulativeAmount, to, deadline)));
        if (!SignatureChecker.isValidSignatureNow(account, digest, signature)) revert BadSignature();
        return _claim(account, to, cumulativeAmount, proof);
    }

    function claimable(address account, uint256 cumulativeAmount, bytes32[] calldata proof)
        external
        view
        returns (uint256)
    {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, cumulativeAmount))));
        if (!MerkleProof.verifyCalldata(proof, merkleRoot, leaf)) return 0;
        uint256 already = claimed[account];
        return cumulativeAmount > already ? cumulativeAmount - already : 0;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _claim(address account, address to, uint256 cumulativeAmount, bytes32[] calldata proof)
        private
        returns (uint256 amount)
    {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, cumulativeAmount))));
        if (!MerkleProof.verifyCalldata(proof, merkleRoot, leaf)) revert InvalidProof();
        uint256 already = claimed[account];
        if (cumulativeAmount <= already) revert NothingToClaim();
        amount = cumulativeAmount - already;
        claimed[account] = cumulativeAmount;
        totalClaimed += amount;
        token.safeTransfer(to, amount);
        emit Claimed(account, to, amount, cumulativeAmount);
    }
}
