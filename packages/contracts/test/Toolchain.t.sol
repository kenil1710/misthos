// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Phase 0 smoke test: forge-std and OpenZeppelin resolve. Replaced by vault tests in Phase 1.
contract ToolchainTest is Test {
    function test_toolchainResolves() public pure {
        assertEq(type(IERC20Metadata).interfaceId != bytes4(0), true);
    }
}
