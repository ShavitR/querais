// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NodeRegistry
 * @notice Tracks node operators: their $QAIS stake, tier, reputation, and lifecycle
 *         (active / unbonding / suspended). Stake is collateral that backs honest
 *         inference; reputation is computed off-chain (EMA) and pushed on-chain by the
 *         oracle. This is the MVP slice — disputes are deferred; slashing is gated to a
 *         SLASHER_ROLE held by the protocol/gateway rather than a DisputeResolution
 *         contract.
 *
 * @dev Reputation is a uint16 in basis points of [0,1]: 10000 == 1.0000. New nodes
 *      start at 7000 (0.70), matching the reputation system's onboarding baseline.
 */
contract NodeRegistry is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ─── Tier thresholds (in QAIS wei) ──────────────────────────────────────────
    uint256 public constant BRONZE_THRESHOLD = 100 ether;
    uint256 public constant SILVER_THRESHOLD = 500 ether;
    uint256 public constant GOLD_THRESHOLD = 2_500 ether;
    uint256 public constant PLATINUM_THRESHOLD = 10_000 ether;

    /// @notice Reputation assigned to a freshly registered node (0.70 in bps).
    uint16 public constant INITIAL_REPUTATION = 7000;
    uint16 public constant MAX_REPUTATION = 10000;

    /// @notice Time a node must wait after initiating unbonding before withdrawing stake.
    uint64 public constant UNBONDING_PERIOD = 7 days;

    struct NodeInfo {
        bytes32 nodeId; // libp2p-style peer id hash (informational in MVP)
        uint256 stakeAmount; // current staked QAIS (wei)
        uint16 reputationScore; // 0..10000 == 0.0..1.0
        uint8 tier; // 0=Bronze 1=Silver 2=Gold 3=Platinum
        uint64 registeredAt; // for off-chain longevity scoring
        uint64 unbondingStartedAt; // 0 unless unbonding
        uint64 suspendedAt; // 0 unless suspended by a sub-minimum slash
        bool isActive; // visible & able to accept jobs
        bool isUnbonding; // withdrawing stake
        bool exists; // registered at all
    }

    IERC20 public immutable token;

    mapping(address => NodeInfo) private _nodes;
    mapping(bytes32 => address) public nodeIdToWallet;
    address[] private _activeNodes;
    mapping(address => uint256) private _activeIndex; // 1-based; 0 == not in array
    uint256 public totalStaked;

    // ─── Events ─────────────────────────────────────────────────────────────────
    event NodeRegistered(address indexed wallet, bytes32 indexed nodeId, uint256 stake, uint8 tier);
    event StakeAdded(address indexed wallet, uint256 newTotal, uint8 newTier);
    event NodeUnbonding(address indexed wallet, uint64 unbondingCompleteAt);
    event NodeUnbonded(address indexed wallet, uint256 returnedAmount);
    event ReputationUpdated(address indexed wallet, uint16 oldScore, uint16 newScore);
    event NodeSlashed(address indexed wallet, uint256 amount, string reason, uint256 remainingStake);
    event NodeSuspended(address indexed wallet, uint64 suspendedAt);
    event NodeReactivated(address indexed wallet, uint8 tier);

    // ─── Errors ──────────────────────────────────────────────────────────────────
    error ZeroAddress();
    error AlreadyRegistered();
    error NotRegistered();
    error StakeBelowMinimum(uint256 provided, uint256 required);
    error NodeIdTaken(bytes32 nodeId);
    error NotActive();
    error AlreadyUnbonding();
    error NotUnbonding();
    error UnbondingNotComplete(uint64 readyAt);
    error InvalidReputation(uint16 score);
    error AmountExceedsStake(uint256 amount, uint256 stake);
    error ZeroAmount();

    constructor(IERC20 token_, address admin) {
        if (address(token_) == address(0) || admin == address(0)) revert ZeroAddress();
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ─── Registration & staking ──────────────────────────────────────────────────

    /// @notice Register the caller as a node by staking QAIS. Caller must `approve` first.
    function registerNode(bytes32 nodeId, uint256 stake) external nonReentrant whenNotPaused {
        NodeInfo storage n = _nodes[msg.sender];
        if (n.exists) revert AlreadyRegistered();
        if (stake < BRONZE_THRESHOLD) revert StakeBelowMinimum(stake, BRONZE_THRESHOLD);
        if (nodeId == bytes32(0)) revert ZeroAmount();
        if (nodeIdToWallet[nodeId] != address(0)) revert NodeIdTaken(nodeId);

        // Effects
        n.nodeId = nodeId;
        n.stakeAmount = stake;
        n.reputationScore = INITIAL_REPUTATION;
        n.tier = _tierFor(stake);
        n.registeredAt = uint64(block.timestamp);
        n.isActive = true;
        n.exists = true;
        nodeIdToWallet[nodeId] = msg.sender;
        totalStaked += stake;
        _addActive(msg.sender);

        // Interaction
        token.safeTransferFrom(msg.sender, address(this), stake);

        emit NodeRegistered(msg.sender, nodeId, stake, n.tier);
    }

    /// @notice Add stake to an existing node. May promote tier and/or reactivate a
    ///         suspended node whose stake returns above the bronze minimum.
    function addStake(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        NodeInfo storage n = _nodes[msg.sender];
        if (!n.exists) revert NotRegistered();

        n.stakeAmount += amount;
        n.tier = _tierFor(n.stakeAmount);
        totalStaked += amount;

        // Reactivate a suspended (but not unbonding) node that is now solvent again.
        if (!n.isActive && !n.isUnbonding && n.stakeAmount >= BRONZE_THRESHOLD) {
            n.isActive = true;
            n.suspendedAt = 0;
            _addActive(msg.sender);
            emit NodeReactivated(msg.sender, n.tier);
        }

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit StakeAdded(msg.sender, n.stakeAmount, n.tier);
    }

    // ─── Unbonding / withdrawal ──────────────────────────────────────────────────

    /// @notice Begin the unbonding countdown; node leaves the marketplace immediately.
    function initiateUnbonding() external whenNotPaused {
        NodeInfo storage n = _nodes[msg.sender];
        if (!n.exists) revert NotRegistered();
        if (n.isUnbonding) revert AlreadyUnbonding();

        n.isUnbonding = true;
        n.unbondingStartedAt = uint64(block.timestamp);
        if (n.isActive) {
            n.isActive = false;
            _removeActive(msg.sender);
        }
        emit NodeUnbonding(msg.sender, uint64(block.timestamp) + UNBONDING_PERIOD);
    }

    /// @notice After the unbonding period, return the full stake and delete the node.
    function completeUnbonding() external nonReentrant {
        NodeInfo storage n = _nodes[msg.sender];
        if (!n.exists) revert NotRegistered();
        if (!n.isUnbonding) revert NotUnbonding();
        uint64 readyAt = n.unbondingStartedAt + UNBONDING_PERIOD;
        if (block.timestamp < readyAt) revert UnbondingNotComplete(readyAt);

        uint256 amount = n.stakeAmount;
        bytes32 nodeId = n.nodeId;

        // Effects: wipe state before transferring out.
        totalStaked -= amount;
        delete nodeIdToWallet[nodeId];
        delete _nodes[msg.sender];

        // Interaction
        if (amount > 0) token.safeTransfer(msg.sender, amount);
        emit NodeUnbonded(msg.sender, amount);
    }

    // ─── Oracle / slasher actions ────────────────────────────────────────────────

    /// @notice Push an off-chain-computed reputation score on-chain.
    function updateReputation(address wallet, uint16 newScore) external onlyRole(ORACLE_ROLE) {
        NodeInfo storage n = _nodes[wallet];
        if (!n.exists) revert NotRegistered();
        if (newScore > MAX_REPUTATION) revert InvalidReputation(newScore);
        uint16 old = n.reputationScore;
        n.reputationScore = newScore;
        emit ReputationUpdated(wallet, old, newScore);
    }

    /// @notice Slash a node's stake. Proceeds go to the treasury (burn/dispute split
    ///         deferred). A slash that drops stake below the bronze minimum suspends
    ///         the node; it can recover by adding stake or unbond after the period.
    function slash(address wallet, uint256 amount, string calldata reason)
        external
        onlyRole(SLASHER_ROLE)
        nonReentrant
    {
        _slash(wallet, amount, reason);
        // Slashed tokens remain in the contract balance (conceptually the treasury's);
        // the per-incident gateway slash keeps this legacy routing.
    }

    /// @notice Slash a node's stake and route the proceeds to `recipient` — the
    ///         DisputeResolution contract distributes them per the spec's
    ///         50% burn / 30% challenger / 20% treasury split (Slice 5B).
    function slashTo(address wallet, uint256 amount, address recipient, string calldata reason)
        external
        onlyRole(SLASHER_ROLE)
        nonReentrant
    {
        if (recipient == address(0)) revert ZeroAddress();
        _slash(wallet, amount, reason);
        token.safeTransfer(recipient, amount);
    }

    function _slash(address wallet, uint256 amount, string calldata reason) internal {
        if (amount == 0) revert ZeroAmount();
        NodeInfo storage n = _nodes[wallet];
        if (!n.exists) revert NotRegistered();
        if (amount > n.stakeAmount) revert AmountExceedsStake(amount, n.stakeAmount);

        n.stakeAmount -= amount;
        totalStaked -= amount;
        n.tier = _tierFor(n.stakeAmount);

        if (n.isActive && n.stakeAmount < BRONZE_THRESHOLD) {
            n.isActive = false;
            n.suspendedAt = uint64(block.timestamp);
            _removeActive(wallet);
            emit NodeSuspended(wallet, n.suspendedAt);
        }

        emit NodeSlashed(wallet, amount, reason, n.stakeAmount);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ─── Views ───────────────────────────────────────────────────────────────────

    function getNode(address wallet) external view returns (NodeInfo memory) {
        return _nodes[wallet];
    }

    function exists(address wallet) external view returns (bool) {
        return _nodes[wallet].exists;
    }

    /// @notice True if the node is active and meets the reputation floor — the cheap
    ///         on-chain check the gateway uses to validate an off-chain match.
    function isEligible(address wallet, uint16 minReputation) public view returns (bool) {
        NodeInfo storage n = _nodes[wallet];
        return n.exists && n.isActive && n.reputationScore >= minReputation;
    }

    function activeNodeCount() external view returns (uint256) {
        return _activeNodes.length;
    }

    function activeNodeAt(uint256 index) external view returns (address) {
        return _activeNodes[index];
    }

    /// @notice All active nodes meeting the reputation floor. Off-chain matching does
    ///         the model/price/region filtering against capability data it holds.
    function getEligibleNodes(uint16 minReputation) external view returns (address[] memory) {
        uint256 len = _activeNodes.length;
        address[] memory tmp = new address[](len);
        uint256 count;
        for (uint256 i; i < len; ++i) {
            address w = _activeNodes[i];
            if (_nodes[w].reputationScore >= minReputation) {
                tmp[count++] = w;
            }
        }
        // shrink to fit
        assembly {
            mstore(tmp, count)
        }
        return tmp;
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────────

    function _tierFor(uint256 stake) internal pure returns (uint8) {
        if (stake >= PLATINUM_THRESHOLD) return 3;
        if (stake >= GOLD_THRESHOLD) return 2;
        if (stake >= SILVER_THRESHOLD) return 1;
        return 0;
    }

    function _addActive(address wallet) internal {
        _activeNodes.push(wallet);
        _activeIndex[wallet] = _activeNodes.length; // 1-based
    }

    function _removeActive(address wallet) internal {
        uint256 idx = _activeIndex[wallet];
        if (idx == 0) return; // not present
        uint256 last = _activeNodes.length;
        if (idx != last) {
            address moved = _activeNodes[last - 1];
            _activeNodes[idx - 1] = moved;
            _activeIndex[moved] = idx;
        }
        _activeNodes.pop();
        _activeIndex[wallet] = 0;
    }
}
