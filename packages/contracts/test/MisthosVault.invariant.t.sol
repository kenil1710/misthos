// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MisthosVault} from "../src/MisthosVault.sol";
import {MisthosVaultFactory} from "../src/MisthosVaultFactory.sol";
import {MockUSDC} from "./utils/Base.t.sol";

/// @notice Drives the vault with random owner, agent and stranger actions, tracking ghost state.
contract VaultHandler is Test {
    uint256 internal constant USDC = 1e6;
    uint256 internal constant N_PAYEES = 8;

    MisthosVault public vault;
    MockUSDC public usdc;
    address public owner;
    address public agent;
    address public stranger = makeAddr("stranger");

    uint256 public ghostInflow;
    uint256 public ghostOutflowToPayees;
    uint256 public ghostWithdrawn;
    bool public ghostDoublePaid;
    bool public ghostStrangerMovedFunds;
    bool public ghostDailyCapBroken;
    bool public ghostPayoutCapBroken;
    /// @dev Success counters; used to confirm the invariants are not vacuous.
    uint256 public ghostProposals;
    uint256 public ghostExecutions;

    mapping(bytes32 => uint256) public payCount;
    bytes32[] internal _rounds;
    uint256 internal _roundNonce;
    uint256[] internal _execTimes;
    uint256[] internal _execAmounts;

    constructor(MisthosVault vault_, MockUSDC usdc_, address owner_, address agent_) {
        vault = vault_;
        usdc = usdc_;
        owner = owner_;
        agent = agent_;
    }

    function _cid(uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encode("c", i % N_PAYEES));
    }

    function _wallet(uint256 i, uint256 version) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode("w", i % N_PAYEES, version)))));
    }

    // ─── Actions ─────────────────────────────────────────────────────────────

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 5_000 * USDC);
        usdc.mint(owner, amount);
        vm.startPrank(owner);
        usdc.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
        ghostInflow += amount;
    }

    function registerPayee(uint256 i, uint256 version) external {
        version = bound(version, 0, 2);
        vm.prank(agent);
        try vault.registerPayee(_cid(i), _wallet(i, version)) {} catch {}
    }

    function propose(uint256 seed, uint8 count, bool reuseOldId) external {
        uint256 n = bound(count, 1, 6);
        bytes32 roundId = keccak256(abi.encode("round", ++_roundNonce));
        MisthosVault.Payout[] memory ps = new MisthosVault.Payout[](n);
        for (uint256 k; k < n; ++k) {
            uint256 i = uint256(keccak256(abi.encode(seed, k))) % N_PAYEES;
            MisthosVault.Payee memory payee = vault.payeeOf(_cid(i));
            // Occasionally reuse a payoutId keyed to an older round, to probe idempotency.
            bytes32 idRound = reuseOldId && _rounds.length > 0 ? _rounds[seed % _rounds.length] : roundId;
            ps[k] = MisthosVault.Payout({
                payoutId: keccak256(abi.encode(idRound, _cid(i))),
                contributorId: _cid(i),
                to: payee.wallet,
                amount: bound(uint256(keccak256(abi.encode(seed, "a", k))), 1, 150 * USDC),
                decisionHash: keccak256(abi.encode(seed, k))
            });
        }
        vm.prank(agent);
        try vault.proposeRound(roundId, ps, bytes32(0)) {
            _rounds.push(roundId);
            ++ghostProposals;
        } catch {}
    }

    function approve(uint256 idx) external {
        if (_rounds.length == 0) return;
        vm.prank(owner);
        try vault.approveRound(_rounds[idx % _rounds.length]) {} catch {}
    }

    function execute(uint256 idx) external {
        if (_rounds.length == 0) return;
        bytes32 roundId = _rounds[idx % _rounds.length];
        uint256 maxPerPayout = vault.limits().maxPerPayout;
        uint256 before = usdc.balanceOf(address(vault));
        vm.prank(agent);
        try vault.executeRound(roundId) {
            uint256 total = before - usdc.balanceOf(address(vault));
            ghostOutflowToPayees += total;
            ++ghostExecutions;
            MisthosVault.Payout[] memory ps = vault.getRoundPayouts(roundId);
            for (uint256 k; k < ps.length; ++k) {
                if (++payCount[ps[k].payoutId] > 1) ghostDoublePaid = true;
                if (ps[k].amount > maxPerPayout) ghostPayoutCapBroken = true;
            }
            _execTimes.push(block.timestamp);
            _execAmounts.push(total);
            uint256 windowSum;
            for (uint256 j; j < _execTimes.length; ++j) {
                if (_execTimes[j] + 24 hours > block.timestamp) windowSum += _execAmounts[j];
            }
            if (windowSum > vault.limits().maxPerDay) ghostDailyCapBroken = true;
        } catch {}
    }

    function withdraw(uint256 amount) external {
        uint256 bal = usdc.balanceOf(address(vault));
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(owner);
        vault.withdraw(owner, amount);
        ghostWithdrawn += amount;
    }

    function setLimits(uint256 perPayout, uint256 threshold) external {
        perPayout = bound(perPayout, 1, 150 * USDC);
        MisthosVault.Limits memory l = MisthosVault.Limits({
            maxPerPayout: perPayout,
            maxPerRound: perPayout * 4,
            maxPerDay: perPayout * 8,
            autoApproveThreshold: bound(threshold, 0, perPayout * 4),
            payeeCooldown: 1 hours
        });
        vm.prank(owner);
        vault.setLimits(l);
    }

    function pauseToggle(bool p) external {
        vm.prank(owner);
        if (p) vault.pause();
        else vault.unpause();
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 12 hours));
    }

    /// @dev A stranger tries every fund-moving or privileged path. None may succeed.
    function strangerAttack(uint256 idx, uint256 amount) external {
        uint256 before = usdc.balanceOf(address(vault));
        vm.startPrank(stranger);
        try vault.withdraw(stranger, bound(amount, 1, 1e12)) {
            ghostStrangerMovedFunds = true;
        } catch {}
        if (_rounds.length > 0) {
            bytes32 r = _rounds[idx % _rounds.length];
            try vault.executeRound(r) {
                ghostStrangerMovedFunds = true;
            } catch {}
            try vault.approveRound(r) {
                ghostStrangerMovedFunds = true;
            } catch {}
        }
        try vault.registerPayee(_cid(idx), stranger) {
            ghostStrangerMovedFunds = true;
        } catch {}
        try vault.setAgent(stranger) {
            ghostStrangerMovedFunds = true;
        } catch {}
        vm.stopPrank();
        if (usdc.balanceOf(address(vault)) != before) ghostStrangerMovedFunds = true;
    }
}

