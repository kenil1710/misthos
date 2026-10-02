// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MisthosVault} from "../src/MisthosVault.sol";
import {MisthosVaultFactory} from "../src/MisthosVaultFactory.sol";
import {BaseScript} from "./Base.s.sol";

/// @notice Deploys the vault implementation and factory, then records both in deployments.json.
/// @dev forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
contract Deploy is BaseScript {
    function run() external returns (MisthosVault implementation, MisthosVaultFactory factory) {
        string memory network = _network();
        uint256 deployBlock = block.number;

        vm.startBroadcast(_deployerKey());
        implementation = new MisthosVault(IERC20(ARC_USDC));
        factory = new MisthosVaultFactory(address(implementation));
        vm.stopBroadcast();

        string memory base = string.concat(".", network);
        vm.writeJson(
            vm.toString(address(implementation)), DEPLOYMENTS, string.concat(base, ".vaultImplementation")
        );
        vm.writeJson(vm.toString(address(factory)), DEPLOYMENTS, string.concat(base, ".vaultFactory"));
        vm.writeJson(vm.toString(deployBlock), DEPLOYMENTS, string.concat(base, ".deployBlock"));
    }
}
