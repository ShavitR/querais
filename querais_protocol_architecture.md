# QueraIS — Protocol Architecture
## Technical Architecture Deep Dive

---

## 1. System Overview

QueraIS is built in layers. Each layer can be upgraded independently. The early design is **hybrid** — some components are centralized for performance, with a clear migration path to full decentralization.

```
┌─────────────────────────────────────────────────────────────────┐
│                        REQUESTER LAYER                          │
│  Web App  │  REST API Client  │  SDK (Python, JS, Go, Rust)     │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTPS / WebSocket
┌─────────────────────▼───────────────────────────────────────────┐
│                      API GATEWAY LAYER                          │
│  Rate limiting │ Auth (wallet sig / API key) │ Job normalization│
│  OpenAI-compatible endpoint translation                         │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                   JOB MARKETPLACE LAYER                         │
│  Job Registry │ Bid Aggregator │ Matching Engine                │
│  Escrow Interface │ SLA definitions │ Timeout management        │
└──────────┬──────────────────────┬──────────────────────────────┘
           │                      │
    ┌──────▼──────┐        ┌──────▼──────┐
    │  On-Chain   │        │  Off-chain  │
    │  Escrow     │        │  Matching   │
    │  (EVM SC)   │        │  Engine     │
    └──────┬──────┘        └──────┬──────┘
           │                      │
┌──────────▼──────────────────────▼──────────────────────────────┐
│                     P2P NETWORK LAYER                           │
│  libp2p / custom DHT │ Node discovery │ Job announcement        │
│  Bid propagation │ Direct node-to-node channels                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                     NODE EXECUTION LAYER                        │
│  Model loader (GGUF/HF) │ Inference engine (llama.cpp/vLLM)    │
│  Result serialization │ Streaming support │ GPU management      │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                   VERIFICATION LAYER                            │
│  Challenge-response │ Redundant execution │ Merkle proof        │
│  Reputation oracle │ Dispute contract                           │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                   SETTLEMENT LAYER                              │
│  Smart contract payment release │ Fee split │ Stake management  │
│  Slash execution │ Reputation score update                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. API Gateway Layer

### 2.1 OpenAI Compatibility
The gateway exposes an OpenAI-compatible REST API. A developer changes exactly one environment variable:

```
# Before
OPENAI_API_BASE = "https://api.openai.com/v1"

# After (QueraIS)
OPENAI_API_BASE = "https://api.querais.io/v1"
```

Supported endpoints (Phase 1):
- `POST /v1/chat/completions` — Standard chat inference
- `POST /v1/completions` — Text completion
- `POST /v1/embeddings` — Embedding generation
- `GET /v1/models` — List available models on the network

Extension endpoints (QueraIS-specific):
- `POST /v1/jobs` — Submit a job with full parameter control
- `GET /v1/jobs/{id}` — Poll job status
- `GET /v1/nodes` — Browse active nodes, their offers, reputation
- `GET /v1/node/{id}` — Detailed node profile

### 2.2 Authentication
Two modes:
1. **API Key Mode** (developer-friendly): User registers a wallet, gets an API key tied to their wallet. Keys can be rotated.
2. **Wallet Signature Mode** (trustless): Each request is signed with the requester's private key. No account needed.

### 2.3 Job Normalization
The gateway translates incoming requests into a canonical **Job Spec**:

```json
{
  "job_id": "uuid-v4",
  "created_at": 1717000000,
  "model": "meta-llama/Llama-3-70B-Instruct",
  "quantization": "Q4_K_M",
  "messages": [...],
  "max_tokens": 2048,
  "temperature": 0.7,
  "stream": true,
  "requester_wallet": "0x...",
  "max_price_per_token": 0.000005,
  "min_reputation": 0.85,
  "max_latency_ms": 5000,
  "deadline": 1717000030,
  "escrow_tx_hash": "0x..."
}
```

---

## 3. Job Marketplace Layer

### 3.1 Two-Phase Matching (Speed vs. Decentralization)

**Phase 1 (Launch):** Centralized matching engine with on-chain settlement
- Fast (<200ms to matched provider)
- Centralized matching server maintained by QueraIS
- All payment and reputation updates happen on-chain
- Trust model: Users trust QueraIS for routing, but not for money

**Phase 2 (Maturity):** Hybrid on-chain auction
- Job specs posted on-chain (L2 for cost efficiency)
- Providers submit sealed bids within a short window (2–5 seconds)
- Matching contract selects winner based on scoring function
- Fully permissionless — no QueraIS server involved

### 3.2 Provider Scoring Function

When multiple providers bid on a job, the winner is selected by a weighted score:

```
Score = w1 × PriceScore + w2 × ReputationScore + w3 × LatencyScore + w4 × CapabilityScore

