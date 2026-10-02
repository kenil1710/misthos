// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {MisthosVault} from "../src/MisthosVault.sol";
import {MisthosVaultFactory} from "../src/MisthosVaultFactory.sol";
import {BaseTest} from "./utils/Base.t.sol";

contract FactoryTest is BaseTest {
    function test_createVault_initializesState() public view {
        assertEq(vault.programId(), PROGRAM);
        assertEq(vault.owner(), owner);
        assertEq(vault.agent(), agent);
        assertEq(vault.guardian(), guardian);
        assertEq(address(vault.token()), address(usdc));
        assertEq(vault.limits().maxPerPayout, 100 * USDC);
        assertFalse(vault.paused());
    }

    function test_createVault_isMinimalProxy() public view {
        // EIP-1167 runtime code is 45 bytes.
        assertEq(address(vault).code.length, 45);
    }

    function test_createVault_emitsEvent() public {
        bytes32 pid = keccak256("program-2");
        address predicted = factory.predictVaultAddress(owner, pid);
        vm.expectEmit(true, true, true, true, address(factory));
        emit MisthosVaultFactory.VaultCreated(pid, predicted, owner, agent);
        vm.prank(owner);
        assertEq(factory.createVault(pid, owner, agent, address(0), defaultLimits()), predicted);
    }

    function test_createVault_sameCallerSameProgram_reverts() public {
        vm.prank(owner);
        vm.expectRevert();
        factory.createVault(PROGRAM, owner, agent, guardian, defaultLimits());
    }

    function test_createVault_otherCallerCannotSquat() public {
        // A different deployer gets a different address for the same programId.
        vm.prank(stranger);
        address v = factory.createVault(PROGRAM, stranger, agent, address(0), defaultLimits());
        assertTrue(v != address(vault));
    }

    function test_createVault_zeroOwner_reverts() public {
        vm.expectRevert(MisthosVault.ZeroAddress.selector);
        factory.createVault(keccak256("x"), address(0), agent, address(0), defaultLimits());
    }

    function test_createVault_zeroAgent_reverts() public {
        vm.expectRevert(MisthosVault.ZeroAddress.selector);
        factory.createVault(keccak256("x"), owner, address(0), address(0), defaultLimits());
    }

    function test_createVault_invalidLimits_reverts() public {
        MisthosVault.Limits memory l = defaultLimits();
        l.maxPerRound = l.maxPerPayout - 1;
        vm.expectRevert(MisthosVault.InvalidLimits.selector);
        factory.createVault(keccak256("x"), owner, agent, address(0), l);
    }

    function test_factory_zeroImplementation_reverts() public {
        vm.expectRevert(MisthosVaultFactory.ZeroAddress.selector);
        new MisthosVaultFactory(address(0));
    }

    function test_vault_zeroToken_reverts() public {
        vm.expectRevert(MisthosVault.ZeroAddress.selector);
        new MisthosVault(IERC20(address(0)));
    }

    function test_initialize_twice_reverts() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vault.initialize(PROGRAM, stranger, stranger, address(0), defaultLimits());
    }

    function test_implementation_cannotBeInitialized() public {
        MisthosVault impl = MisthosVault(factory.implementation());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(PROGRAM, stranger, stranger, address(0), defaultLimits());
    }
}

contract DepositTest is BaseTest {
    function test_deposit_tracksAndEmits() public {
        usdc.mint(stranger, 50 * USDC);
        vm.startPrank(stranger);
        usdc.approve(address(vault), 50 * USDC);
        vm.expectEmit(true, false, false, true, address(vault));
        emit MisthosVault.Deposited(stranger, 50 * USDC);
        vault.deposit(50 * USDC);
        vm.stopPrank();
        assertEq(vault.totalDeposited(), 10_050 * USDC);
        assertEq(vault.balance(), 10_050 * USDC);
    }

    function test_deposit_zero_reverts() public {
        vm.expectRevert(MisthosVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_nativeTransfer_reverts() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 1}("");
        assertFalse(ok);
    }
}

