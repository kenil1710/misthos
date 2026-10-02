// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MisthosVault} from "../../src/MisthosVault.sol";
import {MisthosVaultFactory} from "../../src/MisthosVaultFactory.sol";

/// @notice Checks vault assumptions against real Arc testnet USDC (0x3600…), whose ERC-20 interface is a
///         6-decimal view over the 18-decimal native balance. Skipped unless ARC_FORK_RPC is set:
///         ARC_FORK_RPC=https://rpc.testnet.arc.io forge test --match-path test/fork/*
/// @dev USDC transfers call Arc's native precompile at 0x1800…0001 (`isBlocklisted`), which stock Foundry's
///      EVM does not implement, so transfer paths cannot run on a fork. The real-USDC lifecycle
///      (register → propose → execute → withdraw) is exercised on-chain by script/SmokeRound.s.sol instead.
contract ArcForkTest is Test {
    IERC20 internal constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    address internal owner = makeAddr("fork-owner");
    address internal agent = makeAddr("fork-agent");
    MisthosVault internal vault;

    function setUp() public {
        string memory rpc = vm.envOr("ARC_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 5042002);

        MisthosVaultFactory factory = new MisthosVaultFactory(address(new MisthosVault(USDC)));
        vm.prank(owner);
        vault = MisthosVault(
            factory.createVault(
                keccak256("fork"),
                owner,
                agent,
                address(0),
                MisthosVault.Limits({
                    maxPerPayout: 2e6,
                    maxPerRound: 5e6,
                    maxPerDay: 10e6,
                    autoApproveThreshold: 3e6,
                    payeeCooldown: 0
                })
            )
        );
    }

    function test_fork_usdcDecimalsAndNativeView() public {
        assertEq(IERC20Metadata(address(USDC)).decimals(), 6);
        // Native balance is 18-dec; the ERC-20 view is the same balance in 6-dec units.
        vm.deal(owner, 7 ether); // 7 USDC native
        assertEq(USDC.balanceOf(owner), 7e6);
    }

    function test_fork_nativeTransferToVaultReverts() public {
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
    }
}
