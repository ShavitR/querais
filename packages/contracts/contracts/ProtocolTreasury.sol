// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ProtocolTreasury
 * @notice Slice 6A: protocol fees accumulate here as plain ERC-20 transfers (this
 *         contract simply replaces the treasury EOA as the fee recipient — settlement
 *         code is untouched), and a keeper-called `distribute()` executes the
 *         tokenomics' 60/20/20 ops/staker/burn split in ONE tx per epoch.
 *
 * @dev Accumulate-and-sweep, NOT the spec's per-settlement `receiveFee`: splitting +
 *      burning on every settlement would put token ops on the hot `batchSettle` path
 *      for identical economics at far more gas. Until the staking pool exists (6B:
 *      node-operator stakes — Option 1), the staker share parks here under
 *      `stakerEarmarkWei`, which `allocate()` can never touch. Pausing blocks
 *      `distribute()`/`allocate()`; the treasury holds protocol funds ONLY, so there
 *      is deliberately no user exit path to keep open while paused.
 */
contract ProtocolTreasury is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────
    /// @notice May call distribute() — the gateway's hot key (the daily epoch keeper).
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ─── Split rates (tokenomics: 20% burn / 20% stakers / 60% ops) ───────────
    uint16 public burnRateBps = 2000;
    uint16 public stakerRateBps = 2000;

    ERC20Burnable public immutable token;

    /// @notice The 6B staking pool; address(0) until it exists (share parks here).
    address public stakerPool;
    /// @notice Staker share accrued while no pool is set. Never spendable via allocate().
    uint256 public stakerEarmarkWei;
    /// @notice The retained ops share (the 60%) — the only funds allocate() may spend.
    ///         Tracked explicitly so a sweep never re-splits what an earlier sweep kept.
    uint256 public opsRetainedWei;

    // Audit counters (monotonic).
    uint256 public totalDistributed;
    uint256 public totalBurned;
    uint256 public totalToStakers;
    uint256 public totalAllocated;

    // ─── Events ───────────────────────────────────────────────────────────────
    event Distributed(uint256 pending, uint256 burned, uint256 toStakers, uint256 opsRetained);
    event Allocated(address indexed recipient, uint256 amount, string purpose);
    event RatesUpdated(uint16 burnRateBps, uint16 stakerRateBps);
    event StakerPoolSet(address indexed pool, uint256 earmarkFlushed);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error ZeroAddress();
    error ZeroAmount();
    error NothingToDistribute();
    error RatesExceedTotal(uint16 burnBps, uint16 stakerBps);
    error ExceedsSpendable(uint256 requested, uint256 spendable);

    constructor(ERC20Burnable token_, address admin) {
        if (address(token_) == address(0) || admin == address(0)) revert ZeroAddress();
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Fees that arrived since the last sweep (earmark + retained ops are the
    ///         already-swept remainder of the balance).
    function pendingDistribution() public view returns (uint256) {
        return token.balanceOf(address(this)) - stakerEarmarkWei - opsRetainedWei;
    }

    // ─── The epoch sweep ──────────────────────────────────────────────────────

    /// @notice Execute the burn/staker/ops split over everything accrued since the
    ///         last sweep. Ops = remainder (absorbs rounding — conservation is exact).
    function distribute() external onlyRole(KEEPER_ROLE) nonReentrant whenNotPaused {
        uint256 pending = pendingDistribution();
        if (pending == 0) revert NothingToDistribute();

        uint256 burnAmount = (pending * burnRateBps) / 10000;
        uint256 stakerAmount = (pending * stakerRateBps) / 10000;
        uint256 opsRetained = pending - burnAmount - stakerAmount;

        totalDistributed += pending;
        totalBurned += burnAmount;
        totalToStakers += stakerAmount;
        opsRetainedWei += opsRetained;

        if (burnAmount > 0) token.burn(burnAmount);
        if (stakerAmount > 0) {
            if (stakerPool != address(0)) {
                IERC20(address(token)).safeTransfer(stakerPool, stakerAmount);
            } else {
                stakerEarmarkWei += stakerAmount; // parks until 6B
            }
        }
        // opsRetained simply stays in the balance, spendable via allocate().

        emit Distributed(pending, burnAmount, stakerAmount, opsRetained);
    }

    // ─── Ops spending ─────────────────────────────────────────────────────────

    /// @notice Spend from the retained ops share (grants, incentives, marketing).
    ///         Can never dip into the staker earmark.
    function allocate(address recipient, uint256 amount, string calldata purpose)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
        whenNotPaused
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > opsRetainedWei) revert ExceedsSpendable(amount, opsRetainedWei);

        opsRetainedWei -= amount;
        totalAllocated += amount;
        IERC20(address(token)).safeTransfer(recipient, amount);
        emit Allocated(recipient, amount, purpose);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setRates(uint16 burnBps, uint16 stakerBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (uint32(burnBps) + uint32(stakerBps) > 10000) revert RatesExceedTotal(burnBps, stakerBps);
        burnRateBps = burnBps;
        stakerRateBps = stakerBps;
        emit RatesUpdated(burnBps, stakerBps);
    }

    /// @notice Wire the 6B staking pool; any parked earmark flushes to it immediately.
    function setStakerPool(address pool) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (pool == address(0)) revert ZeroAddress();
        stakerPool = pool;
        uint256 flushed = stakerEarmarkWei;
        if (flushed > 0) {
            stakerEarmarkWei = 0;
            IERC20(address(token)).safeTransfer(pool, flushed);
        }
        emit StakerPoolSet(pool, flushed);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
