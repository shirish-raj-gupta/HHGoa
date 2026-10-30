// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

// Foundry alternative to scripts/deploy.ts (which also writes deployments/index.json for the apps):
//   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast
// Env: DEPLOYER_PRIVATE_KEY, USDC_ADDRESS, OPERATOR_ADDRESS (verifier, trust engine and root poster).

import {Script, console2} from "forge-std/Script.sol";
import {IEAS} from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";
import {ISchemaRegistry} from "@ethereum-attestation-service/eas-contracts/contracts/ISchemaRegistry.sol";
import {ISchemaResolver} from "@ethereum-attestation-service/eas-contracts/contracts/resolver/ISchemaResolver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PersonhoodRegistry} from "../src/PersonhoodRegistry.sol";
import {ReceiptsResolver} from "../src/ReceiptsResolver.sol";
import {PayoutDistributor} from "../src/PayoutDistributor.sol";
import {ReceiptsReputation} from "../src/ReceiptsReputation.sol";

contract Deploy is Script {
    // EAS is predeployed on Base and Base Sepolia at the same addresses.
    IEAS constant EAS = IEAS(0x4200000000000000000000000000000000000021);
    ISchemaRegistry constant SCHEMAS = ISchemaRegistry(0x4200000000000000000000000000000000000020);

    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(key);
        address operator = vm.envOr("OPERATOR_ADDRESS", deployer);
        IERC20 usdc = IERC20(vm.envAddress("USDC_ADDRESS"));

        vm.startBroadcast(key);
        PersonhoodRegistry humans = new PersonhoodRegistry(deployer, operator);
        ReceiptsResolver resolver = new ReceiptsResolver(EAS, humans, deployer, operator, operator);
        PayoutDistributor distributor = new PayoutDistributor(usdc, deployer, operator);
        ReceiptsReputation reputation = new ReceiptsReputation(humans, deployer, operator);

        ISchemaResolver r = ISchemaResolver(address(resolver));
        bytes32 review = SCHEMAS.register(
            "bytes32 itemId, uint8 rating, bytes32 purchaseNullifier, bytes32 reviewerId, bytes32 proofHash, string contentCID, uint32 purchaseDay, uint8 rail, uint8 tier, string brand",
            r,
            false
        );
        bytes32 followUp = SCHEMAS.register("uint16 dayOffset, bool stillGood, uint8 newRating, string contentCID", r, false);
        bytes32 reply = SCHEMAS.register("string contentCID", r, false);
        bytes32 merchant = SCHEMAS.register("bytes32 merchantId, uint8 claimMethod, bytes32 evidenceHash", r, true);
        bytes32 rep = SCHEMAS.register("address reviewer, uint8 level, uint32 reviews, uint16 reliabilityBps", r, true);
        resolver.setSchemas(review, followUp, reply, merchant, rep);
        vm.stopBroadcast();

        console2.log("PersonhoodRegistry", address(humans));
        console2.log("ReceiptsResolver", address(resolver));
        console2.log("PayoutDistributor", address(distributor));
        console2.log("ReceiptsReputation", address(reputation));
        console2.logBytes32(review);
        console2.logBytes32(followUp);
        console2.logBytes32(reply);
        console2.logBytes32(merchant);
        console2.logBytes32(rep);
    }
}
