// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title JobEscrow
 * @notice The on-chain heart of QueraIS. For each inference job it locks the
 *         requester's $QAIS, records the matched provider and agreed price, and on
 *         verification atomically splits payment: 95% to the provider, 5% to the
 *         protocol treasury, and refunds the unused remainder to the requester.
 *
 * @dev MVP scope:
 *      - Per-job lock/settle (no session deposits / batching — gas is free locally).
 *      - The gateway holds ORACLE_ROLE (verification) and MATCHING_ENGINE_ROLE
 *        (job creation/assignment). Token counts written by the oracle are the
 *        gateway's independently-counted authoritative value (see settlement design).
 *      - Disputes are deferred; the fail path issues a full refund.
 *
 *      JobEscrow is the authoritative job registry: `jobs[jobId]` is the single source
 *      of truth for every job's data and status (no separate JobRegistry contract).
 *
 *      Invariants enforced by construction and asserted in tests:
 *        providerPay + protocolFee == actualPayment
 *        actualPayment + refund     == lockedAmount
 */
contract JobEscrow is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant MATCHING_ENGINE_ROLE = keccak256("MATCHING_ENGINE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Protocol fee in basis points (500 == 5%). Bounded by MAX_FEE_RATE.
    uint16 public protocolFeeRate = 500;
    uint16 public constant MAX_FEE_RATE = 1000; // 10% hard cap
    uint16 public constant BPS_DENOMINATOR = 10000;

    enum JobStatus {
        NONE, // 0 — never created
        PENDING, // 1 — funds locked, awaiting assignment
        ASSIGNED, // 2 — provider matched, executing
        COMPLETED, // 3 — provider reported result, awaiting verification
        VERIFIED, // 4 — verified & paid out
        FAILED, // 5 — verification failed or timed out; requester refunded
        CANCELLED // 6 — cancelled before assignment; requester refunded
    }

    struct Job {
        address requester;
        address provider;
        uint256 lockedAmount;
        uint256 maxPricePerToken;
        uint256 agreedPricePerToken;
        uint256 maxTokens;
        uint256 actualTokens;
        uint64 lockedAt;
        uint64 deadline;
        bytes32 resultHash;
        JobStatus status;
    }

    IERC20 public immutable token;
    address public treasury;
    mapping(bytes32 => Job) public jobs;

    // ─── Events ─────────────────────────────────────────────────────────────────
    event JobCreated(
        bytes32 indexed jobId, address indexed requester, uint256 lockedAmount, uint64 deadline
    );
    event JobAssigned(bytes32 indexed jobId, address indexed provider, uint256 pricePerToken);
    event JobCompleted(bytes32 indexed jobId, uint256 actualTokens, bytes32 resultHash);
    event JobVerified(
        bytes32 indexed jobId, uint256 providerPay, uint256 protocolFee, uint256 refund
    );
    event JobFailed(bytes32 indexed jobId, string reason, uint256 refund);
    event JobCancelled(bytes32 indexed jobId, uint256 refund);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ProtocolFeeRateUpdated(uint16 oldRate, uint16 newRate);

    // ─── Errors ──────────────────────────────────────────────────────────────────
    error ZeroAddress();
    error JobAlreadyExists(bytes32 jobId);
    error UnexpectedStatus(bytes32 jobId, JobStatus have, JobStatus want);
    error ZeroAmount();
    error DeadlineInPast();
    error PriceAboveMax(uint256 agreed, uint256 max);
    error TokensAboveMax(uint256 actual, uint256 max);
    error DeadlineNotReached(uint64 deadline);
    error NotRequester();
    error FeeRateTooHigh(uint16 rate);

    constructor(IERC20 token_, address treasury_, address admin) {
        if (address(token_) == address(0) || treasury_ == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }
        token = token_;
        treasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ─── Job lifecycle ───────────────────────────────────────────────────────────

    /// @notice Create a job and lock `maxPricePerToken * maxTokens` from the requester.
    ///         The requester must have approved this contract for that amount.
    function createJob(
        bytes32 jobId,
        address requester,
        uint256 maxPricePerToken,
        uint256 maxTokens,
        uint64 deadline
    ) external onlyRole(MATCHING_ENGINE_ROLE) nonReentrant whenNotPaused {
        if (requester == address(0)) revert ZeroAddress();
        if (maxPricePerToken == 0 || maxTokens == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert DeadlineInPast();
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.NONE) revert JobAlreadyExists(jobId);

        uint256 locked = maxPricePerToken * maxTokens;

        // Effects
        j.requester = requester;
        j.lockedAmount = locked;
        j.maxPricePerToken = maxPricePerToken;
        j.maxTokens = maxTokens;
        j.lockedAt = uint64(block.timestamp);
        j.deadline = deadline;
        j.status = JobStatus.PENDING;

        // Interaction
        token.safeTransferFrom(requester, address(this), locked);

        emit JobCreated(jobId, requester, locked, deadline);
    }

    /// @notice Assign a matched provider and the agreed (winning) price.
    function assignJob(bytes32 jobId, address provider, uint256 agreedPricePerToken)
        external
        onlyRole(MATCHING_ENGINE_ROLE)
        whenNotPaused
    {
        if (provider == address(0)) revert ZeroAddress();
        if (agreedPricePerToken == 0) revert ZeroAmount();
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.PENDING) {
            revert UnexpectedStatus(jobId, j.status, JobStatus.PENDING);
        }
        if (agreedPricePerToken > j.maxPricePerToken) {
            revert PriceAboveMax(agreedPricePerToken, j.maxPricePerToken);
        }

        j.provider = provider;
        j.agreedPricePerToken = agreedPricePerToken;
        j.status = JobStatus.ASSIGNED;

        emit JobAssigned(jobId, provider, agreedPricePerToken);
    }

    /// @notice Record the provider's result. `actualTokens` is the gateway's
    ///         authoritative (independently counted) token total.
    function completeJob(bytes32 jobId, uint256 actualTokens, bytes32 resultHash)
        external
        onlyRole(ORACLE_ROLE)
        whenNotPaused
    {
        if (actualTokens == 0) revert ZeroAmount();
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.ASSIGNED) {
            revert UnexpectedStatus(jobId, j.status, JobStatus.ASSIGNED);
        }
        if (actualTokens > j.maxTokens) revert TokensAboveMax(actualTokens, j.maxTokens);

        j.actualTokens = actualTokens;
        j.resultHash = resultHash;
        j.status = JobStatus.COMPLETED;

        emit JobCompleted(jobId, actualTokens, resultHash);
    }

    /// @notice Verify a completed job and atomically settle: 95% provider, 5% treasury,
    ///         remainder refunded to the requester.
    function verifyAndRelease(bytes32 jobId)
        external
        onlyRole(ORACLE_ROLE)
        nonReentrant
        whenNotPaused
    {
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.COMPLETED) {
            revert UnexpectedStatus(jobId, j.status, JobStatus.COMPLETED);
        }

        uint256 actualPayment = j.actualTokens * j.agreedPricePerToken;
        uint256 fee = (actualPayment * protocolFeeRate) / BPS_DENOMINATOR;
        uint256 providerPay = actualPayment - fee;
        uint256 refund = j.lockedAmount - actualPayment; // actualPayment <= locked by construction

        address provider = j.provider;
        address requester = j.requester;

        // Effects
        j.status = JobStatus.VERIFIED;

        // Interactions (CEI): pay provider, fee, then refund.
        if (providerPay > 0) token.safeTransfer(provider, providerPay);
        if (fee > 0) token.safeTransfer(treasury, fee);
        if (refund > 0) token.safeTransfer(requester, refund);

        emit JobVerified(jobId, providerPay, fee, refund);
    }

    /// @notice Fail a job (e.g. Layer-B verification failure) and fully refund the
    ///         requester. Callable from ASSIGNED or COMPLETED.
    function failJob(bytes32 jobId, string calldata reason)
        external
        onlyRole(ORACLE_ROLE)
        nonReentrant
    {
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.ASSIGNED && j.status != JobStatus.COMPLETED) {
            revert UnexpectedStatus(jobId, j.status, JobStatus.ASSIGNED);
        }
        uint256 refund = j.lockedAmount;
        address requester = j.requester;

        j.status = JobStatus.FAILED;
        if (refund > 0) token.safeTransfer(requester, refund);

        emit JobFailed(jobId, reason, refund);
    }

    /// @notice Cancel a job that was never assigned, refunding the requester. Callable
    ///         by the requester or the matching engine.
    function cancelJob(bytes32 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.PENDING) {
            revert UnexpectedStatus(jobId, j.status, JobStatus.PENDING);
        }
        if (msg.sender != j.requester && !hasRole(MATCHING_ENGINE_ROLE, msg.sender)) {
            revert NotRequester();
        }
        uint256 refund = j.lockedAmount;
        address requester = j.requester;

        j.status = JobStatus.CANCELLED;
        if (refund > 0) token.safeTransfer(requester, refund);

        emit JobCancelled(jobId, refund);
    }

    /// @notice After the deadline, anyone can time out an unfinished ASSIGNED job and
    ///         refund the requester. Provider slashing is handled off-chain in the MVP.
    function timeoutJob(bytes32 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.ASSIGNED) {
            revert UnexpectedStatus(jobId, j.status, JobStatus.ASSIGNED);
        }
        if (block.timestamp <= j.deadline) revert DeadlineNotReached(j.deadline);

        uint256 refund = j.lockedAmount;
        address requester = j.requester;

        j.status = JobStatus.FAILED;
        if (refund > 0) token.safeTransfer(requester, refund);

        emit JobFailed(jobId, "timeout", refund);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────────

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    function setProtocolFeeRate(uint16 newRate) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRate > MAX_FEE_RATE) revert FeeRateTooHigh(newRate);
        uint16 old = protocolFeeRate;
        protocolFeeRate = newRate;
        emit ProtocolFeeRateUpdated(old, newRate);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ─── Views ───────────────────────────────────────────────────────────────────

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    function statusOf(bytes32 jobId) external view returns (JobStatus) {
        return jobs[jobId].status;
    }
}