contract VaultInvariantTest is Test {
    VaultHandler internal handler;
    MisthosVault internal vault;
    MockUSDC internal usdc;

    function setUp() public {
        vm.warp(1_760_000_000);
        usdc = new MockUSDC();
        MisthosVaultFactory factory = new MisthosVaultFactory(address(new MisthosVault(usdc)));
        address owner = makeAddr("owner");
        address agent = makeAddr("agent");
        MisthosVault.Limits memory l = MisthosVault.Limits({
            maxPerPayout: 100e6,
            maxPerRound: 400e6,
            maxPerDay: 800e6,
            autoApproveThreshold: 200e6,
            payeeCooldown: 1 hours
        });
        vm.prank(owner);
        vault = MisthosVault(factory.createVault(keccak256("p"), owner, agent, address(0), l));
        handler = new VaultHandler(vault, usdc, owner, agent);
        targetContract(address(handler));
    }

    /// @notice total paid + withdrawn never exceeds total deposited.
    function invariant_paidNeverExceedsDeposited() public view {
        assertLe(vault.totalPaid() + vault.totalWithdrawn(), vault.totalDeposited());
        assertEq(vault.totalDeposited(), handler.ghostInflow());
    }

    /// @notice The vault balance is exactly deposits minus everything that left.
    function invariant_balanceAccounting() public view {
        assertEq(
            usdc.balanceOf(address(vault)),
            vault.totalDeposited() - vault.totalPaid() - vault.totalWithdrawn()
        );
        assertEq(vault.totalPaid(), handler.ghostOutflowToPayees());
        assertEq(vault.totalWithdrawn(), handler.ghostWithdrawn());
    }

    /// @notice A payoutId is transferred at most once.
    function invariant_payoutIdPaidAtMostOnce() public view {
        assertFalse(handler.ghostDoublePaid());
    }

    /// @notice Only the owner (withdraw) and agent (executeRound) move funds; strangers cannot.
    function invariant_onlyOwnerOrAgentMoveFunds() public view {
        assertFalse(handler.ghostStrangerMovedFunds());
    }

    /// @notice Per-payout and rolling daily caps hold under every executed round.
    function invariant_capsHold() public view {
        assertFalse(handler.ghostPayoutCapBroken());
        assertFalse(handler.ghostDailyCapBroken());
    }
}
