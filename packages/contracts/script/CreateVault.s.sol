// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MisthosVault} from "../src/MisthosVault.sol";
import {MisthosVaultFactory} from "../src/MisthosVaultFactory.sol";
import {BaseScript} from "./Base.s.sol";

/// @notice Creates the Phase 1 smoke-test vault from the deployed factory and funds it.
/// @dev Owner and (until the Circle agent wallet exists) agent are the deployer. Env overrides:
///      AGENT_ADDRESS, FUND_USDC (whole USDC, default 5), SMOKE_PROGRAM (default "misthos-smoke-test").
///      forge script script/CreateVault.s.sol --rpc-url arc_testnet --broadcast
contract CreateVault is BaseScript {
    function run() external returns (MisthosVault vault) {
        string memory network = _network();
        string memory base = string.concat(".", network);
        MisthosVaultFactory factory = MisthosVaultFactory(
            vm.parseJsonAddress(vm.readFile(DEPLOYMENTS), string.concat(base, ".vaultFactory"))
        );

        uint256 key = _deployerKey();
        address deployer = vm.addr(key);
        address agent = vm.envOr("AGENT_ADDRESS", deployer);
        bytes32 programId = keccak256(bytes(vm.envOr("SMOKE_PROGRAM", string("misthos-smoke-test"))));
        uint256 fund = vm.envOr("FUND_USDC", uint256(5)) * 1e6;

        MisthosVault.Limits memory limits = MisthosVault.Limits({
            maxPerPayout: 2e6,
            maxPerRound: 5e6,
            maxPerDay: 10e6,
            autoApproveThreshold: 3e6,
            payeeCooldown: 2 minutes
        });

        vm.startBroadcast(key);
        vault = MisthosVault(factory.createVault(programId, deployer, agent, address(0), limits));
        IERC20(ARC_USDC).approve(address(vault), fund);
        vault.deposit(fund);
        vm.stopBroadcast();

        require(vault.balance() == fund, "funding mismatch");
        vm.writeJson(vm.toString(address(vault)), DEPLOYMENTS, string.concat(base, ".smokeVault"));
    }
}
