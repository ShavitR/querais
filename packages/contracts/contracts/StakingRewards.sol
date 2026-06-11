// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {NodeRegistry} from "./NodeRegistry.sol";

/**
 * @title StakingRewards
 * @notice Slice 6B (Option 1: node-operator stakes ARE the stakers). The treasury's
 *         20% staker share flows here (`ProtocolTreasury.setStakerPool`); a keeper
 *         epoch call credits it pro-rata to the ACTIVE staked nodes in `NodeRegistry`;
 *         operators pull their earnings with `claim()`.
 *
 * @dev Discrete epoch crediting, computed fully on-chain: stakes change in the registry
 *      without notifying anyone (register/addStake/slash/unbond), so continuous
 *      Synthetix-style accrual would need registry hooks. Instead the active node set —
 *      small and enumerable on-chain — is walked in one keeper tx. Known trade-off:
 *      whoever is staked at sweep time gets that epoch's full pro-rata share (no
 *      intra-epoch time-weighting); acceptable at daily epochs, revisit with Phase-4
 *      trustlessness. Known scale limit: O(n) registry reads per epoch; the scale-out
 *      path is a Merkle-epoch distributor, deferred with horizontal scale.
 *      Pausing blocks crediting; `claim()` is deliberately NOT pausable — earned
 *      rewards are a user exit and a pause can never trap funds.
 */
contract StakingRewards is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────
    /// @notice May call distributeEpoch() — the gateway's hot key (the epoch keeper).
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IERC20 public immutable token;
    NodeRegistry public immutable registry;

    /// @notice Earned, unclaimed rewards per node-operator wallet. A token debt —
    ///         it survives later slashes/unbonding (earned while staked).
    mapping(address => uint256) public claimable;

    // Audit counters (monotonic). balance − (credited − claimed) = pending rewards.
    uint256 public totalCredited;
    uint256 public totalClaimed;

    // ─── Events ───────────────────────────────────────────────────────────────
    event EpochDistributed(uint256 credited, uint256 activeNodes, uint256 totalActiveStake);
    event Claimed(address indexed operator, uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error ZeroAddress();
    error NothingToCredit();
    error NoActiveNodes();
    error NothingToClaim();

    constructor(IERC20 token_, NodeRegistry registry_, address admin) {
        if (address(token_) == address(0) || address(registry_) == address(0) || admin == address(0))
        {
            revert ZeroAddress();
        }
        token = token_;
        registry = registry_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Staker-share funds that arrived but are not yet credited to operators.
    function pendingRewards() public view returns (uint256) {
        return token.balanceOf(address(this)) - (totalCredited - totalClaimed);
    }

    // ─── Epoch crediting ──────────────────────────────────────────────────────

    /// @notice Credit everything pending pro-rata to the currently ACTIVE staked nodes.
    ///         Division dust stays pending and rolls into the next epoch — the credited
    ///         amounts always conserve exactly against what was swept in.
    function distributeEpoch() external onlyRole(KEEPER_ROLE) nonReentrant whenNotPaused {
        uint256 pending = pendingRewards();
        if (pending == 0) revert NothingToCredit();
        uint256 n = registry.activeNodeCount();
        if (n == 0) revert NoActiveNodes(); // funds simply wait for the next epoch

        uint256 totalActiveStake = 0;
        for (uint256 i; i < n; ++i) {
            totalActiveStake += registry.getNode(registry.activeNodeAt(i)).stakeAmount;
        }
        if (totalActiveStake == 0) revert NoActiveNodes();

        uint256 credited = 0;
        for (uint256 i; i < n; ++i) {
            address wallet = registry.activeNodeAt(i);
            uint256 share = (pending * registry.getNode(wallet).stakeAmount) / totalActiveStake;
            if (share > 0) {
                claimable[wallet] += share;
                credited += share;
            }
        }
        totalCredited += credited;

        emit EpochDistributed(credited, n, totalActiveStake);
    }

    // ─── Operator claims ──────────────────────────────────────────────────────

    /// @notice Pull all earned rewards. Deliberately NOT pausable (user exit).
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();

        claimable[msg.sender] = 0;
        totalClaimed += amount;
        token.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
