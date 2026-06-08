# QueraIS — Token Economics
## $QAIS Token Design Document

---

## 1. Token Overview

| Property | Value |
|---|---|
| **Token Name** | QueraIS Token |
| **Ticker** | $QAIS |
| **Standard** | ERC-20 (deployed on Arbitrum) |
| **Total Supply** | 1,000,000,000 (1 billion) — fixed, no mint function |
| **Decimals** | 18 |
| **Primary Chain** | Arbitrum One (L2 on Ethereum) |
| **Bridge** | Official Arbitrum bridge + 3rd party bridges |

---

## 2. Token Utility (Why $QAIS Has Value)

A token must have **real utility** to maintain long-term value. $QAIS has four distinct utility pillars:

### 2.1 Payment Medium (Primary Utility)
- All inference jobs are priced and settled in $QAIS
- Requesters must hold $QAIS to submit jobs (or use auto-convert from fiat/ETH at gateway)
- Creates constant buy pressure proportional to network usage

### 2.2 Node Staking (Security Utility)
- Nodes must stake $QAIS to participate in the network
- Stake acts as collateral: bad actors lose their stake
- Creates locked supply — reduces circulating supply

### 2.3 Governance (Voting Utility)
- $QAIS holders vote on protocol parameters:
  - Protocol fee rate (e.g., change from 5% to 4%)
  - Minimum stake requirements
  - New feature proposals
  - Treasury allocation
- Voting weight = staked $QAIS (not just held — must be committed)

### 2.4 Reputation Boosting (Optional Utility)
- Nodes can voluntarily burn $QAIS to boost their reputation score visibility
- Acts as a quality signal: "I believe in my work enough to burn tokens on it"
- Creates deflationary pressure

---

## 3. Token Distribution

**Total: 1,000,000,000 $QAIS**

```
┌─────────────────────────────────────────────────────────────────┐
│                    TOKEN DISTRIBUTION                           │
├─────────────────┬──────────────┬──────────────────────────────┤
│ Category        │  % of Supply │  Amount                      │
├─────────────────┼──────────────┼──────────────────────────────┤
│ Ecosystem Fund  │    30%       │  300,000,000                 │
│ (node incentives│              │                              │
│ + grants)       │              │                              │
├─────────────────┼──────────────┼──────────────────────────────┤
│ Community Sale  │    20%       │  200,000,000                 │
│ (IDO/public)    │              │                              │
├─────────────────┼──────────────┼──────────────────────────────┤
│ Protocol        │    15%       │  150,000,000                 │
│ Treasury        │              │                              │
├─────────────────┼──────────────┼──────────────────────────────┤
│ Team &          │    15%       │  150,000,000                 │
│ Founders        │              │                              │
├─────────────────┼──────────────┼──────────────────────────────┤
│ Seed Round      │    5%        │   50,000,000                 │
│ (Private)       │              │                              │
├─────────────────┼──────────────┼──────────────────────────────┤
│ Series A        │    5%        │   50,000,000                 │
│ (Strategic)     │              │                              │
├─────────────────┼──────────────┼──────────────────────────────┤
│ Liquidity       │    5%        │   50,000,000                 │
│ (DEX pools)     │              │                              │
├─────────────────┼──────────────┼──────────────────────────────┤
│ Advisors        │    3%        │   30,000,000                 │
├─────────────────┼──────────────┼──────────────────────────────┤
│ Airdrop /       │    2%        │   20,000,000                 │
│ Early users     │              │                              │
└─────────────────┴──────────────┴──────────────────────────────┘
```

---

## 4. Vesting Schedules

### 4.1 Team & Founders (150M)
- 12-month cliff from Token Generation Event (TGE)
- 36-month linear vesting after cliff
- Total: 48 months to fully vest
- Rationale: Prevent founders from dumping. Aligned with 4-year build horizon.

### 4.2 Seed Round Investors (50M)
- 6-month cliff from TGE
- 24-month linear vesting after cliff
- Total: 30 months to fully vest
- Valuation: $0.005/token ($5M fully diluted at seed)

### 4.3 Series A Investors (50M)
- 3-month cliff from TGE
- 18-month linear vesting after cliff
- Total: 21 months to fully vest
- Valuation: $0.01/token ($10M fully diluted at Series A)

### 4.4 Advisors (30M)
- 6-month cliff from TGE
- 18-month linear vesting after cliff

### 4.5 Ecosystem Fund (300M)
- No cliff — distributed as earned through:
  - Node operator rewards (see Section 6)
  - Developer grants
  - Partnership incentives
  - Hackathon prizes
