# QueraIS — Smart Contract Design
## On-Chain Architecture Specification

> This document is a **design specification**, not code. It describes the intended behavior of each contract for implementation by Solidity engineers.

---

## 1. Contract Overview

QueraIS uses 5 core smart contracts, deployed on **Arbitrum One** (EVM-compatible L2).

```
┌──────────────────────────────────────────────────────────────┐
│                    CONTRACT ARCHITECTURE                     │
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │  QAIS Token │    │ NodeRegistry│    │  JobEscrow      │  │
│  │  (ERC-20)   │◄──►│             │◄──►│  (also serves  │  │
│  │             │    │  Stake mgmt  │    │  as JobRegistry)│  │
│  └──────┬──────┘    └──────┬──────┘    └────────┬────────┘  │
│         │                  │                    │           │
│         └──────────────────┼────────────────────┘           │
│                            │                                │
│                  ┌─────────▼─────────┐                      │
│                  │  DisputeResolution │                      │
│                  │                   │                      │
│                  │  Challenge flow   │                      │
│                  └─────────┬─────────┘                      │
│                            │                                │
│                  ┌─────────▼─────────┐                      │
│                  │ ProtocolTreasury  │                      │
│                  │                   │                      │
│                  │ Fee accumulation  │                      │
│                  │ Burn execution    │                      │
│                  └───────────────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

> Note: The original design listed a separate `JobRegistry.sol` as the 6th contract. This has been removed. `JobEscrow.sol` already maintains the authoritative `mapping(bytes32 => Job)` record of all job data and statuses. A separate registry contract would duplicate this state, creating sync complexity and additional attack surface with no benefit.

---

## 2. QUAISToken.sol

### Purpose
Standard ERC-20 token with a burn function. No mint function after initial deployment.

### Key Properties
```
name:        "QueraIS Token"
symbol:      "QAIS"
decimals:    18
totalSupply: 1,000,000,000 × 10^18 (fixed)
```

### State Variables
```
mapping(address => uint256) balances
mapping(address => mapping(address => uint256)) allowances
uint256 totalSupply           // starts at 1B, decreases with burns
uint256 totalBurned           // cumulative burned, for transparency
address treasury              // ProtocolTreasury contract address
```

### Key Functions

**`transfer(to, amount)`**
- Standard ERC-20 transfer
- No fee on transfer (fees happen at escrow level)

**`burn(amount)`**
- Called by ProtocolTreasury to execute protocol burns
- Also callable by any holder who wants to voluntarily burn
- Decreases totalSupply permanently

**`burnFrom(from, amount)`**
- Called by DisputeResolution to slash and burn
- Requires approval or is called via delegatecall from approved contracts

### Events
```
Transfer(from, to, amount)
Approval(owner, spender, amount)
Burn(from, amount, newTotalSupply)
```

---

## 3. NodeRegistry.sol

### Purpose
Manages node registration, stake management, and reputation scores.

### State Variables
```
struct NodeInfo {
  address wallet;
  bytes32 nodeId;              // libp2p peer ID hash
  uint256 stakeAmount;         // current staked QAIS (wei)
  uint256 reputationScore;     // 0–10000 (represents 0.0000–1.0000)
  uint256 registeredAt;        // block.timestamp of registration
  uint256 lastActiveAt;        // last ping/job completion
  bool    isActive;            // currently active in marketplace
  bool    isUnbonding;         // in 7-day unbonding period
  uint256 unbondingStartedAt;  // timestamp of unbonding start
  uint8   tier;                // 0=Bronze, 1=Silver, 2=Gold, 3=Platinum
  uint256 totalJobsCompleted;
  uint256 totalSlashAmount;    // cumulative slashed
}