Where:
  PriceScore      = 1 - (bid_price / max_acceptable_price)
  ReputationScore = provider_reputation / 1.0  (normalized 0-1)
  LatencyScore    = 1 - (estimated_latency / max_acceptable_latency)
  CapabilityScore = hardware_tier_factor (0.5 for consumer GPU, 1.0 for datacenter)

Default weights (tunable per job by requester):
  w1 = 0.35  (price)
  w2 = 0.40  (reputation)
  w3 = 0.20  (latency)
  w4 = 0.05  (capability)
```

Requesters can override weights:
- "Cheapest" mode: w1=0.8, w2=0.15, w3=0.05, w4=0
- "Fastest" mode: w1=0.1, w2=0.2, w3=0.7, w4=0
- "Most trusted" mode: w1=0.1, w2=0.8, w3=0.1, w4=0

### 3.3 Escrow Flow — Session Deposit Model

**Why per-job on-chain transactions are unacceptable:**
A naive design requiring a blockchain transaction per API call would cost a developer $10/day in gas at 1,000 calls/day (even on Arbitrum at ~$0.01/tx). This makes the platform unusable for production workloads and eliminates any price advantage over OpenAI.

**Solution: Pre-funded Session Deposits (Permit2 pattern)**

```
SETUP — One-time per session (or when credit balance is low):
  1. Requester calls CreditAccount.deposit(amount)
     → Locks $QAIS in their on-chain credit account (1 transaction)
  2. Requester signs an EIP-712 spending authorization off-chain
     → Grants QueraIS gateway a capped allowance (e.g., max 100 QAIS/day)
     → No on-chain transaction needed for this step

PER JOB — Fully off-chain:
  3. Gateway verifies credit balance off-chain before matching
  4. Matching, assignment, and execution all happen without on-chain interaction
  5. Gateway maintains a signed off-chain ledger of debits per session

SETTLEMENT — Batched on-chain:
  6. Gateway calls CreditAccount.batchSettle([jobId, cost, provider, fee], ...)
     → Batches 50-500 jobs into a single transaction
     → Amortizes gas to ~$0.00002-$0.0002 per job
     → Atomically: debits requester, credits provider 95%, sends 5% to treasury
     → Settlement runs every 5 minutes or when batch size threshold is reached

SAFETY PROPERTIES:
  - Requester funds are locked — gateway cannot withdraw them arbitrarily
  - Gateway can only settle at agreed prices signed into job specs
  - Requester can set a per-session or per-day spending cap
  - If gateway is compromised: worst case is settlement at agreed prices for
    already-completed jobs — no theft of deposited principal possible
  - Requester can revoke spending authorization at any time (1 on-chain tx)
  - Unclaimed deposits withdrawable after 48-hour notice period
