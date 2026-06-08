# QueraIS — Reputation System
## Trust Architecture & Anti-Gaming Design

---

## 1. Why Reputation Is the Core of the Network

The QueraIS network is only valuable if the compute you buy is genuine. Without a strong reputation system, nodes could:
- Return garbage results (save electricity, collect payment)
- Return cached/plagiarized results for different prompts
- Go offline mid-job
- Collude to manipulate the matching system

The reputation system is the immune system of the network. It must be:
1. **Hard to game** — Attackers should find it cheaper to be honest than dishonest
2. **Fast to update** — Bad actors should lose reputation quickly
3. **Slow to acquire** — Good reputation should take time to build (prevents Sybil attacks)
4. **Transparent** — Requesters should understand what a reputation score means

---

## 2. The Reputation Score

### 2.1 Score Structure
Every node has a **composite reputation score from 0.0 to 1.0**, computed from 5 dimensions:

```
ReputationScore = Σ (weight_i × dimension_score_i)

Dimensions:
  A: Accuracy Score      (weight: 0.40)
  B: Uptime Score        (weight: 0.25)
  C: Latency Score       (weight: 0.15)
  D: Longevity Score     (weight: 0.10)
  E: Stake Score         (weight: 0.10)
```

### 2.2 Dimension Definitions

#### A. Accuracy Score (0.40 weight)
Measures whether the node is doing real inference vs. returning junk:

```
AccuracyScore: Exponential Moving Average (EMA) of per-job outcomes

Initial value: 0.70 (set after completing the 30-job onboarding sequence)

Update formula on every verified outcome:
  AccuracyScore = AccuracyScore × (1 - α) + outcome × α
  where outcome = 1.0 (pass) or 0.0 (fail)

Smoothing factor α varies by event severity:
  Standard verified pass:     α = 0.005  (slow-moving, ~200-job half-life)
  Standard verified fail:     α = 0.005  (symmetric with pass)
  Oracle-flagged anomaly:     α = 0.05   (10x faster penalty, forces attention)
  Dispute loss:               α = 0.10   (fastest, significant event)
  Dispute win:                no change   (prevents gaming via frivolous challenges)

Optional requester feedback signal (lower weight, cannot trigger slashing alone):
  Positive feedback: AccuracyScore × (1 - 0.002) + 1.0 × 0.002
  Negative feedback: AccuracyScore × (1 - 0.004) + 0.0 × 0.004

Floor / Safety rules:
  - AccuracyScore never drops below 0.10 while stake is held
  - Minimum 30 verified jobs required before score can trigger automatic slashing
  - Rapid-decline detection: score drop > 0.20 in any 7-day window flags node for
    manual review, even if absolute score is still acceptable
  - Score snapshots committed on-chain every 24 hours
```

Note: The EMA approach resolves the contradiction between ratio-based and delta-based
scoring by using a single unified formula. A node that passes 200 jobs then fails once
sees a negligible drop (≈0.003), while a node that fails repeatedly sees compounding
declines that correctly reflect deteriorating reliability.

#### B. Uptime Score (0.25 weight)
Measures reliability — is the node available when it says it is?

```
UptimeScore = (time_available_and_responsive) / (time_registered_as_active)

Measured via:
  - Periodic ping (every 60 seconds from monitoring nodes)
  - Failed pings penalized: -0.005 per missed ping
  - Job acceptance rate: nodes that accept <80% of assigned jobs get penalties
  
Rolling window: Last 30 days
```

#### C. Latency Score (0.15 weight)
Measures speed — does the node deliver tokens within acceptable time?

```
LatencyScore = normalize(1 / average_time_to_first_token_ms)

Measured on:
  - Every job: time_to_first_token recorded
  - P95 latency used (not average, to penalize outlier slow responses)
  - Normalized against network median
  
Grade thresholds:
  <500ms  → 1.00
  <1000ms → 0.90
  <2000ms → 0.75
  <5000ms → 0.50
  >5000ms → 0.25
```

