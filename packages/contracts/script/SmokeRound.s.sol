// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MisthosVault} from "../src/MisthosVault.sol";
import {BaseScript} from "./Base.s.sol";

/// @notice Exercises a real payout round on the smoke vault with real Arc USDC. Two steps, because a new payee
///         is not payable until the cooldown (2 minutes on the smoke vault) has passed:
///   forge script script/SmokeRound.s.sol --sig "register()" --rpc-url arc_testnet --broadcast
///   forge script script/SmokeRound.s.sol --sig "pay()"      --rpc-url arc_testnet --broadcast
/// @dev Requires the deployer to be the vault's agent (true until setAgent moves it to the Circle wallet).
///      SMOKE_PAYEE defaults to the deployer, so the test funds come back.
contract SmokeRound is BaseScript {
    bytes32 internal constant CONTRIBUTOR = keccak256("smoke-contributor-1");

    function _vault() internal view returns (MisthosVault) {
        string memory key = string.concat(".", _network(), ".smokeVault");
        return MisthosVault(vm.parseJsonAddress(vm.readFile(DEPLOYMENTS), key));
    }

    function _payee() internal view returns (address) {
        return vm.envOr("SMOKE_PAYEE", vm.addr(_deployerKey()));
    }

    function register() external {
        MisthosVault vault = _vault();
        vm.startBroadcast(_deployerKey());
        vault.registerPayee(CONTRIBUTOR, _payee());
        vm.stopBroadcast();
    }

    function pay() external {
        MisthosVault vault = _vault();
        address payee = _payee();
        bytes32 roundId = keccak256(abi.encode("smoke-round", block.timestamp));

        MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](1);
        ps[0] = MisthosVault.Payout({
            payoutId: keccak256(abi.encode(vault.programId(), roundId, CONTRIBUTOR)),
            contributorId: CONTRIBUTOR,
            to: payee,
            amount: 1e6,
            decisionHash: keccak256("smoke-decision")
        });
        uint256 before = IERC20(ARC_USDC).balanceOf(payee);

        vm.startBroadcast(_deployerKey());
        vault.proposeRound(roundId, ps, keccak256(abi.encode(ps)));
        vault.executeRound(roundId);
        vm.stopBroadcast();

        require(IERC20(ARC_USDC).balanceOf(payee) >= before + 1e6 - 1e6 / 10, "payee not credited");
        require(vault.paid(ps[0].payoutId), "payout not marked paid");
    }
}