contract PayeeTest is BaseTest {
    function test_registerPayee_startsCooldown() public {
        uint64 expected = uint64(block.timestamp) + 24 hours;
        vm.expectEmit(true, true, false, true, address(vault));
        emit MisthosVault.PayeeRegistered(cid(0), wallet(0), expected);
        vm.prank(agent);
        vault.registerPayee(cid(0), wallet(0));
        MisthosVault.Payee memory p = vault.payeeOf(cid(0));
        assertEq(p.wallet, wallet(0));
        assertEq(p.payableAfter, expected);
    }

    function test_registerPayee_onlyAgent() public {
        vm.prank(owner);
        vm.expectRevert(MisthosVault.NotAgent.selector);
        vault.registerPayee(cid(0), wallet(0));
    }

    function test_registerPayee_zeroWallet_reverts() public {
        vm.prank(agent);
        vm.expectRevert(MisthosVault.ZeroAddress.selector);
        vault.registerPayee(cid(0), address(0));
    }

    function test_registerPayee_whenPaused_reverts() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(MisthosVault.IsPaused.selector);
        vault.registerPayee(cid(0), wallet(0));
    }

    function test_registerPayee_sameWallet_isNoop() public {
        _registerPayees(1);
        uint64 before = vault.payeeOf(cid(0)).payableAfter;
        vm.warp(block.timestamp + 1 days);
        vm.prank(agent);
        vault.registerPayee(cid(0), wallet(0));
        assertEq(vault.payeeOf(cid(0)).payableAfter, before);
    }

    function test_changePayee_emitsAndRestartsCooldown() public {
        _registerPayees(1);
        uint64 expected = uint64(block.timestamp) + 24 hours;
        vm.expectEmit(true, true, true, true, address(vault));
        emit MisthosVault.PayeeChanged(cid(0), wallet(0), wallet(99), expected);
        vm.prank(agent);
        vault.registerPayee(cid(0), wallet(99));
        assertEq(vault.payeeOf(cid(0)).payableAfter, expected);
    }

    function test_changedPayee_cannotBePaidInsideCooldown() public {
        _registerPayees(1);
        vm.prank(agent);
        vault.registerPayee(cid(0), wallet(99));

        MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](1);
        ps[0] = _payout("r1", 0, 10 * USDC);
        ps[0].to = wallet(99);
        uint64 payableAfter = vault.payeeOf(cid(0)).payableAfter;

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.PayeeInCooldown.selector, cid(0), payableAfter));
        vault.proposeRound("r1", ps, bytes32(0));

        vm.warp(payableAfter - 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.PayeeInCooldown.selector, cid(0), payableAfter));
        vault.proposeRound("r1", ps, bytes32(0));

        vm.warp(payableAfter);
        _propose("r1", ps);
        _execute("r1");
        assertEq(usdc.balanceOf(wallet(99)), 10 * USDC);
    }

    function test_payeeChangedAfterProposal_blocksExecution() public {
        _registerPayees(1);
        _propose("r1", _payouts("r1", 1, 10 * USDC));
        // Hijacker swaps the wallet after proposal: the proposed `to` no longer matches.
        vm.prank(agent);
        vault.registerPayee(cid(0), wallet(99));
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MisthosVault.PayeeMismatch.selector, cid(0), wallet(99), wallet(0))
        );
        vault.executeRound("r1");
    }
}