#### D. Longevity Score (0.10 weight)
Sybil resistance — rewards long-term participants:

```
LongevityScore = min(1.0, active_days / 365)

New nodes: 0.00 → grows to 1.00 over first year
Cannot be transferred (tied to wallet identity)
Decays if node is inactive for >30 days
```

#### E. Stake Score (0.10 weight)
Skin in the game — nodes with more at stake are more trusted:

```
StakeScore = min(1.0, staked_qais / PLATINUM_THRESHOLD)
            where PLATINUM_THRESHOLD = 10,000 $QAIS

Example:
  100 QAIS staked → StakeScore = 0.01
  1000 QAIS staked → StakeScore = 0.10
  10000 QAIS staked → StakeScore = 1.00
```

### 2.3 Example Composite Scores

| Node Type | Accuracy | Uptime | Latency | Longevity | Stake | **Total** |
|---|---|---|---|---|---|---|
| New honest node | 0.80 | 0.95 | 0.90 | 0.05 | 0.01 | 0.62 |
| 6-month veteran | 0.95 | 0.98 | 0.85 | 0.49 | 0.10 | 0.84 |
| 1-year platinum node | 0.99 | 0.999 | 0.95 | 1.00 | 1.00 | 0.98 |
| Cheating node caught once | 0.40 | 0.95 | 0.90 | 0.49 | 0.10 | 0.60 |

---

## 3. Score Update Mechanics

### 3.1 On-Chain vs. Off-Chain
- **Off-chain**: Scores computed continuously by the reputation oracle service
- **On-chain**: Score written to blockchain every 24 hours (or immediately after slashing events)
- Rationale: Computing scores every job would cost too much in gas

### 3.2 Update Triggers
1. **Job completion** → Off-chain score updated immediately
2. **Verification oracle result** → Off-chain + on-chain (if significant change)
3. **Dispute resolution** → On-chain update, immediate effect
4. **Manual epoch** → Daily on-chain state snapshot
5. **Stake change** → On-chain update immediately

### 3.3 Score Visibility
- Full score breakdown visible to all participants
- Historical score timeline queryable via API
- Requesters can set minimum score thresholds per job

---

## 4. Staking & Slashing

### 4.1 Staking Requirement
All nodes must stake $QAIS before accepting jobs:

```
Minimum viable stake: 100 $QAIS (Bronze tier)

Registration flow:
1. Node operator installs daemon
2. Daemon generates keypair, derives wallet address
3. Operator sends $QAIS stake to NodeRegistry contract
4. Node appears in marketplace after 1 confirmation
5. Node can begin accepting jobs
```

### 4.2 Stake Locking
- Stake is locked while node is active
- To withdraw: 7-day unbonding period
- During unbonding: node taken off the marketplace
- Protects against "slash-then-run" attacks

### 4.3 Slashing Conditions

| Violation | Slash Amount | Notes |
|---|---|---|
| Job abandonment (accepted, then dropped) | 1% of stake | Per occurrence |
| Verified result failure (oracle catch) | 5% of stake | First offense |
| Verified result failure (repeat) | 10% of stake | Doubles each time |
| Dispute loss (minor) | 10% of stake | Panel decision |
| Dispute loss (major fraud) | 50% of stake | Severe, rare |
| Sybil collusion detected | 100% of stake | Network-level ban |
| Downtime SLA breach (>5% in a month) | 2% of stake | Monthly review |

### 4.4 Slash Distribution

When a slash occurs, slashed tokens are distributed:

```
Slashed amount:
├─► 50% → Burned (deflationary, penalizes bad actors)
├─► 30% → Disputing party (if dispute raised by requester)
└─► 20% → Protocol Treasury
```

### 4.5 Stake Insurance (Future Feature)
- Nodes can purchase optional stake insurance via protocol
- Insurance pool funded by participating nodes' premium contributions
- Pays out if slashed due to technical failure (not fraud)

---

## 5. Dispute Resolution Flow