mapping(address => NodeInfo) public nodes;
mapping(bytes32 => address) public nodeIdToWallet;  // reverse lookup
address[] public activeNodes;                        // for enumeration
uint256 public totalStaked;                          // global stake total
```

### Stake Tier Thresholds (configurable by governance)
```
BRONZE_THRESHOLD   = 100    × 10^18 QAIS
SILVER_THRESHOLD   = 500    × 10^18 QAIS
GOLD_THRESHOLD     = 2500   × 10^18 QAIS
PLATINUM_THRESHOLD = 10000  × 10^18 QAIS
```

### Key Functions

**`registerNode(nodeId, initialStake)`**
- Caller must have approved QAIS spend
- Transfers stake to contract
- Creates NodeInfo struct
- Emits NodeRegistered event
- Requires: initialStake >= BRONZE_THRESHOLD

**`addStake(additionalAmount)`**
- Increases stake for existing node
- May upgrade tier if threshold crossed

**`initiateUnbonding()`**
- Sets isUnbonding = true, isActive = false
- Records unbondingStartedAt
- Node removed from active marketplace

**`completeUnbonding()`**
- Requires: block.timestamp >= unbondingStartedAt + 7 days
- Requires: isUnbonding == true
- Transfers full stake back to wallet
- Deletes NodeInfo

**`updateReputation(nodeWallet, newScore)`**
- Restricted: Only callable by authorized oracle addresses
- Updates reputationScore
- Emits ReputationUpdated event

**`slash(nodeWallet, amount, reason)`**
- Restricted: Only callable by DisputeResolution contract
- Reduces stakeAmount by amount
- Sends slashed amount to DisputeResolution for distribution
- Emits NodeSlashed event
- If stakeAmount falls below tier threshold, demotes tier
- **If stakeAmount falls below BRONZE_THRESHOLD after slash:** sets node status to SUSPENDED
  and emits NodeSuspended with a 72-hour grace period timestamp
  (see `handleSubMinimumStake` and `deactivateSuspendedNode` below)

**`handleSubMinimumStake(nodeWallet)`**
- Callable by anyone (permissionless) once a slash leaves a node below BRONZE_THRESHOLD
- Verifies: `nodes[nodeWallet].stakeAmount < BRONZE_THRESHOLD && nodes[nodeWallet].isActive == true`
- Sets `isActive = false`, sets `suspendedAt = block.timestamp`
- Node is no longer visible in marketplace and cannot accept new jobs
- Emits `NodeSuspended(wallet, gracePeriodEndsAt)` with `gracePeriodEndsAt = block.timestamp + 72 hours`
- During grace period: operator can call `addStake()` to restore to a valid tier and reactivate

**`deactivateSuspendedNode(nodeWallet)`**
- Callable by anyone after the 72-hour grace period expires without stake top-up
- Verifies: `block.timestamp >= nodes[nodeWallet].suspendedAt + 72 hours`
- Sets `isUnbonding = true`, `unbondingStartedAt = block.timestamp`
- Any pending job assignment for this node emits `JobInvalidated` so the gateway can refund requesters
- Emits `NodeDeactivated(wallet)`
- After the standard 7-day unbonding, remaining stake returned to operator wallet

**`getEligibleNodes(modelId, minReputation, maxPrice, region)`**
- View function
- Returns array of node addresses matching criteria
- Used by off-chain matching engine to pre-filter candidates

### Events
```
NodeRegistered(wallet, nodeId, stakeAmount, tier)
NodeUnbonding(wallet, unbondingCompleteAt)
NodeUnbonded(wallet, returnedAmount)
StakeAdded(wallet, newTotal, newTier)
NodeSlashed(wallet, amount, reason, remainingStake)
ReputationUpdated(wallet, oldScore, newScore)
```

---

## 4. JobEscrow.sol

### Purpose
Locks requester funds for each job, releases on completion, handles refunds.

### State Variables
```
struct Job {
  bytes32 jobId;
  address requester;
  address provider;            // winning node wallet
  uint256 lockedAmount;        // QAIS locked at max price
  uint256 agreedPricePerToken; // provider's winning bid
  uint256 maxTokens;           // max tokens allowed
  uint256 actualTokens;        // set on completion
  uint256 lockedAt;
  uint256 deadline;            // job must complete by this time
  JobStatus status;
}

enum JobStatus {
  PENDING,      // Job created, waiting for provider assignment
  ASSIGNED,     // Provider selected, execution started
  COMPLETED,    // Provider submitted completion, pending verification
  VERIFIED,     // Verification passed, funds released
  DISPUTED,     // Under dispute
  FAILED,       // Verification failed or deadline passed
  CANCELLED     // Requester cancelled before assignment
}

