// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {MisthosVault} from "./MisthosVault.sol";

/// @title MisthosVaultFactory
/// @notice Deploys one {MisthosVault} per program as an EIP-1167 minimal proxy.
/// @dev Clones are deterministic per (caller, programId), so nobody can squat another owner's vault address.
contract MisthosVaultFactory {
    /// @notice The vault implementation all clones delegate to.
    address public immutable implementation;

    event VaultCreated(
        bytes32 indexed programId, address indexed vault, address indexed owner, address agent
    );

    error ZeroAddress();

    constructor(address implementation_) {
        if (implementation_ == address(0)) revert ZeroAddress();
        implementation = implementation_;
    }

    /// @notice Deploy and initialize a vault for `programId`.
    /// @param guardian Optional pause-only role; may be address(0).
    function createVault(
        bytes32 programId,
        address owner,
        address agent,
        address guardian,
        MisthosVault.Limits calldata limits
    ) external returns (address vault) {
        vault = Clones.cloneDeterministic(implementation, _salt(msg.sender, programId));
        MisthosVault(vault).initialize(programId, owner, agent, guardian, limits);
        emit VaultCreated(programId, vault, owner, agent);
    }

    /// @notice The address `createVault` will deploy to when called by `deployer` for `programId`.
    function predictVaultAddress(address deployer, bytes32 programId) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt(deployer, programId));
    }

    function _salt(address deployer, bytes32 programId) private pure returns (bytes32) {
        return keccak256(abi.encode(deployer, programId));
    }
}
