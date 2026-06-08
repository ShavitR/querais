# QueraIS — Decentralized AI Compute Marketplace
## Master Overview & Vision Document

---

## 1. The Concept

**QueraIS** (placeholder name — "Query + AI + IS") is a peer-to-peer marketplace for AI inference compute, modeled after the BitTorrent protocol but adapted for the economics of AI. Anyone who owns a capable GPU can rent it out to serve AI inference requests. Anyone who needs AI compute can access it instantly, at a market-determined price, without relying on any single cloud provider.

The network is governed by a native crypto token (`$QAIS`) which is the exclusive payment medium for all compute transactions. The platform operator earns a protocol fee on every transaction — sitting at the infrastructure layer of every job without needing to own any hardware.

---

## 2. The Problem Being Solved

| Problem | Today's Reality | QueraIS Solution |
|---|---|---|
| AI compute monopoly | AWS, GCP, Azure control 65%+ of cloud GPU | Anyone's GPU becomes a node |
| High inference costs | OpenAI API charges premium margins | Competition between nodes drives prices down |
| Idle hardware | Millions of GPUs sit at <20% utilization | Monetize idle capacity |
| Censorship/dependence | Single provider can cut off access | Decentralized — no single point of failure |
| No incentive to contribute | Open-source models have no reward mechanism | Nodes earn $QAIS per verified job |

---

## 3. Core Participants

### 3.1 Requesters (API Consumers)
- Developers, businesses, or individuals who submit inference jobs via the QueraIS API
- They pay in `$QAIS` tokens (or fiat that is auto-converted at point of purchase)
- They care about: **price, latency, model availability, reliability**

### 3.2 Providers (Node Operators)
- Individuals or businesses who install the QueraIS node daemon on their machine
- They offer GPU resources (VRAM, RAM, throughput) and list which models they can serve
- They earn `$QAIS` per successfully verified job
- They care about: **earnings, hardware utilization, ease of setup**

### 3.3 Protocol (QueraIS Inc. / DAO)
- The smart contract layer that routes jobs, escrows payment, verifies results, and extracts a protocol fee
- Fee flows to a treasury controlled by the protocol team (transitioning to DAO governance over time)

---

## 4. The Job Lifecycle (High Level)

```
Requester submits job
        │
        ▼
Job Marketplace (on-chain or hybrid)
        │
        ├─► Provider A sees job, submits bid
        ├─► Provider B sees job, submits bid
        └─► Provider C sees job, submits bid
                │
                ▼
        Matching Engine selects winner
        (price + reputation + latency)
                │
                ▼
        Escrow: $QAIS locked from Requester
                │
                ▼
        Provider executes inference
                │
                ▼
        Result delivered to Requester
                │
                ▼
        Verification Layer confirms result validity
                │
        ┌───────┴────────┐
        │                │
   PASS                 FAIL
        │                │
        ▼                ▼
  Escrow releases    Slash provider stake
  - 95% → Provider   Re-assign job to next bidder
  - 5%  → Protocol   Refund requester
```

---

## 5. Why This Works Economically

### For Node Operators
A consumer RTX 4090 (24GB VRAM) can serve:
- ~30 requests/minute for a 7B parameter model
- ~8 requests/minute for a 70B parameter model
- At market rates of $0.001–$0.005 per 1K tokens, this generates $50–200/month per GPU
- Power consumption: ~350W × 24h × 30 days = ~252 kWh/month = ~$25–35 at average US electricity rates
- **Net profit: $25–175/month per GPU running at partial utilization**

### For Requesters
- Competition between nodes means prices reflect actual compute cost, not cloud margins
- Access to otherwise unavailable models (fine-tuned, quantized, private)
- No KYC, no account required — pay with wallet

### For Protocol
- Every transaction generates a 5% protocol fee
- With 10,000 active nodes, each capable of 1,000 jobs/day at $0.002/job, at **realistic 30% average utilization**:
  - Active jobs/day = 10,000 x 1,000 x 0.30 = **3,000,000 jobs/day**
  - GMV = $6,000/day = **$2.2M/year**
  - Protocol fee at 5% = **$110,000/year**
- At scale (100K nodes, 30% utilization): $22M GMV -> **$1.1M/year** in protocol fees
- At scale (100K nodes, 70% peak utilization): $51M GMV -> **$2.55M/year** in protocol fees
- Note: The 30% baseline is conservative — Uber averages ~65% utilization at maturity. Even the conservative case is a sustainable protocol business.

---

## 6. Competitive Landscape

| Project | What They Do | QueraIS Difference |
|---|---|---|
| Akash Network | Decentralized cloud compute (general) | AI-specific, inference-optimized |
| Bittensor (TAO) | Decentralized AI training/inference | Simpler UX, standard API, no need to understand subnet model |
| io.net | GPU cluster for AI training | Focused on inference, lower barrier to entry |
| Golem Network | Decentralized compute | Much simpler — plug your GPU in and earn |
| Render Network | GPU rendering + AI | No training — pure inference marketplace |

**QueraIS differentiator**: Drop-in replacement for OpenAI API. Standard REST API that existing apps can point at with no code changes. Nodes can serve any open-source model. Reputation system prevents quality degradation.

---

## 7. Document Map

This is the master overview. The following companion documents provide full technical and economic depth:

| Document | Description |
|---|---|
| `querais_token_economics.md` | $QAIS token design, supply, distribution, utility |
| `querais_protocol_architecture.md` | Technical architecture: job routing, matching, verification, P2P layer |
| `querais_node_design.md` | Node operator experience: setup, hardware requirements, earnings model |
| `querais_reputation_system.md` | Reputation scoring, staking, slashing, dispute resolution |
| `querais_smart_contracts.md` | Smart contract design: escrow, job registry, token mechanics |
| `querais_go_to_market.md` | Launch strategy, growth loops, developer acquisition |

---

## 8. Core Design Principles

1. **API Compatibility First** — The API must be a drop-in replacement for OpenAI's API. Developers should be able to change one line of code.
2. **Node Simplicity** — A non-technical person should be able to install and run a node in under 10 minutes.
3. **Economic Sustainability** — Nodes must earn more than they spend. Always. If this breaks, the network dies.
4. **Trust Without Trust** — The system must work even if providers are adversarial. Verification must be cryptographically sound.
5. **Progressive Decentralization** — Start with a hybrid (centralized matching, decentralized payment), evolve to fully on-chain.
6. **Regulatory Positioning** — The protocol fee model and token utility must be designed to minimize securities law exposure.