- Released by governance vote from a multi-sig treasury

### 4.6 Community Sale / IDO (200M)
- 25% unlocked at TGE
- Remaining 75% linear vest over 12 months
- Prevents immediate sell pressure while rewarding early supporters

### 4.7 Liquidity (50M)
- 100% unlocked at TGE — required to bootstrap DEX pools
- Locked in LP contracts for minimum 24 months

### 4.8 Airdrop (20M)
- 100% unlocked at TGE for early network participants
- Recipients: Beta node operators, early API users, waitlist

---

## 5. Token Launch Strategy

### 5.1 Pre-Launch Phases

**Phase 0 — Private/Seed Round** (6 months before TGE)
- Raise: $2–5M at $0.005/token valuation
- Investors: Infrastructure VCs, crypto funds with AI thesis
- Allocation: 10% of supply (100M tokens)
- Use of funds: Engineering, legal structure, initial node incentive program

**Phase 1 — Strategic/Series A** (3 months before TGE)
- Raise: $5–15M at $0.01/token valuation
- Investors: Tier-1 crypto VCs, strategic partners (GPU providers)
- Goal: Network launch funding, marketing, exchange listing fees

**Phase 2 — IDO (Initial DEX Offering)** (TGE)
- Platform: Camelot DEX (Arbitrum native) + 1 additional launchpad
- Price: $0.015/token
- Hard cap: $3M
- Allocation: 20% of supply sold over 2 tranches
- Simultaneous Uniswap V3 pool launch for price discovery

### 5.2 TGE Unlock Summary

| Category | TGE Unlock |
|---|---|
| Team | 0% |
| Seed Round Investors | 0% |
| Series A Investors | 0% |
| Ecosystem Fund | 2% (6M) — initial node incentives |
| Community Sale | 25% (50M) |
| Liquidity | 100% (50M) |
| Airdrop | 100% (20M) |
| **Total TGE Float** | **~126M tokens (~12.6% of supply)** |

Low float at TGE = healthy price discovery, prevents immediate dumps.

---

## 6. Node Operator Incentives (Ecosystem Fund)

### 6.1 Bootstrapping Rewards
During Phase 1 (network launch, months 0–12):
- Nodes earn **bonus $QAIS** on top of job payments
- Bonus = job payment × bonus_multiplier
- Bonus multiplier starts at 100% and decays linearly to 0% over 12 months
- Purpose: Make running a node profitable even before sufficient organic demand exists

### 6.2 Uptime Rewards
- Nodes that maintain >99% uptime per month earn a monthly bonus
- Bonus pool: 1,000,000 $QAIS/month split proportionally to qualifying nodes
- Incentivizes reliability, not just job completion

### 6.3 First Model Bonus
- First 100 nodes to offer each new supported model earn a 10,000 $QAIS bonus
- Incentivizes rapid model coverage

### 6.4 Referral Program (Node)
- Node operator who refers another node earns 2% of referred node's earnings for 6 months
- Drives organic network growth through community

---

## 7. Protocol Fee Structure

### 7.1 Fee Rate
- **Standard fee: 5% of every job payment**
- Fee is extracted at the smart contract level — uncircumventable
- Fee is taken in $QAIS

### 7.2 Fee Destinations

```
Every 100 $QAIS in protocol fees:
├─► 60 $QAIS → Protocol Treasury (operational costs, R&D)
├─► 20 $QAIS → Burned (permanently removed from supply)
└─► 20 $QAIS → Staking Rewards Pool (distributed to $QAIS stakers)
```

### 7.3 The Burn Mechanism
- 20% of protocol fees are burned at the contract level
- With increasing network volume, burn rate increases
- This creates long-term deflationary pressure on $QAIS supply

**Burn Projection (conservative):**

> Token amounts calculated at an **assumed illustrative price of $0.10/QAIS**. Actual burn in token terms will vary with market price — at higher prices, fewer tokens are burned per dollar of GMV.

| Year | Network GMV | Fees (5%) | $ Burned (20%) | Tokens Burned (@$0.10) | Cumulative Tokens Burned |
|---|---|---|---|---|---|
| Year 1 | $5M | $250K | $50K | ~500K tokens | ~500K |
| Year 2 | $30M | $1.5M | $300K | ~3M tokens | ~3.5M |
| Year 3 | $100M | $5M | $1M | ~10M tokens | ~13.5M |
| Year 5 | $500M | $25M | $5M | ~50M tokens | ~63.5M |

At Year 5, ~6.35% of the original 1B supply has been burned at the $0.10 assumed price. If the token trades at $1.00, the same GMV activity burns 10× fewer tokens — but each burn is 10× more economically significant.