contract ProposeTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _registerPayees(5);
    }

    function test_propose_storesRound() public {
        MisthosVault.Payout[] memory ps = _payouts("r1", 3, 20 * USDC);
        bytes32 root = keccak256(abi.encode(ps));
        vm.expectEmit(true, false, false, true, address(vault));
        emit MisthosVault.RoundProposed("r1", 60 * USDC, 3, root);
        _propose("r1", ps);

        MisthosVault.Round memory r = vault.getRound("r1");
        assertEq(uint8(r.status), uint8(MisthosVault.RoundStatus.Proposed));
        assertEq(r.total, 60 * USDC);
        assertEq(r.decisionRoot, root);
        assertEq(r.proposedAt, block.timestamp);
        MisthosVault.Payout[] memory stored = vault.getRoundPayouts("r1");
        assertEq(stored.length, 3);
        assertEq(stored[2].decisionHash, ps[2].decisionHash);
    }

    function test_propose_onlyAgent() public {
        MisthosVault.Payout[] memory ps = _payouts("r1", 1, USDC);
        vm.prank(owner);
        vm.expectRevert(MisthosVault.NotAgent.selector);
        vault.proposeRound("r1", ps, bytes32(0));
    }

    function test_propose_whenPaused_reverts() public {
        vm.prank(guardian);
        vault.pause();
        MisthosVault.Payout[] memory ps = _payouts("r1", 1, USDC);
        vm.prank(agent);
        vm.expectRevert(MisthosVault.IsPaused.selector);
        vault.proposeRound("r1", ps, bytes32(0));
    }

    function test_propose_existingRound_reverts() public {
        _propose("r1", _payouts("r1", 1, USDC));
        MisthosVault.Payout[] memory ps = _payouts("r1", 1, USDC);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.RoundExists.selector, bytes32("r1")));
        vault.proposeRound("r1", ps, bytes32(0));
    }

    function test_propose_empty_reverts() public {
        MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](0);
        vm.prank(agent);
        vm.expectRevert(MisthosVault.EmptyRound.selector);
        vault.proposeRound("r1", ps, bytes32(0));
    }

    function test_propose_tooMany_reverts() public {
        MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](201);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.TooManyPayouts.selector, 201));
        vault.proposeRound("r1", ps, bytes32(0));
    }

    function test_propose_zeroAmount_reverts() public {
        MisthosVault.Payout[] memory ps = _payouts("r1", 1, 0);
        vm.prank(agent);
        vm.expectRevert(MisthosVault.ZeroAmount.selector);
        vault.proposeRound("r1", ps, bytes32(0));
    }

    function test_propose_payoutOverCap_reverts() public {
        MisthosVault.Payout[] memory ps = _payouts("r1", 1, 100 * USDC + 1);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                MisthosVault.PayoutTooLarge.selector, ps[0].payoutId, 100 * USDC + 1, 100 * USDC
            )
        );
        vault.proposeRound("r1", ps, bytes32(0));
    }

    function test_propose_roundOverCap_reverts() public {
        _registerPayees(6);
        MisthosVault.Payout[] memory ps = _payouts("r1", 6, 100 * USDC);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.RoundTooLarge.selector, 600 * USDC, 500 * USDC));
        vault.proposeRound("r1", ps, bytes32(0));
    }

    function test_propose_unregisteredPayee_reverts() public {
        MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](1);
        ps[0] = _payout("r1", 42, USDC);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.PayeeNotRegistered.selector, cid(42)));
        vault.proposeRound("r1", ps, bytes32(0));
    }

    function test_propose_wrongWallet_reverts() public {
        MisthosVault.Payout[] memory ps = _payouts("r1", 1, USDC);
        ps[0].to = stranger;
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MisthosVault.PayeeMismatch.selector, cid(0), wallet(0), stranger)
        );
        vault.proposeRound("r1", ps, bytes32(0));
    }

    function test_propose_newPayeeInCooldown_reverts() public {
        vm.prank(agent);
        vault.registerPayee(cid(7), wallet(7));
        MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](1);
        ps[0] = _payout("r1", 7, USDC);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                MisthosVault.PayeeInCooldown.selector, cid(7), uint64(block.timestamp + 24 hours)
            )
        );
        vault.proposeRound("r1", ps, bytes32(0));
    }

    function test_propose_duplicatePayoutId_reverts() public {
        MisthosVault.Payout[] memory ps = _payouts("r1", 2, USDC);
        ps[1] = ps[0];
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.DuplicatePayout.selector, ps[0].payoutId));
        vault.proposeRound("r1", ps, bytes32(0));
    }

    function test_propose_alreadyPaidPayoutId_reverts() public {
        MisthosVault.Payout[] memory ps = _payouts("r1", 1, USDC);
        _propose("r1", ps);
        _execute("r1");
        // A retry under a new roundId that reuses the payoutId is refused.
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.AlreadyPaid.selector, ps[0].payoutId));
        vault.proposeRound("r1-retry", ps, bytes32(0));
    }
}

