// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MisthosVault} from "../../src/MisthosVault.sol";
import {MisthosVaultFactory} from "../../src/MisthosVaultFactory.sol";
import {BaseTest} from "../utils/Base.t.sol";

/// @notice USDC stand-in with Circle-style blocklisting: transfers to a blocked address revert.
contract BlocklistUSDC is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function block_(address a) external {
        blocked[a] = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[to], "blocklisted");
        super._update(from, to, value);
    }
}

/// @notice Independent audit (docs/INDEPENDENT_AUDIT.md). Each test states what it tries to break.
///         `test_ONCHAIN_*` pin down behavior of the deployed (immutable) vault that the audit found; each is now
///         handled off-chain by the agent and documented with its status in INDEPENDENT_AUDIT.md (the agent-side
///         regressions are in packages/agent/test/audit*.test.ts). They keep passing so any vault change that alters
///         these behaviors is noticed. `test_HOLDS_*` pass when the invariant holds.
contract IndependentAuditTest is BaseTest {
    // ── C-1: the per-round approval threshold is per round, not per day ────────────────────────────────────
    /// A compromised/buggy agent splits spend into many rounds just under `autoApproveThreshold`; none needs the
    /// owner's approval. Only `maxPerDay` bounds it.
    function test_ONCHAIN_thresholdBypassedBySplittingRounds() public {
        _registerPayees(5);
        uint256 spent;
        for (uint256 r; r < 5; ++r) {
            bytes32 rid = keccak256(abi.encode("split", r));
            // 2 × 99.99 = 199.98 USDC < 200 USDC threshold
            _propose(rid, _payouts(rid, 2, 99_990_000));
            _execute(rid);
            spent += 2 * 99_990_000;
        }
        assertGt(spent, vault.limits().autoApproveThreshold * 4, "5 rounds auto-executed, ~5x threshold");
        assertEq(vault.spentInWindow(), spent);
    }

    // ── C-2: payoutId is not bound to (programId, roundId, contributorId) on-chain ─────────────────────────
    /// The vault takes payoutId on trust. The same contributor can appear twice in one round under two different
    /// payoutIds, each under maxPerPayout, so the per-payout cap is not a per-contributor cap.
    function test_ONCHAIN_samePayeeTwiceInOneRound() public {
        _registerPayees(1);
        bytes32 rid = keccak256("double");
        MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](2);
        ps[0] = _payout(rid, 0, 100 * USDC);
        ps[1] = _payout(rid, 0, 100 * USDC);
        ps[1].payoutId = keccak256("any other id");
        _propose(rid, ps);
        _execute(rid);
        assertEq(usdc.balanceOf(wallet(0)), 200 * USDC, "2x maxPerPayout to one contributor in one round");
    }

    // ── C-3: one payee change bricks the whole round ───────────────────────────────────────────────────────
    /// Any contributor can change their wallet (web app → syncPayee → registerPayee). If that lands after a round
    /// was proposed, executeRound reverts for *everyone* (PayeeMismatch), and the worker marks the round failed.
    function test_ONCHAIN_onePayeeChangeRevertsWholeRound() public {
        _registerPayees(10);
        bytes32 rid = keccak256("grief");
        _propose(rid, _payouts(rid, 10, 50 * USDC)); // 500 > 200 threshold: waits for owner approval
        // Contributor 7 links a new wallet while the round waits for approval.
        vm.prank(agent);
        vault.registerPayee(cid(7), makeAddr("new wallet of #7"));
        vm.prank(owner);
        vault.approveRound(rid);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                MisthosVault.PayeeMismatch.selector, cid(7), makeAddr("new wallet of #7"), wallet(7)
            )
        );
        vault.executeRound(rid);
        assertEq(usdc.balanceOf(wallet(0)), 0, "the 9 honest contributors are not paid");
    }

    // ── C-4: a blocklisted recipient bricks the whole round ────────────────────────────────────────────────
    function test_ONCHAIN_blocklistedRecipientRevertsWholeRound() public {
        BlocklistUSDC t = new BlocklistUSDC();
        MisthosVaultFactory f = new MisthosVaultFactory(address(new MisthosVault(t)));
        vm.prank(owner);
        MisthosVault v = MisthosVault(f.createVault(PROGRAM, owner, agent, guardian, defaultLimits()));
        t.mint(address(v), 1_000 * USDC);
        vm.startPrank(agent);
        for (uint256 i; i < 3; ++i) {
            v.registerPayee(cid(i), wallet(i));
        }
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        bytes32 rid = keccak256("blocked");
        vm.prank(agent);
        v.proposeRound(rid, _payouts(rid, 3, 50 * USDC), bytes32(0));
        t.block_(wallet(2));
        vm.prank(agent);
        vm.expectRevert(bytes("blocklisted"));
        v.executeRound(rid);
        assertEq(t.balanceOf(wallet(0)), 0);
    }

    // ── C-5: compromised agent blast radius ────────────────────────────────────────────────────────────────
    /// The agent alone can register an arbitrary wallet for a fresh contributorId; after the cooldown it can pay
    /// that wallet up to maxPerDay every 24h until the owner notices and pauses.
    function test_ONCHAIN_agentCanOnboardAndPayArbitraryWallet() public {
        address attacker = makeAddr("attacker");
        bytes32 fake = keccak256("not a real contributor");
        vm.prank(agent);
        vault.registerPayee(fake, attacker);
        vm.warp(block.timestamp + 24 hours);
        for (uint256 d; d < 3; ++d) {
            for (uint256 r; r < 5; ++r) {
                bytes32 rid = keccak256(abi.encode("drain", d, r));
                MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](2);
                for (uint256 k; k < 2; ++k) {
                    ps[k] = MisthosVault.Payout({
                        payoutId: keccak256(abi.encode(rid, k)),
                        contributorId: fake,
                        to: attacker,
                        amount: 100 * USDC,
                        decisionHash: bytes32(0)
                    });
                }
                vm.prank(agent);
                vault.proposeRound(rid, ps, bytes32(0)); // decisionRoot is never checked on-chain
                vm.prank(agent);
                vault.executeRound(rid);
            }
            vm.warp(block.timestamp + 24 hours);
        }
        assertEq(usdc.balanceOf(attacker), 3_000 * USDC, "3 days x maxPerDay, no owner action needed");
    }

    // ── C-6: cooldown is fixed at registration ─────────────────────────────────────────────────────────────
    /// Raising payeeCooldown after a suspicious registration does not extend it (payableAfter is stored).
    function test_ONCHAIN_raisingCooldownDoesNotProtectPendingRegistrations() public {
        vm.prank(agent);
        vault.registerPayee(cid(0), wallet(0));
        MisthosVault.Limits memory l = defaultLimits();
        l.payeeCooldown = 30 days;
        vm.prank(owner);
        vault.setLimits(l);
        vm.warp(block.timestamp + 24 hours);
        bytes32 rid = keccak256("cooldown");
        _propose(rid, _payouts(rid, 1, 10 * USDC));
        _execute(rid);
        assertEq(usdc.balanceOf(wallet(0)), 10 * USDC);
    }

    // ── C-7: rolling window boundary ───────────────────────────────────────────────────────────────────────
    /// Outflows exactly DAY seconds old are pruned, so 2 × maxPerDay can leave within a closed 86_400 s interval.
    function test_ONCHAIN_dailyWindowBoundaryAllowsTwoCapsIn86400s() public {
        MisthosVault.Limits memory l = defaultLimits();
        l.maxPerRound = 1_000 * USDC;
        l.maxPerPayout = 100 * USDC;
        l.autoApproveThreshold = 1_000 * USDC;
        vm.prank(owner);
        vault.setLimits(l);
        _registerPayees(10);
        bytes32 a = keccak256("a");
        _propose(a, _payouts(a, 10, 100 * USDC));
        _execute(a);
        vm.warp(block.timestamp + 1 days);
        bytes32 b = keccak256("b");
        _propose(b, _payouts(b, 10, 100 * USDC));
        _execute(b);
        assertEq(vault.totalPaid(), 2_000 * USDC);
    }

    // ── Invariants that hold ───────────────────────────────────────────────────────────────────────────────

    function test_HOLDS_strangerCannotTouchFunds() public {
        vm.startPrank(stranger);
        vm.expectRevert(MisthosVault.NotOwner.selector);
        vault.withdraw(stranger, 1);
        vm.expectRevert(MisthosVault.NotAgent.selector);
        vault.registerPayee(cid(0), stranger);
        vm.expectRevert(MisthosVault.NotOwner.selector);
        vault.setAgent(stranger);
        vm.expectRevert(MisthosVault.NotOwnerOrAgent.selector);
        vault.cancelRound(bytes32(0));
        vm.stopPrank();
    }

    function test_HOLDS_agentCannotApproveOrWithdrawOrRaiseLimits() public {
        vm.startPrank(agent);
        vm.expectRevert(MisthosVault.NotOwner.selector);
        vault.approveRound(bytes32(0));
        vm.expectRevert(MisthosVault.NotOwner.selector);
        vault.withdraw(agent, 1);
        vm.expectRevert(MisthosVault.NotOwner.selector);
        vault.setLimits(defaultLimits());
        vm.expectRevert(MisthosVault.NotOwnerOrGuardian.selector);
        vault.pause();
        vm.stopPrank();
    }

    function test_HOLDS_payoutIdNeverPaysTwiceAcrossRounds() public {
        _registerPayees(1);
        bytes32 r1 = keccak256("r1");
        _propose(r1, _payouts(r1, 1, 10 * USDC));
        _execute(r1);
        bytes32 r2 = keccak256("r2");
        MisthosVault.Payout[] memory ps = _payouts(r2, 1, 10 * USDC);
        ps[0].payoutId = payoutId(r1, cid(0));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.AlreadyPaid.selector, ps[0].payoutId));
        vault.proposeRound(r2, ps, bytes32(0));
    }

    function test_HOLDS_cancelledRoundCannotBeRevivedEvenAfterPause() public {
        _registerPayees(1);
        bytes32 rid = keccak256("c");
        _propose(rid, _payouts(rid, 1, 10 * USDC));
        vm.prank(guardian);
        vault.pause();
        vm.prank(owner);
        vault.cancelRound(rid); // allowed while paused
        vm.prank(owner);
        vault.unpause();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.RoundNotExecutable.selector, rid));
        vault.executeRound(rid);
    }

    function test_HOLDS_approvedRoundRevalidatedAgainstTightenedLimits() public {
        _registerPayees(3);
        bytes32 rid = keccak256("t");
        _propose(rid, _payouts(rid, 3, 100 * USDC));
        vm.prank(owner);
        vault.approveRound(rid);
        MisthosVault.Limits memory l = defaultLimits();
        l.maxPerPayout = 50 * USDC;
        vm.prank(owner);
        vault.setLimits(l);
        vm.prank(agent);
        vm.expectRevert();
        vault.executeRound(rid);
    }

    /// Fuzz: whatever the agent proposes across rounds inside one window, total outflow never exceeds maxPerDay.
    function testFuzz_HOLDS_dailyCapAcrossManyRounds(uint8 rounds, uint32 seed) public {
        rounds = uint8(bound(rounds, 1, 30));
        _registerPayees(5);
        uint256 start = block.timestamp;
        for (uint256 r; r < rounds; ++r) {
            vm.warp(start + (uint256(keccak256(abi.encode(seed, r))) % 23 hours));
            bytes32 rid = keccak256(abi.encode("f", seed, r));
            uint256 amt = 1 + (uint256(keccak256(abi.encode(seed, r, "a"))) % (100 * USDC));
            vm.prank(agent);
            try vault.proposeRound(rid, _payouts(rid, 2, amt), bytes32(0)) {
                vm.prank(agent);
                try vault.executeRound(rid) {} catch {}
            } catch {}
        }
        assertLe(vault.totalPaid(), defaultLimits().maxPerDay);
    }
}
