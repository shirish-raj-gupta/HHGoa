// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title ReceiptsGovernanceToken
/// @notice TESTNET ONLY. Fixed-supply voting token for fee splits, trust-parameter changes and category launches.
///         Never used to pay reviewers or to lift rankings. Stays off mainnet until a lawyer signs off.
contract ReceiptsGovernanceToken is ERC20, ERC20Permit, ERC20Votes {
    uint256 public constant SUPPLY = 100_000_000e18;

    constructor(address holder) ERC20("Receipts Governance (testnet)", "tRCPT") ERC20Permit("Receipts Governance (testnet)") {
        _mint(holder, SUPPLY);
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