### 5.1 Who Can Raise a Dispute
1. **Requester** — "I got a garbage result for my job"
2. **Verification Oracle** — Automated detection of result mismatch
3. **Any $QAIS holder (stake-weighted)** — For systematic network abuse patterns

### 5.2 Dispute Lifecycle

```
Day 0: Dispute filed
  - Challenger submits: job_id, evidence, stake bond (50 $QAIS min)
  - Challenge stake locked (returned if won, burned if lost)
  
Day 0–1: Provider notification window
  - Provider notified via daemon
  - Provider can submit counter-evidence within 24 hours
  - Counter-evidence: execution logs, output hash, hardware attestation
  
Day 1: Arbitration begins

FAST TRACK (automated, for clear-cut cases):
  - If verification oracle re-runs confirms mismatch: auto-slash
  - Resolution in <6 hours
  - No human involvement
  
STANDARD TRACK (panel arbitration):
  - 5-person arbitration panel selected randomly from pool of:
    * High-reputation node operators (>0.95 score)
    * Long-term $QAIS stakers (>1 year holding)
  - Panel reviews evidence
  - 72-hour voting window
  - Majority vote determines outcome
  
ESCALATION TRACK (DAO vote):
  - For disputes >500 $QAIS in value
  - Full $QAIS holder governance vote
  - 5-day voting period
  - Requires quorum of 5% of staked $QAIS
  
Day 4 (typical): Resolution
  - Loser: slashed + reputation penalty
  - Winner: paid from slash proceeds
  - All arbitrators: small payment from protocol fees for their time
```

### 5.3 Arbitrator Incentives (Commit-Reveal + Outcome Verification)

**Why "vote with majority" is wrong:** Rewarding majority conformity creates herding bias—arbitrators are incentivized to guess what others will vote rather than form independent judgments. This is a well-documented flaw that degraded early decentralized arbitration systems.

**Correct design: Commit-Reveal + Delayed Outcome Scoring**

```
Phase 1 — Commit (48 hours):
  Each arbitrator submits: hash(vote || salt)
  No arbitrator sees other votes during this phase

Phase 2 — Reveal (24 hours):
  All arbitrators reveal vote + salt simultaneously
  Preliminary decision announced based on supermajority (4/5 or 3/5)

Phase 3 — Outcome Verification (up to 30 days, async):
  Where technically feasible, the oracle independently verifies the
  correct outcome (e.g., by re-running the disputed inference on
  hardware-attested nodes and comparing outputs)

Reward structure (per arbitrator):
  Voted correctly (matches verified outcome):       10 QAIS  (full reward)
  Voted with majority, outcome later confirmed:      8 QAIS
  Voted with majority, outcome later overturned:     2 QAIS  (partial, no penalty)
  Voted against majority, outcome later confirmed:  15 QAIS  (bonus for correct contrarianism)
  Voted against majority AND against outcome:        0 QAIS + 2 QAIS bond penalty
  Oracle unable to verify outcome:                   6 QAIS  (baseline, no bonus/penalty)
```

**Why this works:** Arbitrators earn more for being right than for being popular.
A well-reasoned dissenting vote that turns out to be correct earns more than
conforming to the crowd. This incentivizes independent thinking.

**Arbitrator Reputation:**
  - Long-term correct-vote rate tracked per arbitrator wallet
  - Arbitrators with >80% correct rate over 20+ cases earn “Verified Arbitrator” status
  - Verified Arbitrators: preferred routing, 1.5× reward, access to higher-value cases
  - Verified Arbitrators who fall below 60% correct rate lose status after 30-day review

---

## 6. Anti-Gaming Mechanisms

### 6.1 Sybil Attack Prevention
The biggest risk: an attacker runs many low-stake nodes to flood the network with fake nodes.

**Countermeasures:**
1. **Longevity Score**: New nodes cannot compete with established nodes on reputation
2. **Stake Requirement**: Each node requires capital lockup, making mass node creation expensive
3. **GPU Attestation** (Phase 2): Hardware-level proof that a real GPU is attached
   - Uses AMD ROCm or NVIDIA NVML attestation reports
   - Cryptographically signed by GPU driver
   - Prevents virtual/emulated GPU nodes
