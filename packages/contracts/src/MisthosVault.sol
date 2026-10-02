// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MisthosVault
/// @notice Per-program USDC payroll vault. The Misthos agent proposes and executes payout rounds, but only
///         inside limits the program owner sets here. The agent cannot raise limits, change roles, withdraw,
///         or pay anyone twice for the same `payoutId`.
/// @dev Deployed as EIP-1167 clones by {MisthosVaultFactory}. All amounts use the 6-decimal ERC-20 view of
///      USDC. The vault has no `receive()`, so native-value transfers to it revert.
contract MisthosVault is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ──────────────────────────────────────────────────────────────

    /// @notice Owner-controlled limits. All amounts in 6-decimal USDC units; `payeeCooldown` in seconds.
    struct Limits {
        uint256 maxPerPayout;
        uint256 maxPerRound;
        uint256 maxPerDay;
        uint256 autoApproveThreshold;
        uint64 payeeCooldown;
    }

    /// @notice One transfer inside a round.
    /// @param payoutId keccak256(programId, roundId, contributorId); can be paid at most once, ever.
    /// @param decisionHash keccak256 of the canonical decision record that justified this payout.
    struct Payout {
        bytes32 payoutId;
        bytes32 contributorId;
        address to;
        uint256 amount;
        bytes32 decisionHash;
    }

    enum RoundStatus {
        None,
        Proposed,
        Approved,
        Executed,
        Cancelled
    }

    struct Round {
        RoundStatus status;
        uint64 proposedAt;
        uint256 total;
        bytes32 decisionRoot;
    }

    struct Payee {
        address wallet;
        /// @dev Timestamp after which `wallet` may be paid.
        uint64 payableAfter;
    }

    struct Outflow {
        uint64 timestamp;
        uint192 amount;
    }

    // ─── Constants / immutables ──────────────────────────────────────────────

    /// @notice Length of the rolling window used by `maxPerDay`.
    uint256 public constant DAY = 24 hours;

    /// @notice Upper bound on payouts per round, keeping `executeRound` well under the block gas limit.
    uint256 public constant MAX_PAYOUTS_PER_ROUND = 200;

    /// @notice The USDC token. Baked into the implementation bytecode, so every clone shares it.
    IERC20 public immutable token;

    // ─── Storage ─────────────────────────────────────────────────────────────

    bytes32 public programId;
    address public owner;
    address public agent;
    address public guardian;
    bool public paused;
    Limits internal _limits;

    mapping(bytes32 contributorId => Payee) internal _payees;
    mapping(bytes32 roundId => Round) internal _rounds;
    mapping(bytes32 roundId => Payout[]) internal _roundPayouts;
    /// @notice True once a payoutId has been transferred. Never reset.
    mapping(bytes32 payoutId => bool) public paid;

    Outflow[] internal _outflows;
    /// @dev Index of the oldest outflow that may still be inside the rolling window.
    uint256 internal _outflowHead;

    /// @notice Lifetime totals, for accounting and invariants.
    uint256 public totalDeposited;
    uint256 public totalPaid;
    uint256 public totalWithdrawn;

    // ─── Events ──────────────────────────────────────────────────────────────

    event VaultInitialized(
        bytes32 indexed programId, address indexed owner, address indexed agent, address guardian
    );
    event Deposited(address indexed from, uint256 amount);
    event PayeeRegistered(bytes32 indexed contributorId, address indexed wallet, uint64 payableAfter);
    event PayeeChanged(
        bytes32 indexed contributorId,
        address indexed oldWallet,
        address indexed newWallet,
        uint64 payableAfter
    );
    event RoundProposed(bytes32 indexed roundId, uint256 total, uint256 payoutCount, bytes32 decisionRoot);
    event RoundApproved(bytes32 indexed roundId, address indexed by);
    event RoundCancelled(bytes32 indexed roundId, address indexed by);
    event PayoutExecuted(
        bytes32 indexed roundId,
        bytes32 indexed payoutId,
        address indexed to,
        uint256 amount,
        bytes32 decisionHash
    );
    event RoundExecuted(bytes32 indexed roundId, uint256 total);
    event LimitsUpdated(Limits limits);
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event Withdrawn(address indexed to, uint256 amount);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotOwner();
    error NotAgent();
    error NotOwnerOrGuardian();
    error NotOwnerOrAgent();
    error ZeroAddress();
    error ZeroAmount();
    error IsPaused();
    error InvalidLimits();
    error EmptyRound();
    error TooManyPayouts(uint256 count);
    error RoundExists(bytes32 roundId);
    error RoundNotProposed(bytes32 roundId);
    error RoundNotExecutable(bytes32 roundId);
    error ApprovalRequired(bytes32 roundId, uint256 total, uint256 threshold);
    error PayoutTooLarge(bytes32 payoutId, uint256 amount, uint256 max);
    error RoundTooLarge(uint256 total, uint256 max);
    error DailyCapExceeded(uint256 wouldBe, uint256 max);
    error PayeeNotRegistered(bytes32 contributorId);
    error PayeeMismatch(bytes32 contributorId, address expected, address got);
    error PayeeInCooldown(bytes32 contributorId, uint64 payableAfter);
    error AlreadyPaid(bytes32 payoutId);
    error DuplicatePayout(bytes32 payoutId);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    /// @param token_ The USDC ERC-20 (0x3600…0000 on Arc).
    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        _disableInitializers();
    }

    /// @notice Called once by the factory on a fresh clone.
    /// @param guardian_ Optional; may be address(0).
    function initialize(
        bytes32 programId_,
        address owner_,
        address agent_,
        address guardian_,
        Limits calldata limits_
    ) external initializer {
        if (owner_ == address(0) || agent_ == address(0)) revert ZeroAddress();
        _validateLimits(limits_);
        programId = programId_;
        owner = owner_;
        agent = agent_;
        guardian = guardian_;
        _limits = limits_;
        emit VaultInitialized(programId_, owner_, agent_, guardian_);
        emit LimitsUpdated(limits_);
    }

    // ─── Funding ─────────────────────────────────────────────────────────────

    /// @notice Pull `amount` USDC from the caller (requires prior approval). Plain transfers also work, but
    ///         only this path is counted in `totalDeposited` and emits {Deposited}.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ─── Payees ──────────────────────────────────────────────────────────────

    /// @notice Register or change the wallet for a contributor. Every registration or change starts the
    ///         payee cooldown, so a hijacked account cannot redirect a pending payout.
    function registerPayee(bytes32 contributorId, address wallet) external onlyAgent whenNotPaused {
        if (wallet == address(0)) revert ZeroAddress();
        Payee storage p = _payees[contributorId];
        address old = p.wallet;
        if (old == wallet) return;
        uint64 payableAfter = uint64(block.timestamp) + _limits.payeeCooldown;
        p.wallet = wallet;
        p.payableAfter = payableAfter;
        if (old == address(0)) emit PayeeRegistered(contributorId, wallet, payableAfter);
        else emit PayeeChanged(contributorId, old, wallet, payableAfter);
    }

    // ─── Rounds ──────────────────────────────────────────────────────────────

    /// @notice Propose a payout round. Every payout is validated against current limits and payees.
    /// @param decisionRoot Commitment to the round's decision records (e.g. Merkle root or hash of hashes).
    function proposeRound(bytes32 roundId, Payout[] calldata payouts, bytes32 decisionRoot)
        external
        onlyAgent
        whenNotPaused
    {
        if (_rounds[roundId].status != RoundStatus.None) revert RoundExists(roundId);
        uint256 n = payouts.length;
        if (n == 0) revert EmptyRound();
        if (n > MAX_PAYOUTS_PER_ROUND) revert TooManyPayouts(n);

        Payout[] storage stored = _roundPayouts[roundId];
        for (uint256 i; i < n; ++i) {
            stored.push(payouts[i]);
        }
        uint256 total = _validatePayouts(stored);

        _rounds[roundId] = Round({
            status: RoundStatus.Proposed,
            proposedAt: uint64(block.timestamp),
            total: total,
            decisionRoot: decisionRoot
        });
        emit RoundProposed(roundId, total, n, decisionRoot);
    }

    /// @notice Owner approval, required before execution when the round total exceeds `autoApproveThreshold`.
    function approveRound(bytes32 roundId) external onlyOwner whenNotPaused {
        Round storage r = _rounds[roundId];
        if (r.status != RoundStatus.Proposed) revert RoundNotProposed(roundId);
        r.status = RoundStatus.Approved;
        emit RoundApproved(roundId, msg.sender);
    }

    /// @notice Cancel a round that has not executed. The roundId cannot be reused.
    function cancelRound(bytes32 roundId) external {
        if (msg.sender != owner && msg.sender != agent) revert NotOwnerOrAgent();
        Round storage r = _rounds[roundId];
        if (r.status != RoundStatus.Proposed && r.status != RoundStatus.Approved) {
            revert RoundNotExecutable(roundId);
        }
        r.status = RoundStatus.Cancelled;
        emit RoundCancelled(roundId, msg.sender);
    }

    /// @notice Pay out a proposed (and, if required, approved) round. Re-validates every payout against the
    ///         limits and payees as they are now, then enforces the rolling daily cap.
    function executeRound(bytes32 roundId) external onlyAgent whenNotPaused nonReentrant {
        Round storage r = _rounds[roundId];
        RoundStatus status = r.status;
        if (status != RoundStatus.Proposed && status != RoundStatus.Approved) {
            revert RoundNotExecutable(roundId);
        }

        Payout[] storage payouts = _roundPayouts[roundId];
        uint256 total = _validatePayouts(payouts);
        if (status == RoundStatus.Proposed && total > _limits.autoApproveThreshold) {
            revert ApprovalRequired(roundId, total, _limits.autoApproveThreshold);
        }
        _consumeDailyCap(total);

        // Effects
        r.status = RoundStatus.Executed;
        totalPaid += total;
        uint256 n = payouts.length;
        for (uint256 i; i < n; ++i) {
            paid[payouts[i].payoutId] = true;
        }

        // Interactions
        for (uint256 i; i < n; ++i) {
            Payout storage p = payouts[i];
            token.safeTransfer(p.to, p.amount);
            emit PayoutExecuted(roundId, p.payoutId, p.to, p.amount, p.decisionHash);
        }
        emit RoundExecuted(roundId, total);
    }

    // ─── Owner ───────────────────────────────────────────────────────────────

    function setLimits(Limits calldata limits_) external onlyOwner {
        _validateLimits(limits_);
        _limits = limits_;
        emit LimitsUpdated(limits_);
    }

    function setAgent(address agent_) external onlyOwner {
        if (agent_ == address(0)) revert ZeroAddress();
        emit AgentUpdated(agent, agent_);
        agent = agent_;
    }

    /// @param guardian_ May be address(0) to remove the guardian.
    function setGuardian(address guardian_) external onlyOwner {
        emit GuardianUpdated(guardian, guardian_);
        guardian = guardian_;
    }

    function transferOwnership(address owner_) external onlyOwner {
        if (owner_ == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, owner_);
        owner = owner_;
    }

    /// @notice Owner or guardian can halt payee registration, proposals, approvals and execution.
    function pause() external {
        if (msg.sender != owner && msg.sender != guardian) revert NotOwnerOrGuardian();
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Only the owner can resume.
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice The owner can always pull funds out, even while paused. Misthos never has custody.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        totalWithdrawn += amount;
        emit Withdrawn(to, amount);
        token.safeTransfer(to, amount);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function limits() external view returns (Limits memory) {
        return _limits;
    }

    function payeeOf(bytes32 contributorId) external view returns (Payee memory) {
        return _payees[contributorId];
    }

    function getRound(bytes32 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    function getRoundPayouts(bytes32 roundId) external view returns (Payout[] memory) {
        return _roundPayouts[roundId];
    }

    /// @notice USDC paid out inside the current rolling 24h window.
    function spentInWindow() public view returns (uint256 sum) {
        uint256 cutoff = block.timestamp >= DAY ? block.timestamp - DAY : 0;
        uint256 len = _outflows.length;
        for (uint256 i = _outflowHead; i < len; ++i) {
            Outflow storage o = _outflows[i];
            if (o.timestamp > cutoff) sum += o.amount;
        }
    }

    function balance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _validateLimits(Limits calldata l) internal pure {
        if (l.maxPerPayout == 0 || l.maxPerRound < l.maxPerPayout || l.maxPerDay < l.maxPerRound) {
            revert InvalidLimits();
        }
        if (l.maxPerDay > type(uint192).max) revert InvalidLimits();
    }

    /// @dev Checks caps, payees, cooldowns and idempotency; returns the round total.
    function _validatePayouts(Payout[] storage payouts) internal view returns (uint256 total) {
        Limits memory l = _limits;
        uint256 n = payouts.length;
        for (uint256 i; i < n; ++i) {
            Payout storage p = payouts[i];
            bytes32 id = p.payoutId;
            if (p.amount == 0) revert ZeroAmount();
            if (p.amount > l.maxPerPayout) revert PayoutTooLarge(id, p.amount, l.maxPerPayout);
            if (paid[id]) revert AlreadyPaid(id);
            for (uint256 j; j < i; ++j) {
                if (payouts[j].payoutId == id) revert DuplicatePayout(id);
            }

            Payee storage payee = _payees[p.contributorId];
            if (payee.wallet == address(0)) revert PayeeNotRegistered(p.contributorId);
            if (payee.wallet != p.to) revert PayeeMismatch(p.contributorId, payee.wallet, p.to);
            if (block.timestamp < payee.payableAfter) {
                revert PayeeInCooldown(p.contributorId, payee.payableAfter);
            }

            total += p.amount;
        }
        if (total > l.maxPerRound) revert RoundTooLarge(total, l.maxPerRound);
    }

    /// @dev Prunes outflows older than 24h, then records `amount` if it fits under `maxPerDay`.
    function _consumeDailyCap(uint256 amount) internal {
        uint256 cutoff = block.timestamp >= DAY ? block.timestamp - DAY : 0;
        uint256 head = _outflowHead;
        uint256 len = _outflows.length;
        uint256 sum;
        while (head < len && _outflows[head].timestamp <= cutoff) {
            delete _outflows[head];
            ++head;
        }
        _outflowHead = head;
        for (uint256 i = head; i < len; ++i) {
            sum += _outflows[i].amount;
        }
        uint256 wouldBe = sum + amount;
        if (wouldBe > _limits.maxPerDay) revert DailyCapExceeded(wouldBe, _limits.maxPerDay);
        // casting to 'uint192' is safe because amount <= maxPerDay <= type(uint192).max (see _validateLimits).
        // forge-lint: disable-next-line(unsafe-typecast)
        _outflows.push(Outflow({timestamp: uint64(block.timestamp), amount: uint192(amount)}));
    }
}