mapping(bytes32 => Job) public jobs;
uint256 public PROTOCOL_FEE_RATE = 500; // 500 = 5% (basis points)
address public protocolTreasury;
address public nodeRegistry;
address public disputeResolution;
```

### Key Functions

**`createJob(jobId, provider, maxPayment, deadline)`**
- Called when requester approves a job
- Transfers maxPayment QAIS from requester to escrow
- Creates Job struct with status PENDING
- Emits JobCreated

**`assignJob(jobId, providerWallet, bidPricePerToken)`**
- Called by authorized matching engine (or on-chain after Phase 2)
- Sets provider, agreedPricePerToken
- Status → ASSIGNED
- Emits JobAssigned

**`completeJob(jobId, actualTokenCount, resultHash)`**
- Called by provider node (or protocol on provider's behalf)
- Records actualTokens and resultHash
- Status → COMPLETED
- Starts verification timeout clock

**`verifyAndRelease(jobId)`**
- Called by verification oracle (or after timeout with no dispute)
- Calculates actual payment: actualTokens × agreedPricePerToken
- provider_pay = actualPayment × (10000 - PROTOCOL_FEE_RATE) / 10000
- fee = actualPayment × PROTOCOL_FEE_RATE / 10000
- refund = lockedAmount - actualPayment
- Executes 3 transfers atomically:
  * QAIS.transfer(provider, provider_pay)
  * QAIS.transfer(treasury, fee)
  * QAIS.transfer(requester, refund)
- Status → VERIFIED
- Emits JobVerified, PaymentReleased

**`raiseDispute(jobId)`**
- Called by requester or oracle within dispute window (24h after COMPLETED)
- Status → DISPUTED
- Transfers control to DisputeResolution contract

**`cancelJob(jobId)`**
- Only callable in PENDING status (not yet assigned)
- Full refund to requester
- Status → CANCELLED

**`timeoutJob(jobId)`**
- Callable by anyone after deadline passes with ASSIGNED status
- Provider penalized (slashed for abandonment)
- Refund issued to requester
- Status → FAILED

### Events
```
JobCreated(jobId, requester, maxPayment, deadline)
JobAssigned(jobId, provider, pricePerToken)
JobCompleted(jobId, actualTokens, resultHash)
JobVerified(jobId, providerPay, protocolFee, refund)
JobDisputed(jobId, disputedBy)
JobFailed(jobId, reason)
PaymentReleased(jobId, provider, amount)
```

---

## 5. DisputeResolution.sol

### Purpose
Manages the dispute lifecycle, from challenge through arbitration to resolution.

### State Variables
```
struct Dispute {
  bytes32 jobId;
  address challenger;          // who raised the dispute
  address defendant;           // the provider being disputed
  uint256 challengerBond;      // QAIS posted by challenger
  bytes   evidence;            // IPFS hash of evidence
  bytes   counterEvidence;     // provider's response
  uint256 raisedAt;
  DisputeStatus status;
  DisputeTrack track;          // FAST, STANDARD, ESCALATED
  address[] arbitrators;       // selected panel
  uint256 voteCount;           // total votes cast
  uint256 votesForChallenger;  // count of votes in challenger's favor
  bool    challengerWins;      // final outcome
}

// Vote tracking is stored OUTSIDE the struct (Solidity does not allow
// mappings inside structs that are themselves stored in mappings).
// These parallel mappings are keyed by jobId:
mapping(bytes32 => Dispute) public disputes;
mapping(bytes32 => mapping(address => bool)) public hasVoted;        // has this arbitrator voted?
mapping(bytes32 => mapping(address => bool)) public voteForChallenger; // true = voted for challenger

enum DisputeStatus {
  OPEN, EVIDENCE_SUBMITTED, VOTING, RESOLVED, CANCELLED
}

enum DisputeTrack { FAST, STANDARD, ESCALATED }

uint256 public CHALLENGER_BOND = 50 * 10**18;      // 50 QAIS to raise dispute
uint256 public ARBITRATOR_REWARD = 10 * 10**18;    // 10 QAIS per arbitrator (base)
```

### Key Functions

**`raiseDispute(jobId, evidenceIPFSHash)`**
- Requires CHALLENGER_BOND QAIS from caller
- Locks bond
- Creates Dispute struct
- Notifies provider (emits event, provider daemon listens)
- Selects dispute track based on job value

**`submitCounterEvidence(jobId, counterEvidenceIPFSHash)`**
- Only callable by defendant (provider wallet)
- Must be called within 24 hours of dispute raised
- Moves to STANDARD or ESCALATED track

**`autoResolve(jobId, challengerWins)`**
- Only callable by authorized oracle
- For FAST track only (oracle re-run confirms clear outcome)
- Executes resolution immediately

**`castArbitratorVote(jobId, challengerWins)`**
- Only callable by selected arbitrators
- Records vote
- If majority reached, triggers resolution

**`executeResolution(jobId)`**
- Callable after voting period ends or majority reached
- If challenger wins:
  * slash provider: 20% of stake
  * return challenger bond
  * pay challenger 30% of slashed amount
  * burn 50% of slashed amount
  * treasury gets 20% of slashed amount
  * pay arbitrators from ARBITRATOR_REWARD pool
  * update reputation score via oracle
* If provider wins:
  * burn challenger bond (deters frivolous disputes)
  * small reputation boost for provider
  * pay arbitrators from ARBITRATOR_REWARD pool

### Events
```
DisputeRaised(jobId, challenger, bond, track)
CounterEvidenceSubmitted(jobId, defendant)
DisputeResolved(jobId, challengerWins, slashAmount)
ArbitratorVoted(jobId, arbitrator, vote)
```

---

## 6. ProtocolTreasury.sol

### Purpose
Accumulates all protocol fees, manages burn schedule, and controls fund allocation.

### State Variables
```
uint256 public totalFeesCollected;
uint256 public totalBurned;
uint256 public totalDistributed;
address public token;            // QAIS token address
address public governance;       // DAO governance contract (future)
address[] public multisigSigners; // initial multi-sig

