// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title CreditAccount
 * @notice Session-deposit settlement for QueraIS. A requester pre-funds a $QAIS balance
 *         once, signs an EIP-712 spending cap off-chain (zero gas), and the gateway then
 *         serves many inference jobs and settles them in a single `batchSettle` tx —
 *         turning per-call cost from 1–4 on-chain txs into ≈ 0. Each debit splits payment
 *         95% provider / 5% treasury, exactly like JobEscrow.
 *
 * @dev Trust model (Phase 1): the gateway holds SETTLER_ROLE and pays settlement gas. The
 *      requester's signed `SpendingCap` is the on-chain authorization that BOUNDS what the
 *      gateway can ever debit: settlement is capped at `maxSpendWei` per (requester, nonce),
 *      can only pay the providers/amounts in the signed batch, and never touches principal
 *      beyond the cap. Funds leave only via `batchSettle` (to providers/treasury) or
 *      withdraw-after-notice (back to the requester). A compromised settler cannot steal
 *      deposited principal — worst case is settling up to already-signed caps.
 *
 *      Replay/idempotency: every debit carries a `jobId`; a job settles at most once
 *      (`settledJob`). `spentAgainst[requester][nonce]` accumulates across batches so one
 *      signature funds incremental settlement until the cap or the deposit is exhausted.
 *
 *      Invariants asserted in tests:
 *        sum(providerPay) + protocolFee == sum(debit.amountWei)   (per batch)
 *        balanceAfter + totalSettled    == balanceBefore          (conservation)
 *        spentAgainst[r][n]             <= cap.maxSpendWei
 */