---

## 8. Staking Model for Node Operators

### 8.1 Minimum Stake Requirements

| Node Tier | Min Stake | Max Job Value | Reputation Access |
|---|---|---|---|
| **Bronze** | 100 $QAIS | $0.50/job | All jobs |
| **Silver** | 500 $QAIS | $5.00/job | Premium jobs |
| **Gold** | 2,500 $QAIS | $50.00/job | Enterprise jobs |
| **Platinum** | 10,000 $QAIS | Unlimited | Priority routing |

- Higher stake = access to higher-value jobs
- Higher stake = more visible in node discovery
- Stake is slashable on bad behavior

### 8.2 Stake as Security Deposit
- Minimum stake: 100 $QAIS (~$1.50 at $0.015 launch price)
- Maximum single-slash: 20% of total stake per incident
- Repeat offenders: slash doubles each time until removed from network

### 8.3 Stake Unbonding
- To unstake, nodes enter a 7-day unbonding period
- During unbonding, node cannot accept new jobs
- Protects against: complete-a-bad-job-then-unstake attacks

---

## 9. Token Value Accrual Model

The $QAIS token accrues value through three mechanisms:

### 9.1 Demand-Driven Appreciation
- As network usage grows, requesters need more $QAIS to pay for jobs
- Fixed supply + increasing demand = price appreciation
- Price appreciation makes staking more attractive → more tokens locked → less circulating supply

### 9.2 Deflationary Burn
- Active burn mechanism reduces supply over time
- As price rises, token burn rate (in dollar terms) also rises if usage remains constant

### 9.3 Staking Yield
- 20% of protocol fees distributed to $QAIS stakers
- Creates a "dividend" that attracts holders who want passive income
- Long-term holders stake → reduce sell pressure

### 9.4 Token Value Model

```
QAIS Value Drivers:
  + Growing network GMV (more compute sold)
  + Increasing node count (more stake locked)
  + Deflationary burns
  + Staking yield attractiveness
  
QAIS Value Risks:
  - Token sell pressure from node operators (they earn $QAIS, might sell immediately)
  - Competition from other networks
  - Regulatory pressure
  - Technical failure
  
Mitigation for operator sell pressure:
  - Require stake to participate (must hold some QAIS)
  - Create natural demand loops: operators are also users

Concrete Mechanism — Node Loyalty Multiplier:
  Nodes that hold their earned $QAIS (unmoved from earning wallet) receive
  a multiplier applied to all future job routing priority:

    Holding period    Earnings Multiplier   Routing Boost
    0–29 days         1.00×                 None
    30–59 days        1.05×                 +2% bid score
    60–89 days        1.15×                 +5% bid score
    90+ days          1.25×                 +8% bid score

  The multiplier is applied in the matching engine's scoring function.
  A node with a 1.25× multiplier effectively wins jobs it would otherwise
  lose on price alone — creating a real financial incentive to hold.

Concrete Mechanism — Compound Staking Bonus:
  Nodes that restake earnings (add earned $QAIS to their stake balance)
  get a stake tier credit: contributing to faster tier promotion.
  Example: A Silver node that restakes 300 earned QAIS gets promoted
  to Gold tier 30% faster than a node that stakes the minimum.
```

---

## 10. Regulatory Positioning

> **Disclaimer: This is a design intent, not legal advice. Qualified legal counsel is essential before token launch.**

### 10.1 Utility Token Framework
$QAIS is designed as a **utility token**, not a security:
- It is required to use the service (intrinsic utility)
- It is not marketed as an investment vehicle
- Returns come from network activity, not from QueraIS Inc.'s efforts (decentralized)
- No dividends paid to token holders by the company (staking rewards come from the protocol)

### 10.2 Howey Test Analysis
For the SEC Howey Test (investment of money + common enterprise + expectation of profits + from efforts of others):
- "From efforts of others": We mitigate this by ensuring the protocol is decentralized and that token value comes from the network, not from QueraIS Inc.
- Marketing must never promise returns or call $QAIS an investment

### 10.3 Jurisdictional Considerations
- Token launch entity should be a Cayman Islands Foundation or Swiss Association
- US persons restricted from IDO participation (geofencing)
- EU MiCA compliance pathway should be mapped pre-launch
- Singapore (MAS) and UAE (VARA) are favorable jurisdictions for operations

### 10.4 DAO Transition
- QueraIS Inc. will progressively transfer governance to the $QAIS DAO
- Target: 70%+ of protocol decisions governed by DAO within 24 months of launch
- DAO structure reduces "efforts of others" risk under Howey
