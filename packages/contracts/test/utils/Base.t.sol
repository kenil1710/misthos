// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MisthosVault} from "../../src/MisthosVault.sol";
import {MisthosVaultFactory} from "../../src/MisthosVaultFactory.sol";

/// @notice 6-decimal stand-in for the ERC-20 view of Arc USDC.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

abstract contract BaseTest is Test {
    uint256 internal constant USDC = 1e6;
    bytes32 internal constant PROGRAM = keccak256("program-1");

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal guardian = makeAddr("guardian");
    address internal stranger = makeAddr("stranger");

    MockUSDC internal usdc;
    MisthosVaultFactory internal factory;
    MisthosVault internal vault;

    function setUp() public virtual {
        // Start well past 0 so the 24h window arithmetic is exercised normally.
        vm.warp(1_760_000_000);
        usdc = new MockUSDC();
        factory = new MisthosVaultFactory(address(new MisthosVault(usdc)));
        vm.prank(owner);
        vault = MisthosVault(factory.createVault(PROGRAM, owner, agent, guardian, defaultLimits()));
        _fund(10_000 * USDC);
    }

    function defaultLimits() internal pure returns (MisthosVault.Limits memory) {
        return MisthosVault.Limits({
            maxPerPayout: 100 * USDC,
            maxPerRound: 500 * USDC,
            maxPerDay: 1_000 * USDC,
            autoApproveThreshold: 200 * USDC,
            payeeCooldown: 24 hours
        });
    }

    function _fund(uint256 amount) internal {
        usdc.mint(owner, amount);
        vm.startPrank(owner);
        usdc.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }

    function cid(uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encode("contributor", i));
    }

    function wallet(uint256 i) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode("wallet", i)))));
    }

    function payoutId(bytes32 roundId, bytes32 contributorId) internal pure returns (bytes32) {
        return keccak256(abi.encode(PROGRAM, roundId, contributorId));
    }

    /// @dev Registers contributors [0, n) and waits out the cooldown.
    function _registerPayees(uint256 n) internal {
        vm.startPrank(agent);
        for (uint256 i; i < n; ++i) {
            vault.registerPayee(cid(i), wallet(i));
        }
        vm.stopPrank();
        vm.warp(block.timestamp + defaultLimits().payeeCooldown);
    }

    function _payout(bytes32 roundId, uint256 i, uint256 amount)
        internal
        pure
        returns (MisthosVault.Payout memory)
    {
        return MisthosVault.Payout({
            payoutId: payoutId(roundId, cid(i)),
            contributorId: cid(i),
            to: wallet(i),
            amount: amount,
            decisionHash: keccak256(abi.encode("decision", roundId, i))
        });
    }

    /// @dev n payouts of `amount` each to contributors [0, n).
    function _payouts(bytes32 roundId, uint256 n, uint256 amount)
        internal
        pure
        returns (MisthosVault.Payout[] memory ps)
    {
        ps = new MisthosVault.Payout[](n);
        for (uint256 i; i < n; ++i) {
            ps[i] = _payout(roundId, i, amount);
        }
    }

    function _propose(bytes32 roundId, MisthosVault.Payout[] memory ps) internal {
        vm.prank(agent);
        vault.proposeRound(roundId, ps, keccak256(abi.encode(ps)));
    }

    function _execute(bytes32 roundId) internal {
        vm.prank(agent);
        vault.executeRound(roundId);
    }
}