contract CreditAccount is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Protocol fee in basis points (500 == 5%). Bounded by MAX_FEE_RATE.
    uint16 public protocolFeeRate = 500;
    uint16 public constant MAX_FEE_RATE = 1000; // 10% hard cap
    uint16 public constant BPS_DENOMINATOR = 10000;

    /// @notice Delay between initiating and completing a withdrawal, so the gateway can
    ///         flush any pending signed debits before the requester pulls funds out.
    uint64 public constant WITHDRAWAL_NOTICE = 1 days;

    /// @dev EIP-712 typehash for the spending cap a requester signs off-chain.
    bytes32 public constant SPENDING_CAP_TYPEHASH = keccak256(
        "SpendingCap(address requester,address settler,uint256 maxSpendWei,uint256 nonce,uint256 deadline)"
    );

    struct SpendingCap {
        address requester; // who is authorizing the spend (and signs)
        address settler; // the only address allowed to submit batches for this cap
        uint256 maxSpendWei; // cumulative ceiling across all batches for this (requester, nonce)
        uint256 nonce; // namespaces independent sessions for the same requester
        uint256 deadline; // unix seconds; batches rejected after this
    }

    struct Debit {
        bytes32 jobId; // unique per job; settled at most once
        address provider; // node that served the job
        uint256 amountWei; // gross payment (split 95/5 here)
    }

    IERC20 public immutable token;
    address public treasury;

    /// @notice Deposited, unspent $QAIS per requester.
    mapping(address => uint256) public balanceOf;
    /// @notice Cumulative gross settled against a (requester, nonce) cap.
    mapping(address => mapping(uint256 => uint256)) public spentAgainst;
    /// @notice Jobs already settled (replay/idempotency guard).
    mapping(bytes32 => bool) public settledJob;
    /// @notice Earliest timestamp a requester may complete a withdrawal (0 == none pending).
    mapping(address => uint64) public withdrawableAt;

    // ─── Events ─────────────────────────────────────────────────────────────────
    event Deposited(address indexed requester, uint256 amount, uint256 newBalance);
    event BatchSettled(
        address indexed requester,
        address indexed settler,
        uint256 nonce,
        uint256 jobCount,
        uint256 totalPaid,
        uint256 protocolFee
    );
    event DebitSettled(
        bytes32 indexed jobId, address indexed provider, uint256 providerPay, uint256 protocolFee
    );
    event WithdrawalInitiated(address indexed requester, uint64 availableAt);
    event WithdrawalCompleted(address indexed requester, uint256 amount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ProtocolFeeRateUpdated(uint16 oldRate, uint16 newRate);

    // ─── Errors ──────────────────────────────────────────────────────────────────
    error ZeroAddress();
    error ZeroAmount();
    error EmptyBatch();
    error CapExpired(uint256 deadline);
    error WrongSettler(address expected, address actual);
    error BadSignature(address recovered, address requester);
    error CapExceeded(uint256 wouldSpend, uint256 maxSpendWei);
    error InsufficientBalance(uint256 needed, uint256 available);
    error JobAlreadySettled(bytes32 jobId);
    error NoWithdrawalPending();
    error WithdrawalNotReady(uint64 availableAt);
    error NothingToWithdraw();
    error FeeRateTooHigh(uint16 rate);

    constructor(IERC20 token_, address treasury_, address admin)
        EIP712("QueraIS CreditAccount", "1")
    {
        if (address(token_) == address(0) || treasury_ == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }
        token = token_;
        treasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ─── Deposit / withdraw ────────────────────────────────────────────────────────

    /// @notice Pre-fund a credit balance. The caller must have approved this contract.
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        // Effect first (CEI); SafeERC20 reverts on transfer failure so balance stays sound.
        balanceOf[msg.sender] += amount;
        // Re-depositing cancels any pending withdrawal (the requester is committing funds).
        if (withdrawableAt[msg.sender] != 0) withdrawableAt[msg.sender] = 0;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, balanceOf[msg.sender]);
    }

    /// @notice Start the withdrawal notice window. Settlement of already-signed debits can
    ///         still happen during the window; after it, the residual balance is withdrawable.
    function initiateWithdrawal() external {
        uint64 at = uint64(block.timestamp) + WITHDRAWAL_NOTICE;
        withdrawableAt[msg.sender] = at;
        emit WithdrawalInitiated(msg.sender, at);
    }

    /// @notice Withdraw the entire remaining balance once the notice window has elapsed.
    function completeWithdrawal() external nonReentrant {
        uint64 at = withdrawableAt[msg.sender];
        if (at == 0) revert NoWithdrawalPending();
        if (block.timestamp < at) revert WithdrawalNotReady(at);
        uint256 amount = balanceOf[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        // Effects
        balanceOf[msg.sender] = 0;
        withdrawableAt[msg.sender] = 0;

        // Interaction
        token.safeTransfer(msg.sender, amount);
        emit WithdrawalCompleted(msg.sender, amount);
    }

    // ─── Settlement ──────────────────────────────────────────────────────────────

    /// @notice Settle a batch of debits against a requester's signed spending cap. Pays each
    ///         provider 95% and the treasury 5%, all in one tx. Only the cap's named settler
    ///         may submit it, and only up to the signed ceiling / deposited balance.
    function batchSettle(SpendingCap calldata cap, bytes calldata signature, Debit[] calldata debits)
        external
        onlyRole(SETTLER_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (debits.length == 0) revert EmptyBatch();
        if (block.timestamp > cap.deadline) revert CapExpired(cap.deadline);
        if (cap.settler != msg.sender) revert WrongSettler(cap.settler, msg.sender);

        // Verify the EIP-712 signature authorizes this cap.
        address signer = ECDSA.recover(_hashCap(cap), signature);
        if (signer != cap.requester) revert BadSignature(signer, cap.requester);

        // Sum the batch and guard against double-settling any job (CEI: mark before transfer).
        uint256 total;
        for (uint256 i = 0; i < debits.length; i++) {
            Debit calldata d = debits[i];
            if (d.provider == address(0)) revert ZeroAddress();
            if (d.amountWei == 0) revert ZeroAmount();
            if (settledJob[d.jobId]) revert JobAlreadySettled(d.jobId);
            settledJob[d.jobId] = true;
            total += d.amountWei;
        }

        uint256 wouldSpend = spentAgainst[cap.requester][cap.nonce] + total;
        if (wouldSpend > cap.maxSpendWei) revert CapExceeded(wouldSpend, cap.maxSpendWei);
        if (total > balanceOf[cap.requester]) {
            revert InsufficientBalance(total, balanceOf[cap.requester]);
        }

        // Effects: debit the requester before any payout.
        balanceOf[cap.requester] -= total;
        spentAgainst[cap.requester][cap.nonce] = wouldSpend;

        // Interactions: pay providers individually, accrue the fee, then one treasury transfer.
        uint256 totalFee;
        for (uint256 i = 0; i < debits.length; i++) {
            Debit calldata d = debits[i];
            uint256 fee = (d.amountWei * protocolFeeRate) / BPS_DENOMINATOR;
            uint256 providerPay = d.amountWei - fee;
            totalFee += fee;
            if (providerPay > 0) token.safeTransfer(d.provider, providerPay);
            emit DebitSettled(d.jobId, d.provider, providerPay, fee);
        }
        if (totalFee > 0) token.safeTransfer(treasury, totalFee);

        emit BatchSettled(cap.requester, msg.sender, cap.nonce, debits.length, total, totalFee);
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

    /// @notice The EIP-712 digest a requester signs for `cap` (exposed for off-chain parity).
    function hashSpendingCap(SpendingCap calldata cap) external view returns (bytes32) {
        return _hashCap(cap);
    }

    /// @notice The EIP-712 domain separator (for off-chain signing parity / tests).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _hashCap(SpendingCap calldata cap) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SPENDING_CAP_TYPEHASH,
                    cap.requester,
                    cap.settler,
                    cap.maxSpendWei,
                    cap.nonce,
                    cap.deadline
                )
            )
        );
    }
}
