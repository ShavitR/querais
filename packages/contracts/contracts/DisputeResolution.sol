// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {NodeRegistry} from "./NodeRegistry.sol";

/**
 * @title DisputeResolution
 * @notice The Slice-5B challenge hook: the FAST track of the dispute design
 *         (querais_smart_contracts.md §5). A challenger posts a 50-QAIS bond against a
 *         provider; the provider may submit counter-evidence within 24h; the trusted
 *         verification oracle resolves clear-cut cases (`autoResolve`) — challenger
 *         wins → 20%-of-stake slash routed 50% burn / 30% challenger / 20% treasury and
 *         the bond returns; provider wins → the bond burns (deters frivolous disputes).
 *
 * @dev Deliberately minimal: the arbitration panel, commit-reveal voting, and
 *      escalation tracks are Phase 5. Evidence is content hashes only (IPFS later) —
 *      the chain stores commitments, never prompt/output text. Disputes act on STAKE,
 *      not escrow: Layer-A samples settled jobs (both venues), so the payment already
 *      moved; the deterrent is the slash. Pause semantics follow the protocol rule —
 *      value inflows (raiseDispute) and settlement (autoResolve) freeze, while the
 *      defendant's counter-evidence and the challenger's timeout reclaim stay open
 *      (a pause can never trap funds or silence a defense).
 */