contract ApproveCancelTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _registerPayees(5);
        _propose("big", _payouts("big", 5, 50 * USDC)); // 250 > 200 threshold
    }

    function test_approve_emitsAndSetsStatus() public {
        vm.expectEmit(true, true, false, false, address(vault));
        emit MisthosVault.RoundApproved("big", owner);
        vm.prank(owner);
        vault.approveRound("big");
        assertEq(uint8(vault.getRound("big").status), uint8(MisthosVault.RoundStatus.Approved));
    }

    function test_approve_onlyOwner() public {
        vm.prank(agent);
        vm.expectRevert(MisthosVault.NotOwner.selector);
        vault.approveRound("big");
    }

    function test_approve_notProposed_reverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.RoundNotProposed.selector, bytes32("nope")));
        vault.approveRound("nope");
    }

    function test_approve_twice_reverts() public {
        vm.startPrank(owner);
        vault.approveRound("big");
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.RoundNotProposed.selector, bytes32("big")));
        vault.approveRound("big");
        vm.stopPrank();
    }

    function test_approve_whenPaused_reverts() public {
        vm.startPrank(owner);
        vault.pause();
        vm.expectRevert(MisthosVault.IsPaused.selector);
        vault.approveRound("big");
        vm.stopPrank();
    }

    function test_cancel_byOwnerOrAgent() public {
        vm.expectEmit(true, true, false, false, address(vault));
        emit MisthosVault.RoundCancelled("big", agent);
        vm.prank(agent);
        vault.cancelRound("big");
        assertEq(uint8(vault.getRound("big").status), uint8(MisthosVault.RoundStatus.Cancelled));

        _propose("r2", _payouts("r2", 1, USDC));
        vm.prank(owner);
        vault.approveRound("r2");
        vm.prank(owner);
        vault.cancelRound("r2");
        assertEq(uint8(vault.getRound("r2").status), uint8(MisthosVault.RoundStatus.Cancelled));
    }

    function test_cancel_stranger_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(MisthosVault.NotOwnerOrAgent.selector);
        vault.cancelRound("big");
    }

    function test_cancel_unknownOrDone_reverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.RoundNotExecutable.selector, bytes32("nope")));
        vault.cancelRound("nope");

        vm.prank(owner);
        vault.cancelRound("big");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.RoundNotExecutable.selector, bytes32("big")));
        vault.cancelRound("big");
    }

    function test_cancelled_cannotExecuteOrBeReproposed() public {
        vm.prank(owner);
        vault.cancelRound("big");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.RoundNotExecutable.selector, bytes32("big")));
        vault.executeRound("big");

        MisthosVault.Payout[] memory ps = _payouts("big", 1, USDC);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.RoundExists.selector, bytes32("big")));
        vault.proposeRound("big", ps, bytes32(0));
    }
}

