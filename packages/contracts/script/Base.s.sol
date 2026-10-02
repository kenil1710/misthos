// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

/// @notice Shared helpers: network resolution, the mainnet guard, and the deployments.json path.
abstract contract BaseScript is Script {
    /// @dev ERC-20 view of native USDC on Arc, same address on testnet and mainnet (docs.arc.io contract-addresses).
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant ARC_TESTNET = 5042002;
    uint256 internal constant ARC_MAINNET = 5042;
    string internal constant DEPLOYMENTS = "../shared/src/deployments.json";

    /// @dev Returns the deployments.json key for the current chain. Refuses mainnet unless ALLOW_MAINNET=true.
    function _network() internal view returns (string memory) {
        if (block.chainid == ARC_TESTNET) return "arc-testnet";
        if (block.chainid == ARC_MAINNET) {
            require(
                vm.envOr("ALLOW_MAINNET", false), "mainnet deploy needs ALLOW_MAINNET=true and owner sign-off"
            );
            return "arc-mainnet";
        }
        revert("unsupported chain");
    }

    function _deployerKey() internal view returns (uint256) {
        return vm.envUint("DEPLOYER_PRIVATE_KEY");
    }
}