```

**Developer UX:** A developer tops up their credit account once a week/month. All API calls work exactly like a standard HTTP request — no wallet interaction per call. This matches the UX of every existing API billing system.

---

## 4. P2P Network Layer

### 4.1 Node Discovery
Built on **libp2p** with a DHT (similar to Kademlia):
- Nodes announce themselves with their capability fingerprint
- Capability fingerprint includes: GPU model, VRAM, available models, supported quantizations, current load, ping latency from major regions
- Bootstrap nodes maintained by QueraIS until network is large enough for pure DHT

### 4.2 Node Capability Fingerprint

```json
{
  "node_id": "QmXxx...",
  "wallet": "0x...",
  "hardware": {
    "gpu": "NVIDIA RTX 4090",
    "vram_gb": 24,
    "ram_gb": 64,
    "internet_mbps": 500
  },
  "models": [
    {
      "model_id": "meta-llama/Llama-3-70B-Instruct",
      "quantization": "Q4_K_M",
      "tokens_per_second": 28,
      "ready": true
    },
    {
      "model_id": "mistralai/Mistral-7B-Instruct-v0.2",
      "quantization": "Q8_0",
      "tokens_per_second": 120,
      "ready": true
    }
  ],
  "pricing": {
    "base_price_per_1k_tokens": 0.0003,
    "min_job_value": 0.001
  },
  "reputation_score": 0.97,
  "stake_amount": 500,
  "region": "us-east",
  "uptime_30d": 0.994,
  "last_seen": 1717000000,
  "signature": "0x..."
}
```

### 4.3 Job Communication Protocol
Once a node is selected:
1. Gateway sends **Job Assignment** to node via direct WebSocket or HTTP POST to node's public endpoint
2. Node streams tokens back directly to the gateway using Server-Sent Events (SSE) or WebSocket
3. Gateway forwards stream to the requester (or buffers for non-streaming mode)
4. Upon completion, node submits a **Job Completion Report** containing result hash + token count

---

## 5. Node Execution Layer

### 5.1 Inference Engine Support
The node daemon must support multiple backends to maximize hardware compatibility:

| Backend | Best For | Models |
|---|---|---|
| **llama.cpp** | Consumer CPUs/GPUs, quantized models | GGUF format, 3B–70B |
| **vLLM** | High-throughput datacenter GPUs | HuggingFace format, batching |
| **Ollama** (simplified) | Easy setup, consumer devices | GGUF via Modelfile |
| **ExLlamaV2** | NVIDIA consumer GPUs, EXL2 quants | High quality quantization |
| **TensorRT-LLM** | NVIDIA datacenter (A100, H100) | Maximum throughput |

### 5.2 Model Management
- Models are stored locally; node operator downloads them once
- Model registry (centralized index, decentralized storage via IPFS/Arweave) tracks:
  - Model ID (HuggingFace canonical name)
  - Available quantizations (GGUF Q4_K_M, Q8_0, FP16, etc.)
  - Model hash for integrity verification
  - Minimum hardware requirement
- Node declares which models it has ready

### 5.3 Sandboxing & Security
- Each inference runs in an isolated process with limited system access
- No network access from within the inference process (prevents model exfiltration)
- Rate limiting on VRAM usage per job to prevent OOM crashes
- Watchdog process kills hung inferences after timeout

---

## 6. Verification Layer

This is the hardest problem. How do you verify that an AI inference was done correctly on a decentralized network?

### 6.1 The Verification Problem
Unlike traditional compute (deterministic), LLM inference is:
- **Non-deterministic** at temperature > 0
- **Computationally expensive** to re-run for verification
- **Subjective** in quality — what is "correct"?

### 6.2 Verification Strategies (Multi-layered)

> **Important architectural note:** It is a common misconception that setting `temperature=0` makes LLM output deterministic and therefore hashable across nodes. This is **false**. Temperature=0 only removes sampling randomness. Output still diverges across different GPU hardware (floating-point precision differences between an A100 and RTX 4090), different backends (llama.cpp vs. vLLM), different CUDA versions, and different batch sizes. Two honest nodes running identical models at temp=0 will produce different token hashes. Any architecture relying on cross-node hash matching will produce constant false-positive slashing and destroy honest provider reputation. The QueraIS verification design explicitly avoids this assumption.

#### Layer A: Output Commitment + Statistical Fraud Detection
- **Pre-commitment scheme:** Before a job is assigned, the node publishes a signed commitment: `hash(model_id || model_weights_hash || backend_version || node_id)`. This proves *which model* was run without proving *what the output was*.
- **Statistical anomaly detection (5% sample):** The oracle re-runs sampled prompts on 2–3 oracle-controlled nodes using the same backend type. Rather than hash-matching, it computes **embedding cosine similarity** between outputs using a lightweight embedding model:
  * Similarity ≥ 0.85 → output consistent with honest inference (no action)
  * Similarity 0.70–0.85 → soft flag, contributes to reputation signal
  * Similarity < 0.70 → anomaly flag, triggers dispute review
- **Pattern-based detection:** Nodes that return statistically impossible outputs (e.g., identical response to every prompt, always truncated at exactly N tokens, same embedding fingerprint across diverse prompts) are flagged as systematic cheaters regardless of any single output
- Anomaly flags → dispute raised; not automatic slash (human or panel review required)
- **The primary fraud deterrent is economic, not cryptographic:** A node staking 2,500 $QAIS risks losing it to earn cents per job. The math overwhelmingly favors honesty.

#### Layer B: Deterministic Format & Length Validation
- Cheap, instant sanity check on every job (not sampled): Did the node return a non-null response? Correct format? Token count within the requested range? No repeated-token loops?
- Nodes that return empty, malformed, or clearly looping outputs receive an immediate reputation penalty (no dispute required — this is objective)
- Accounts for >90% of detectable fraud at near-zero cost

#### Layer C: Staking + Reputation Skin in the Game
- Nodes must stake `$QAIS` tokens to participate
- Bad results detected by A or B lead to stake slashing
- This economic deterrent is the primary security mechanism — it works even if the oracle cannot prove fraud cryptographically

#### Layer D: Requester Feedback
- After receiving a result, requesters can optionally submit a satisfaction signal
- Weighted by requester's own reputation and stake (prevents fake feedback)
- Aggregated into long-term reputation score as a soft signal
- Cannot trigger slashing alone — only influences reputation scoring

### 6.3 Verification Oracle Architecture

```
Verification Oracle (runs as autonomous service):

  Every N seconds:
    1. Process all completed jobs through Layer B (format/length) — 100% coverage
    2. Sample 5% of completed jobs for Layer A (semantic similarity):
       a. Re-run prompt on 2 oracle-controlled nodes (same backend type as provider)
       b. Compute embedding similarity between oracle outputs and provider output
       c. If similarity < 0.70 → raise on-chain dispute flag
       d. If similarity 0.70-0.85 → log soft anomaly, update reputation signal
       e. If similarity ≥ 0.85 → positive signal, minor reputation boost
    3. Run pattern detection on node output history (rolling 7-day window)
    4. Commit reputation score updates on-chain (batched daily or on significant change)