contract DisputeResolution is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ─── Economics (spec §5) ──────────────────────────────────────────────────
    /// @notice QAIS a challenger must post to raise a dispute.
    uint256 public constant CHALLENGER_BOND = 50 ether;
    /// @notice Fraction of the defendant's stake slashed on a lost dispute (bps).
    uint16 public constant SLASH_BPS = 2000; // 20%
    /// @notice Of the slashed amount: burned / to the challenger; remainder → treasury.
    uint16 public constant BURN_SHARE_BPS = 5000; // 50%
    uint16 public constant CHALLENGER_SHARE_BPS = 3000; // 30% (treasury gets the rest)

    /// @notice Window for the defendant to commit counter-evidence.
    uint64 public constant COUNTER_EVIDENCE_WINDOW = 24 hours;
    /// @notice After this long unresolved, the challenger can reclaim the bond
    ///         (the no-trapped-funds escape hatch; resolution should take ~days).
    uint64 public constant RECLAIM_AFTER = 30 days;

    enum DisputeStatus {
        NONE,
        OPEN,
        COUNTERED,
        RESOLVED
    }

    struct Dispute {
        address challenger;
        address defendant;
        uint256 bond;
        bytes32 evidenceHash; // content hash (IPFS in later phases)
        bytes32 counterEvidenceHash;
        uint64 raisedAt;
        DisputeStatus status;
        bool challengerWon;
    }

    ERC20Burnable public immutable token;
    NodeRegistry public immutable registry;
    address public immutable treasury;

    /// @dev Keyed by jobId — one dispute per job, ever (matches the escrow's identity).
    mapping(bytes32 => Dispute) public disputes;

    // ─── Events ───────────────────────────────────────────────────────────────
    event DisputeRaised(
        bytes32 indexed jobId, address indexed challenger, address indexed defendant, uint256 bond
    );
    event CounterEvidenceSubmitted(bytes32 indexed jobId, address indexed defendant);
    event DisputeResolved(bytes32 indexed jobId, bool challengerWon, uint256 slashAmount);
    event BondReclaimed(bytes32 indexed jobId, address indexed challenger, uint256 bond);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error ZeroAddress();
    error ZeroEvidence();
    error DisputeExists(bytes32 jobId);
    error NoSuchDispute(bytes32 jobId);
    error NotANode(address defendant);
    error NotDefendant();
    error NotChallenger();
    error AlreadyCountered();
    error AlreadyResolved(bytes32 jobId);
    error CounterWindowClosed(uint64 closedAt);
    error ReclaimNotReady(uint64 readyAt);

    constructor(ERC20Burnable token_, NodeRegistry registry_, address treasury_, address admin) {
        if (
            address(token_) == address(0) || address(registry_) == address(0)
                || treasury_ == address(0) || admin == address(0)
        ) revert ZeroAddress();
        token = token_;
        registry = registry_;
        treasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ─── Challenge ────────────────────────────────────────────────────────────

    /// @notice Raise a dispute against a provider for a job, posting the bond.
    ///         Caller must `approve` CHALLENGER_BOND first.
    function raiseDispute(bytes32 jobId, address defendant, bytes32 evidenceHash)
        external
        nonReentrant
        whenNotPaused
    {
        if (evidenceHash == bytes32(0)) revert ZeroEvidence();
        Dispute storage d = disputes[jobId];
        if (d.status != DisputeStatus.NONE) revert DisputeExists(jobId);
        if (!registry.exists(defendant)) revert NotANode(defendant);

        // Effects
        d.challenger = msg.sender;
        d.defendant = defendant;
        d.bond = CHALLENGER_BOND;
        d.evidenceHash = evidenceHash;
        d.raisedAt = uint64(block.timestamp);
        d.status = DisputeStatus.OPEN;

        // Interaction
        IERC20(address(token)).safeTransferFrom(msg.sender, address(this), CHALLENGER_BOND);

        emit DisputeRaised(jobId, msg.sender, defendant, CHALLENGER_BOND);
    }

    /// @notice The defendant commits counter-evidence within the 24h window.
    ///         Deliberately NOT pausable — a pause must never silence a defense.
    function submitCounterEvidence(bytes32 jobId, bytes32 counterEvidenceHash) external {
        if (counterEvidenceHash == bytes32(0)) revert ZeroEvidence();
        Dispute storage d = disputes[jobId];
        if (d.status == DisputeStatus.NONE) revert NoSuchDispute(jobId);
        if (d.status == DisputeStatus.RESOLVED) revert AlreadyResolved(jobId);
        if (d.status == DisputeStatus.COUNTERED) revert AlreadyCountered();
        if (msg.sender != d.defendant) revert NotDefendant();
        uint64 closesAt = d.raisedAt + COUNTER_EVIDENCE_WINDOW;
        if (block.timestamp > closesAt) revert CounterWindowClosed(closesAt);

        d.counterEvidenceHash = counterEvidenceHash;
        d.status = DisputeStatus.COUNTERED;
        emit CounterEvidenceSubmitted(jobId, msg.sender);
    }

    // ─── Resolution (FAST track: trusted oracle; the panel is Phase 5) ────────

    /// @notice Oracle resolves a clear-cut case (its re-run confirmed the outcome).
    function autoResolve(bytes32 jobId, bool challengerWins)
        external
        onlyRole(ORACLE_ROLE)
        nonReentrant
        whenNotPaused
    {
        Dispute storage d = disputes[jobId];
        if (d.status == DisputeStatus.NONE) revert NoSuchDispute(jobId);
        if (d.status == DisputeStatus.RESOLVED) revert AlreadyResolved(jobId);

        d.status = DisputeStatus.RESOLVED;
        d.challengerWon = challengerWins;

        uint256 slashAmount = 0;
        if (challengerWins) {
            uint256 stake = registry.getNode(d.defendant).stakeAmount;
            slashAmount = (stake * SLASH_BPS) / 10000;
            uint256 challengerCut = 0;
            if (slashAmount > 0) {
                // Pull the slashed stake here, then split it 50/30/20.
                registry.slashTo(d.defendant, slashAmount, address(this), "dispute lost");
                uint256 burnAmount = (slashAmount * BURN_SHARE_BPS) / 10000;
                challengerCut = (slashAmount * CHALLENGER_SHARE_BPS) / 10000;
                uint256 treasuryCut = slashAmount - burnAmount - challengerCut; // absorbs rounding
                token.burn(burnAmount);
                IERC20(address(token)).safeTransfer(treasury, treasuryCut);
            }
            // Bond returns to the winning challenger alongside their cut.
            IERC20(address(token)).safeTransfer(d.challenger, d.bond + challengerCut);
        } else {
            // Frivolous-challenge deterrent: the losing challenger's bond burns.
            token.burn(d.bond);
        }

        emit DisputeResolved(jobId, challengerWins, slashAmount);
    }

    /// @notice Escape hatch: if a dispute sits unresolved past RECLAIM_AFTER, the
    ///         challenger recovers the bond (no slash, no winner). NOT pausable —
    ///         the protocol's pause rule forbids trapping funds.
    function reclaimBond(bytes32 jobId) external nonReentrant {
        Dispute storage d = disputes[jobId];
        if (d.status == DisputeStatus.NONE) revert NoSuchDispute(jobId);
        if (d.status == DisputeStatus.RESOLVED) revert AlreadyResolved(jobId);
        if (msg.sender != d.challenger) revert NotChallenger();
        uint64 readyAt = d.raisedAt + RECLAIM_AFTER;
        if (block.timestamp < readyAt) revert ReclaimNotReady(readyAt);

        d.status = DisputeStatus.RESOLVED;
        d.challengerWon = false;
        IERC20(address(token)).safeTransfer(d.challenger, d.bond);
        emit BondReclaimed(jobId, d.challenger, d.bond);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
