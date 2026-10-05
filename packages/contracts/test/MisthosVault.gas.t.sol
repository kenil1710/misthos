// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./utils/Base.t.sol";
import {MisthosVault} from "../src/MisthosVault.sol";

/// @notice The agent plans at most 50 payouts per round (MAX_PAYOUTS_PER_ROUND in packages/agent/src/rounds/plan.ts)
///         because Arc's block gas limit is 30M and a 200-payout proposal alone costs ~30.4M. Keep both calls of a
///         full agent round under half a block, leaving headroom for the real USDC precompile and the SCA wrapper.
contract RoundGasTest is BaseTest {
    uint256 internal constant AGENT_MAX_PAYOUTS = 50;
    uint256 internal constant HALF_BLOCK = 15_000_000;

    function test_fullAgentRound_fitsInHalfABlock() public {
        vm.prank(owner);
        vault.setLimits(
            MisthosVault.Limits({
                maxPerPayout: 1 * USDC,
                maxPerRound: 1_000 * USDC,
                maxPerDay: 1_000 * USDC,
                autoApproveThreshold: 1_000 * USDC,
                payeeCooldown: 0
            })
        );
        _registerPayees(AGENT_MAX_PAYOUTS);
        MisthosVault.Payout[] memory ps = _payouts("max", AGENT_MAX_PAYOUTS, 1 * USDC);

        uint256 g = gasleft();
        _propose("max", ps);
        uint256 proposeGas = g - gasleft();
        g = gasleft();
        _execute("max");
        uint256 executeGas = g - gasleft();

        emit log_named_uint("proposeRound gas (50 payouts)", proposeGas);
        emit log_named_uint("executeRound gas (50 payouts)", executeGas);
        assertLt(proposeGas, HALF_BLOCK);
        assertLt(executeGas, HALF_BLOCK);
    }
}