```

The oracle is initially run by QueraIS (2-of-3 multisig oracle nodes required to flag a dispute). Migration path: integrate Chainlink Functions or UMA Optimistic Oracle for decentralized oracle verification in Phase 2.

---

## 7. Settlement Layer

### 7.1 Smart Contract Architecture
Deployed on an EVM-compatible L2 (Arbitrum or Base recommended for low fees):

**Contracts (5 core):**
1. `JobEscrow.sol` — Locks requester credit deposits, settles jobs, serves as the on-chain job registry
2. `NodeRegistry.sol` — Node registration, stake management, reputation scores
3. `QUAISToken.sol` — ERC-20 token with fee mechanics
4. `DisputeResolution.sol` — Challenge-response dispute flow
5. `ProtocolTreasury.sol` — Accumulates protocol fees, governance-controlled

Note: A separate `JobRegistry.sol` is not needed. `JobEscrow.sol` already maintains the authoritative `mapping(bytes32 => Job)` record of all jobs and statuses. Separating them would create sync complexity without benefit.

### 7.2 Settlement Flow (Happy Path)
```
1. Job completed successfully
2. Verification oracle (or timeout with no challenge) marks job VERIFIED
3. JobEscrow.release(job_id) called by anyone (permissionless)
4. Contract calculates:
   - actual_cost = verified_token_count × provider_bid_price
   - provider_pay = actual_cost × (1 - PROTOCOL_FEE_RATE)  // 95%
   - protocol_fee = actual_cost × PROTOCOL_FEE_RATE          // 5%
   - refund       = locked_amount - actual_cost
