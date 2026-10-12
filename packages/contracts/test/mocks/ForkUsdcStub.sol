// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ForkUsdcStub
/// @notice TEST ONLY. Stands in for Arc's native-backed USDC at 0x3600…0000 on a local Anvil fork of Arc Mainnet:
/// Arc's USDC moves balances through a native precompile (0x1800…0000::transfer) that stock revm/anvil can't run, so
/// on the fork its runtime code is replaced with this one (anvil_setCode). Everything else on the fork (the vault
/// template, the factory) is mainnet's real deployed code. Never deployed to any network.
/// @dev 6-decimal ERC-20. Balances and allowances live in hashed slots, so the storage already at 0x3600… on the fork
/// can't collide with them. `mint` is open: it only exists on a throwaway local fork.
contract ForkUsdcStub {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance();
    error InsufficientAllowance();

    bytes32 private constant BALANCES = keccak256("misthos.fork-usdc-stub.balances");
    bytes32 private constant ALLOWANCES = keccak256("misthos.fork-usdc-stub.allowances");
    bytes32 private constant SUPPLY = keccak256("misthos.fork-usdc-stub.supply");

    function name() external pure returns (string memory) {
        return "USDC (fork stub)";
    }

    function symbol() external pure returns (string memory) {
        return "USDC";
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function totalSupply() external view returns (uint256) {
        return _load(SUPPLY);
    }

    function balanceOf(address a) external view returns (uint256) {
        return _load(_balanceSlot(a));
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _load(_allowanceSlot(owner, spender));
    }

    function approve(address spender, uint256 value) external returns (bool) {
        _store(_allowanceSlot(msg.sender, spender), value);
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        bytes32 s = _allowanceSlot(from, msg.sender);
        uint256 allowed = _load(s);
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance();
            _store(s, allowed - value);
        }
        _move(from, to, value);
        return true;
    }

    /// @notice Local fork only: fund a test account.
    function mint(address to, uint256 value) external {
        _store(_balanceSlot(to), _load(_balanceSlot(to)) + value);
        _store(SUPPLY, _load(SUPPLY) + value);
        emit Transfer(address(0), to, value);
    }

    function _move(address from, address to, uint256 value) private {
        bytes32 f = _balanceSlot(from);
        uint256 bal = _load(f);
        if (bal < value) revert InsufficientBalance();
        _store(f, bal - value);
        bytes32 t = _balanceSlot(to);
        _store(t, _load(t) + value);
        emit Transfer(from, to, value);
    }

    function _balanceSlot(address a) private pure returns (bytes32) {
        return keccak256(abi.encode(a, BALANCES));
    }

    function _allowanceSlot(address owner, address spender) private pure returns (bytes32) {
        return keccak256(abi.encode(owner, spender, ALLOWANCES));
    }

    function _load(bytes32 s) private view returns (uint256 v) {
        assembly {
            v := sload(s)
        }
    }

    function _store(bytes32 s, uint256 v) private {
        assembly {
            sstore(s, v)
        }
    }
}