4. **Rate Limiting on Registration**: Max 5 new nodes per wallet per week
5. **IP Diversity Requirement**: Nodes sharing an IP must stake 3× minimum

### 6.2 Collusion Prevention
Risk: Provider A and Requester B collude to drain the escrow with fake jobs.

**Countermeasures:**
1. Verification oracle samples 5% of jobs — colluding pairs never know which jobs are sampled
2. Repeated wallet pairs (same requester + same provider) flagged for audit
3. Large-volume requester-provider pairs require oracle approval above threshold

### 6.3 Reputation Laundering
Risk: A bad node operator abandons their slashed node and creates a new one.

**Countermeasures:**
1. New nodes start with minimal reputation — they can only access low-value jobs initially
2. Wallet address blacklisting: slashed wallets flagged in registry
3. Hardware attestation ties reputation to physical hardware, not just wallet

### 6.4 Oracle Manipulation
Risk: Attacker who is also an oracle tries to falsely flag honest nodes.

**Countermeasures:**
1. Oracle results always require secondary confirmation from a second oracle node
2. Oracle nodes themselves have reputation scores
3. Disputed oracle results go to the arbitration panel
4. Oracle operators stake $QAIS and can be slashed for false flags

---

## 7. The Cold-Start Problem

**Problem**: New nodes have low reputation and can't access good jobs. Low earnings make them quit. Network never grows.

**Solution: Graduated Reputation Bootstrap**

```
New Node Path:
  
  Month 0: Onboarding Period
    - Node gets 30 "training job" assignments
    - Training jobs: Pre-verified prompts with known correct outputs
    - Performance on training jobs used to calculate initial reputation
    - Fast track to 0.70 reputation without waiting for organic work
    
  Month 1: Probationary Period
    - Node visible in marketplace but marked as "New"
    - Gets assigned 20% of bids it would normally win
    - Requester sees "New Node" badge, can opt out
    - Cheaper pricing encouraged (suggested 15% discount for new nodes)
    
  Month 3+: Full Participation
    - Longevity score begins to meaningfully contribute
    - Node competes equally (minus accumulated longevity)
```

---

## 8. Reputation as an NFT (Phase 3)

In Phase 3, reputation can be represented as a **non-transferable NFT** (Soulbound Token - SBT):

- Each node's reputation history minted as an SBT on-chain
- SBTs cannot be transferred — they're tied to the wallet that earned them
- Enables reputation portability across protocol upgrades
- Creates a provably authentic history that other protocols can reference
- Opens B2B use cases: other networks can require minimum QueraIS reputation for access

---

## 9. Reputation Score Summary Card

For each node, the network exposes a public "Node Card":

```
┌─────────────────────────────────────────────────────┐
│  NODE CARD: QmXxx7a9b...                           │
│  Wallet: 0x4f21...d98a                              │
├─────────────────────────────────────────────────────┤
│  REPUTATION: ████████████████░░░░  0.87 / 1.00     │
├─────────────────────────────────────────────────────┤
│  Accuracy:  ████████████████████  0.96              │
│  Uptime:    ███████████████████░  0.98              │
│  Latency:   ██████████████░░░░░░  0.72              │
│  Longevity: ████████░░░░░░░░░░░░  0.41 (5 months)  │
│  Stake:     ████░░░░░░░░░░░░░░░░  0.20 (2000 QAIS) │
├─────────────────────────────────────────────────────┤
│  Jobs completed:    14,238                          │
│  Disputes lost:     2                               │
│  Disputes won:      0                               │
│  Slash history:     1 minor (2024-11-10)            │
│  Active since:      2024-07-15                      │
│  Models offered:    Llama-3-70B, Mistral-7B, Qwen2  │
│  Region:            EU-West                         │
│  Current load:      45%                             │
└─────────────────────────────────────────────────────┘
```