uint256 public BURN_RATE = 2000;     // 20% of fees burned
uint256 public STAKER_RATE = 2000;   // 20% to staking rewards
// Remaining 60% stays in treasury for operations
```

### Key Functions

**`receiveFee(amount)`**
- Called from JobEscrow on each job settlement
- Splits the incoming fee:
  * burn_amount = amount × BURN_RATE / 10000
  * staker_amount = amount × STAKER_RATE / 10000
  * treasury_amount = remaining
- Calls token.burn(burn_amount) immediately
- Sends staker_amount to staking rewards pool
- Retains treasury_amount

**`allocate(recipient, amount, description)`**
- Restricted: multisig (initially) or governance vote (later)
- Used for: engineering grants, node incentives, marketing, etc.

**`updateRates(newBurnRate, newStakerRate)`**
- Restricted: governance only
- Must satisfy: burnRate + stakerRate <= 10000

---

## 7. Contract Security Considerations

### 7.1 Reentrancy Protection
- All contracts use OpenZeppelin's ReentrancyGuard
- External calls (token transfers) always happen AFTER state changes (CEI pattern)

### 7.2 Access Control
- OpenZeppelin AccessControl with roles:
  * ORACLE_ROLE: Can call updateReputation, verifyAndRelease
  * MATCHING_ENGINE_ROLE: Can call assignJob
  * DISPUTE_ROLE: Can call slash
  * GOVERNANCE_ROLE: Can update fee rates, thresholds
  * DEFAULT_ADMIN_ROLE: Multi-sig during launch, transfers to DAO

### 7.3 Front-Running Protection
- Job assignment uses commit-reveal scheme in Phase 2 (bids committed as hashes, revealed in same block)
- Prevents MEV bots from inserting themselves as winning bidders

### 7.4 Oracle Manipulation Protection
- Minimum 2 independent oracle confirmations for verification
- Oracle addresses managed via ORACLE_ROLE — quorum required to add/remove
- Dispute mechanism allows challenging oracle decisions

### 7.5 Integer Overflow/Underflow
- Solidity 0.8.x+ — built-in overflow protection
- All fee calculations use basis points (avoid floating point)

### 7.6 Token Approval Exploits
- Use safeTransferFrom from OpenZeppelin SafeERC20
- Require exact approval amounts (not unlimited approvals in UX)

---

## 8. Deployment Strategy

### 8.1 Network
- **Primary**: Arbitrum One (low fees, fast finality, EVM compatible)
- **Alternative**: Base (Coinbase ecosystem, if targeting US developers)
- **Future**: Multi-chain with canonical bridge

### 8.2 Deployment Order
```
1. Deploy QUAISToken
   - Mint 1B tokens to deployer
   - Set treasury address (placeholder initially)
   
2. Deploy ProtocolTreasury
   - Initialize with token address
   - Set multi-sig signers (3-of-5 initially)
   
3. Update QUAISToken
   - Set treasury address to deployed ProtocolTreasury
   
4. Deploy NodeRegistry
   - Initialize with token address
   
5. Deploy DisputeResolution
   - Initialize with token and NodeRegistry addresses
   
6. Deploy JobEscrow
   - Initialize with token, NodeRegistry, DisputeResolution, Treasury addresses
   
7. Grant Roles
   - ORACLE_ROLE → Verification oracle wallet (initially controlled by QueraIS)
   - MATCHING_ENGINE_ROLE → Matching engine wallet
   - DISPUTE_ROLE → DisputeResolution contract
   
8. Distribute initial token allocations
   - Ecosystem Fund → Timelock contract
   - Team → Vesting contract
   - IDO → Sale contract
   - Liquidity → Deployer (for DEX seeding)
   - Airdrop → Merkle distributor contract
```

### 8.3 Upgrade Strategy
- Contracts use **Transparent Proxy Pattern** (OpenZeppelin Upgrades Plugin)
- Proxy admin controlled by multi-sig (3-of-5)
- Major upgrades require 48-hour timelock + community announcement
- Emergency pause function on all contracts (PAUSER_ROLE)

---

## 9. Audit Plan

Before mainnet deployment, all contracts must pass:

| Audit | Provider (recommended) | Timeline |
|---|---|---|
| Internal review | Senior Solidity engineer | Month 6 |
| External audit 1 | Trail of Bits or OpenZeppelin | Month 7 |
| External audit 2 | Consensys Diligence or Halborn | Month 8 |
| Bug bounty launch | Immunefi | Month 8 |
| Final review | Any remaining findings | Month 9 |

**Bug bounty tiers:**
- Critical: Up to $100,000 QAIS
- High: Up to $25,000 QAIS
- Medium: Up to $5,000 QAIS
- Low: Up to $1,000 QAIS