contract ExecuteTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _registerPayees(10);
    }

    function test_execute_underThreshold_paysEveryone() public {
        MisthosVault.Payout[] memory ps = _payouts("r1", 4, 50 * USDC); // 200 == threshold
        _propose("r1", ps);
        for (uint256 i; i < 4; ++i) {
            vm.expectEmit(true, true, true, true, address(vault));
            emit MisthosVault.PayoutExecuted("r1", ps[i].payoutId, ps[i].to, ps[i].amount, ps[i].decisionHash);
        }
        vm.expectEmit(true, false, false, true, address(vault));
        emit MisthosVault.RoundExecuted("r1", 200 * USDC);
        _execute("r1");

        for (uint256 i; i < 4; ++i) {
            assertEq(usdc.balanceOf(wallet(i)), 50 * USDC);
            assertTrue(vault.paid(ps[i].payoutId));
        }
        assertEq(vault.totalPaid(), 200 * USDC);
        assertEq(vault.spentInWindow(), 200 * USDC);
        assertEq(uint8(vault.getRound("r1").status), uint8(MisthosVault.RoundStatus.Executed));
    }

    function test_execute_overThreshold_requiresApproval() public {
        _propose("r1", _payouts("r1", 5, 50 * USDC)); // 250
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                MisthosVault.ApprovalRequired.selector, bytes32("r1"), 250 * USDC, 200 * USDC
            )
        );
        vault.executeRound("r1");

        vm.prank(owner);
        vault.approveRound("r1");
        _execute("r1");
        assertEq(vault.totalPaid(), 250 * USDC);
    }

    function test_execute_onlyAgent() public {
        _propose("r1", _payouts("r1", 1, USDC));
        vm.prank(owner);
        vm.expectRevert(MisthosVault.NotAgent.selector);
        vault.executeRound("r1");
    }

    function test_execute_whenPaused_reverts() public {
        _propose("r1", _payouts("r1", 1, USDC));
        vm.prank(guardian);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(MisthosVault.IsPaused.selector);
        vault.executeRound("r1");
    }

    function test_execute_unknownRound_reverts() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.RoundNotExecutable.selector, bytes32("nope")));
        vault.executeRound("nope");
    }

    function test_execute_twice_reverts() public {
        _propose("r1", _payouts("r1", 1, USDC));
        _execute("r1");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.RoundNotExecutable.selector, bytes32("r1")));
        vault.executeRound("r1");
    }

    function test_execute_payoutIdPaidByOtherRound_reverts() public {
        // Two rounds proposed with an overlapping payoutId: only the first to execute pays.
        MisthosVault.Payout[] memory ps = _payouts("r1", 1, USDC);
        _propose("a", ps);
        _propose("b", ps);
        _execute("a");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(MisthosVault.AlreadyPaid.selector, ps[0].payoutId));
        vault.executeRound("b");
        assertEq(usdc.balanceOf(wallet(0)), USDC);
    }

    function test_execute_limitsTightenedAfterProposal_reverts() public {
        MisthosVault.Payout[] memory ps = _payouts("r1", 1, 80 * USDC);
        _propose("r1", ps);
        MisthosVault.Limits memory l = defaultLimits();
        l.maxPerPayout = 50 * USDC;
        vm.prank(owner);
        vault.setLimits(l);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MisthosVault.PayoutTooLarge.selector, ps[0].payoutId, 80 * USDC, 50 * USDC)
        );
        vault.executeRound("r1");
    }

    function test_execute_dailyCap_rollingWindow() public {
        // Three approved 400-USDC rounds; cap is 1,000 per rolling 24h.
        bytes32[3] memory ids = [bytes32("d1"), bytes32("d2"), bytes32("d3")];
        for (uint256 k; k < 3; ++k) {
            MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](4);
            for (uint256 i; i < 4; ++i) {
                ps[i] = _payout(ids[k], i, 100 * USDC);
            }
            _propose(ids[k], ps);
            vm.prank(owner);
            vault.approveRound(ids[k]);
        }
        uint256 t0 = block.timestamp;
        _execute("d1");
        vm.warp(t0 + 1 hours);
        _execute("d2");
        assertEq(vault.spentInWindow(), 800 * USDC);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MisthosVault.DailyCapExceeded.selector, 1_200 * USDC, 1_000 * USDC)
        );
        vault.executeRound("d3");

        // Exactly 24h after d1, d1 has left the window but d2 hasn't.
        vm.warp(t0 + 24 hours);
        assertEq(vault.spentInWindow(), 400 * USDC);
        _execute("d3");
        assertEq(vault.spentInWindow(), 800 * USDC);
        assertEq(vault.totalPaid(), 1_200 * USDC);
    }

    function test_execute_insufficientBalance_revertsAtomically() public {
        vm.prank(owner);
        vault.withdraw(owner, 10_000 * USDC - 30 * USDC);
        _propose("r1", _payouts("r1", 2, 20 * USDC));
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, address(vault), 10 * USDC, 20 * USDC
            )
        );
        vault.executeRound("r1");
        // Nothing was marked paid and nobody got partial funds.
        assertFalse(vault.paid(payoutId("r1", cid(0))));
        assertEq(usdc.balanceOf(wallet(0)), 0);
        assertEq(vault.totalPaid(), 0);
    }
}

