// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MisthosVault} from "../src/MisthosVault.sol";
import {BaseTest} from "./utils/Base.t.sol";

contract VaultFuzzTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _registerPayees(20);
        _fund(1_000_000 * USDC);
    }

    /// @notice No single transfer ever exceeds maxPerPayout, and no executed round exceeds maxPerRound.
    function testFuzz_payoutAndRoundCaps(uint256 seed, uint8 count) public {
        uint256 n = bound(count, 1, 20);
        MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](n);
        uint256 total;
        bool overPayout;
        for (uint256 i; i < n; ++i) {
            uint256 amt = bound(uint256(keccak256(abi.encode(seed, i))), 1, 150 * USDC);
            ps[i] = _payout("r", i, amt);
            total += amt;
            if (amt > 100 * USDC) overPayout = true;
        }

        vm.prank(agent);
        try vault.proposeRound("r", ps, bytes32(0)) {
            assertFalse(overPayout, "proposed a payout over maxPerPayout");
            assertLe(total, 500 * USDC, "proposed a round over maxPerRound");
        } catch {
            assertTrue(overPayout || total > 500 * USDC, "valid round rejected");
            return;
        }

        vm.prank(owner);
        vault.approveRound("r");
        _execute("r");
        for (uint256 i; i < n; ++i) {
            assertLe(usdc.balanceOf(ps[i].to), 100 * USDC);
        }
        assertEq(vault.totalPaid(), total);
    }

    /// @notice Over any sequence of executions and time gaps, outflow in any 24h window stays <= maxPerDay.
    function testFuzz_dailyCapNeverExceeded(uint256 seed) public {
        uint256[] memory times = new uint256[](12);
        uint256[] memory amounts = new uint256[](12);
        uint256 executed;

        for (uint256 k; k < 12; ++k) {
            vm.warp(block.timestamp + bound(uint256(keccak256(abi.encode(seed, "dt", k))), 0, 30 hours));
            uint256 n = bound(uint256(keccak256(abi.encode(seed, "n", k))), 1, 5);
            bytes32 roundId = keccak256(abi.encode("round", k));
            MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](n);
            uint256 total;
            for (uint256 i; i < n; ++i) {
                uint256 amt = bound(uint256(keccak256(abi.encode(seed, k, i))), 1, 100 * USDC);
                ps[i] = _payout(roundId, i, amt);
                total += amt;
            }
            _propose(roundId, ps);
            vm.prank(owner);
            vault.approveRound(roundId);

            vm.prank(agent);
            try vault.executeRound(roundId) {
                times[executed] = block.timestamp;
                amounts[executed] = total;
                ++executed;
            } catch {}

            // Recompute the window sum independently of the contract.
            uint256 windowSum;
            for (uint256 j; j < executed; ++j) {
                if (times[j] + 24 hours > block.timestamp) windowSum += amounts[j];
            }
            assertLe(windowSum, 1_000 * USDC, "daily cap exceeded");
            assertEq(windowSum, vault.spentInWindow(), "window accounting drift");
        }
    }

    /// @notice A payee registered or changed at time t is never payable before t + cooldown.
    function testFuzz_cooldownEnforced(uint64 cooldown, uint64 wait) public {
        cooldown = uint64(bound(cooldown, 0, 30 days));
        wait = uint64(bound(wait, 0, 60 days));
        MisthosVault.Limits memory l = defaultLimits();
        l.payeeCooldown = cooldown;
        vm.prank(owner);
        vault.setLimits(l);

        vm.prank(agent);
        vault.registerPayee(cid(0), wallet(77));
        vm.warp(block.timestamp + wait);

        MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](1);
        ps[0] = _payout("r", 0, USDC);
        ps[0].to = wallet(77);
        vm.prank(agent);
        try vault.proposeRound("r", ps, bytes32(0)) {
            assertGe(wait, cooldown, "paid inside cooldown");
        } catch {
            assertLt(wait, cooldown, "blocked after cooldown");
        }
    }
}
