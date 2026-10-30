// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {PersonhoodRegistry} from "./PersonhoodRegistry.sol";

/// @notice ERC-5192 minimal soulbound interface.
interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);

    function locked(uint256 tokenId) external view returns (bool);
}

/// @title ReceiptsReputation
/// @notice A non-transferable reviewer credential: one token per verified human, minted with their first review.
///         Its level (0-5) is set by the trust engine from the track-record score and review count, and is zeroed
///         when the investigator confirms ring membership. It can never be bought, sold or farmed.
/// @dev Keyed by reviewerId, so it follows the personhood registry: after a wallet change anyone can call migrate.
contract ReceiptsReputation is ERC721, AccessControl, IERC5192 {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant LEVEL_SETTER_ROLE = keccak256("LEVEL_SETTER_ROLE");
    uint8 public constant MAX_LEVEL = 5;

    PersonhoodRegistry public immutable registry;
    uint256 public nextTokenId = 1;

    mapping(bytes32 reviewerId => uint256 tokenId) public tokenOfReviewer;
    mapping(uint256 tokenId => bytes32 reviewerId) public reviewerOfToken;
    mapping(uint256 tokenId => uint8 level) public levelOfToken;

    bool private _migrating;

    event LevelChanged(uint256 indexed tokenId, bytes32 indexed reviewerId, uint8 oldLevel, uint8 newLevel);

    error Soulbound();
    error NotHuman();
    error AlreadyMinted();
    error NoToken();
    error BadLevel();

    constructor(PersonhoodRegistry registry_, address admin, address minter) ERC721("Receipts Reviewer", "RCPT-REP") {
        registry = registry_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(LEVEL_SETTER_ROLE, minter);
    }

    /// @notice Mint the credential to a registered human. One per human, ever.
    function mint(address wallet) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        bytes32 reviewerId = registry.reviewerIdOf(wallet);
        if (reviewerId == bytes32(0)) revert NotHuman();
        if (tokenOfReviewer[reviewerId] != 0) revert AlreadyMinted();
        tokenId = nextTokenId++;
        tokenOfReviewer[reviewerId] = tokenId;
        reviewerOfToken[tokenId] = reviewerId;
        levelOfToken[tokenId] = 1;
        _mint(wallet, tokenId);
        emit Locked(tokenId);
        emit LevelChanged(tokenId, reviewerId, 0, 1);
    }

    function setLevel(bytes32 reviewerId, uint8 level) external onlyRole(LEVEL_SETTER_ROLE) {
        if (level > MAX_LEVEL) revert BadLevel();
        uint256 tokenId = tokenOfReviewer[reviewerId];
        if (tokenId == 0) revert NoToken();
        uint8 old = levelOfToken[tokenId];
        levelOfToken[tokenId] = level;
        emit LevelChanged(tokenId, reviewerId, old, level);
    }

    /// @notice Move the credential to the wallet the registry now binds to this reviewer.
    function migrate(bytes32 reviewerId) external {
        uint256 tokenId = tokenOfReviewer[reviewerId];
        if (tokenId == 0) revert NoToken();
        address to = registry.walletOf(reviewerId);
        address from = _ownerOf(tokenId);
        if (to == address(0) || to == from) return;
        _migrating = true;
        _transfer(from, to, tokenId);
        _migrating = false;
    }

    /// @notice What agents read: a wallet's reviewer level, 0 if none.
    function levelOf(address wallet) external view returns (uint8) {
        uint256 tokenId = tokenOfReviewer[registry.reviewerIdOf(wallet)];
        return tokenId == 0 ? 0 : levelOfToken[tokenId];
    }

    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory level = uint256(levelOfToken[tokenId]).toString();
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><rect width="320" height="320" rx="24" fill="#111"/>',
            '<text x="160" y="120" font-family="monospace" font-size="22" fill="#f5f5f4" text-anchor="middle">RECEIPTS REVIEWER</text>',
            '<text x="160" y="200" font-family="monospace" font-size="64" fill="#facc15" text-anchor="middle">L',
            level,
            '</text><text x="160" y="250" font-family="monospace" font-size="14" fill="#a8a29e" text-anchor="middle">non-transferable</text></svg>'
        );
        string memory json = string.concat(
            '{"name":"Receipts reviewer #',
            tokenId.toString(),
            '","description":"Non-transferable reviewer credential. Level set by the Receipts trust engine from how well this reviewer predicted later verified buyers.",',
            '"attributes":[{"trait_type":"Level","value":',
            level,
            '}],"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @dev Any transfer reverts except mint, burn and registry-driven migration.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0) && !_migrating) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