5. Token transfers executed atomically
6. Reputation oracle notified for score update
```

### 7.3 Settlement Flow (Dispute Path)
```
1. Verification oracle detects mismatch OR requester raises dispute
2. DisputeResolution.challenge(job_id, evidence) called
3. Provider has 24-hour window to submit counter-evidence
4. If no counter: automatic slash (20% of staked amount)
5. If counter submitted: DAO vote or designated arbitrator panel decides
6. Loser of dispute: slash + reputation decrease
7. Winner: stake returned + slight reputation boost
```

---

## 8. Data Flow — Complete Job Lifecycle

```
T=0ms   Requester submits POST /v1/chat/completions
        Gateway validates request, normalizes to Job Spec
        
T=5ms   Gateway queries Matching Engine
        ME queries Node Registry for eligible nodes
        
T=10ms  Top 10 eligible nodes notified of job opportunity
        
T=25ms  Bids received from 6 nodes
        Scoring function applied
        Winner selected (e.g., Node B)
        
T=30ms  Requester wallet calls escrow.lockFunds() 
        [Note: in UX-optimized flow, this is pre-authorized via session allowance]
        
T=50ms  Job Assignment sent to Node B
        
T=55ms  Node B starts inference
        
T=2500ms Node B streams first tokens back to Gateway
         Gateway forwards to Requester (streaming)
         
T=8000ms Inference complete (1024 tokens generated)
         Node B submits Job Completion Report:
         { job_id, token_count: 1024, result_hash: "0x...", 
           output_merkle_root: "0x..." }
           
T=8010ms Gateway marks job COMPLETE
         Sends to Verification Queue
         
T=8020ms Requester has full response
         
T=8500ms Verification Oracle checks (async):
         5% chance → full re-run on oracle nodes
         95% chance → format/length sanity check only
         
T=9000ms Job marked VERIFIED
         escrow.release() called
         Provider paid: 1024 × 0.0000003 × 0.95 = $0.000292
         Protocol fee:  1024 × 0.0000003 × 0.05 = $0.0000154
```

---

## 9. Scalability & Performance Targets

| Metric | Phase 1 Target | Phase 2 Target |
|---|---|---|
| Concurrent active jobs | 1,000 | 100,000 |
| Job matching latency | <100ms | <50ms |
| Node discovery time | <500ms | <100ms |
| API response (first token) | <2s | <500ms |
| Settlement finality | <30s | <5s (L2) |
| Network nodes | 500 | 50,000 |

---

## 10. Technology Stack Recommendation

| Layer | Technology | Rationale |
|---|---|---|
| API Gateway | Go (Gin/Fiber) | High throughput, low latency |
| Matching Engine | Go + Redis | Sub-millisecond operations |
| P2P Network | libp2p (Go) | Battle-tested, same as IPFS/Ethereum |
| Node Daemon | Rust | Performance, memory safety |
| Smart Contracts | Solidity on Arbitrum | Low fees, EVM compatibility |
| Token Standard | ERC-20 | Maximum ecosystem compatibility |
| Model Storage | HuggingFace + IPFS | Redundancy |
| Monitoring | Prometheus + Grafana | Standard observability |
| Message Queue | Apache Kafka | Job event streaming at scale |