contract OwnerTest is BaseTest {
    function test_setLimits() public {
        MisthosVault.Limits memory l = defaultLimits();
        l.maxPerPayout = 5 * USDC;
        vm.expectEmit(false, false, false, true, address(vault));
        emit MisthosVault.LimitsUpdated(l);
        vm.prank(owner);
        vault.setLimits(l);
        assertEq(vault.limits().maxPerPayout, 5 * USDC);
    }

    function test_setLimits_onlyOwner() public {
        MisthosVault.Limits memory l = defaultLimits();
        l.maxPerPayout = type(uint128).max;
        l.maxPerRound = type(uint128).max;
        l.maxPerDay = type(uint128).max;
        vm.prank(agent);
        vm.expectRevert(MisthosVault.NotOwner.selector);
        vault.setLimits(l);
    }

    function test_setLimits_invalid_reverts() public {
        MisthosVault.Limits memory l = defaultLimits();
        vm.startPrank(owner);

        l.maxPerPayout = 0;
        vm.expectRevert(MisthosVault.InvalidLimits.selector);
        vault.setLimits(l);

        l = defaultLimits();
        l.maxPerDay = l.maxPerRound - 1;
        vm.expectRevert(MisthosVault.InvalidLimits.selector);
        vault.setLimits(l);

        l = defaultLimits();
        l.maxPerDay = uint256(type(uint192).max) + 1;
        vm.expectRevert(MisthosVault.InvalidLimits.selector);
        vault.setLimits(l);
        vm.stopPrank();
    }

    function test_setAgent() public {
        vm.expectEmit(true, true, false, false, address(vault));
        emit MisthosVault.AgentUpdated(agent, stranger);
        vm.prank(owner);
        vault.setAgent(stranger);
        assertEq(vault.agent(), stranger);

        // The old agent is locked out immediately.
        vm.prank(agent);
        vm.expectRevert(MisthosVault.NotAgent.selector);
        vault.registerPayee(cid(0), wallet(0));
    }

    function test_setAgent_guards() public {
        vm.prank(agent);
        vm.expectRevert(MisthosVault.NotOwner.selector);
        vault.setAgent(agent);
        vm.prank(owner);
        vm.expectRevert(MisthosVault.ZeroAddress.selector);
        vault.setAgent(address(0));
    }

    function test_setGuardian() public {
        vm.prank(stranger);
        vm.expectRevert(MisthosVault.NotOwner.selector);
        vault.setGuardian(stranger);

        vm.expectEmit(true, true, false, false, address(vault));
        emit MisthosVault.GuardianUpdated(guardian, address(0));
        vm.prank(owner);
        vault.setGuardian(address(0));
        assertEq(vault.guardian(), address(0));
    }

    function test_transferOwnership() public {
        vm.prank(agent);
        vm.expectRevert(MisthosVault.NotOwner.selector);
        vault.transferOwnership(agent);
        vm.prank(owner);
        vm.expectRevert(MisthosVault.ZeroAddress.selector);
        vault.transferOwnership(address(0));

        vm.expectEmit(true, true, false, false, address(vault));
        emit MisthosVault.OwnershipTransferred(owner, stranger);
        vm.prank(owner);
        vault.transferOwnership(stranger);
        assertEq(vault.owner(), stranger);
    }

    function test_pause_guardianCanPauseNotUnpause() public {
        vm.expectEmit(true, false, false, false, address(vault));
        emit MisthosVault.Paused(guardian);
        vm.prank(guardian);
        vault.pause();
        assertTrue(vault.paused());

        vm.prank(guardian);
        vm.expectRevert(MisthosVault.NotOwner.selector);
        vault.unpause();

        vm.expectEmit(true, false, false, false, address(vault));
        emit MisthosVault.Unpaused(owner);
        vm.prank(owner);
        vault.unpause();
        assertFalse(vault.paused());
    }

    function test_pause_strangerOrAgent_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(MisthosVault.NotOwnerOrGuardian.selector);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(MisthosVault.NotOwnerOrGuardian.selector);
        vault.pause();
    }

    function test_withdraw_worksWhilePaused() public {
        vm.startPrank(owner);
        vault.pause();
        vm.expectEmit(true, false, false, true, address(vault));
        emit MisthosVault.Withdrawn(owner, 1_000 * USDC);
        vault.withdraw(owner, 1_000 * USDC);
        vm.stopPrank();
        assertEq(usdc.balanceOf(owner), 1_000 * USDC);
        assertEq(vault.totalWithdrawn(), 1_000 * USDC);
    }

    function test_withdraw_guards() public {
        vm.prank(agent);
        vm.expectRevert(MisthosVault.NotOwner.selector);
        vault.withdraw(agent, 1);
        vm.startPrank(owner);
        vm.expectRevert(MisthosVault.ZeroAddress.selector);
        vault.withdraw(address(0), 1);
        vm.expectRevert(MisthosVault.ZeroAmount.selector);
        vault.withdraw(owner, 0);
        vm.stopPrank();
    }

    function test_spentInWindow_nearGenesis() public {
        // block.timestamp < 24h exercises the cutoff = 0 branch.
        vm.warp(1 hours);
        assertEq(vault.spentInWindow(), 0);
    }
}
