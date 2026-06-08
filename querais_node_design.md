# QueraIS — Node Design
## Node Operator Experience & Daemon Architecture

---

## 1. Design Philosophy: 10-Minute Setup

The node daemon must be so simple that a non-technical person who knows how to install apps can set it up. This is the difference between 500 nodes and 50,000 nodes.

**Target user for setup flow**: Someone who has played with Ollama or LM Studio. Can follow a 5-step guide. Does not need to know what a smart contract is.

---

## 2. Hardware Requirements

### Tier 1: Consumer Entry (Bronze Node)
```
GPU:      NVIDIA GTX 1070 / AMD RX 5700 or better
VRAM:     8GB minimum
RAM:      16GB
Storage:  100GB SSD (for 1-2 quantized models)
Internet: 50 Mbps upload minimum
OS:       Windows 10/11, Ubuntu 20.04+, macOS 13+

Recommended models:
  - Llama-3-8B-Instruct (Q4_K_M) — 4.7GB
  - Mistral-7B-Instruct (Q4_K_M) — 4.1GB
  
Expected earnings: $15–40/month at 30% utilization
Expected power cost: $8–15/month
Expected profit: $7–25/month
```

### Tier 2: Consumer Mid (Silver Node)
```
GPU:      NVIDIA RTX 3080 / RTX 4070 or better
VRAM:     12–16GB
RAM:      32GB
Storage:  500GB SSD
Internet: 100 Mbps upload

Recommended models:
  - Llama-3-8B-Instruct (FP16) — 16GB (max quality, fills 16GB VRAM)
  - Llama-3-13B-Instruct (Q8_0) — 13.5GB (good quality-to-size ratio)
  - Mistral-7B-Instruct (Q8_0) — 7.7GB
  - Qwen2-7B (Q8_0) — 7.7GB

Note: Llama-3-70B-Instruct is NOT compatible with this tier's VRAM range.
The Q4_K_M quantization requires ~39GB of VRAM, necessitating 2× 24GB GPUs
(see Gold/Platinum tier). CPU offloading is possible but reduces throughput
to ~2–5 tokens/second, which is too slow for competitive job bidding.
  
Expected earnings: $40–120/month at 30% utilization
Expected power cost: $15–25/month
Expected profit: $25–95/month
```

### Tier 3: Consumer High-End (Gold Node)
```
GPU:      NVIDIA RTX 4090 / 2× RTX 3090 or better
VRAM:     24GB+ (or 48GB+ with multiple GPUs)
RAM:      64GB
Storage:  2TB NVMe SSD
Internet: 500 Mbps upload

Recommended models:
  - Llama-3-70B-Instruct (Q4_K_M) — ~39GB (fits with 2× 24GB)
  - Llama-3-8B-Instruct (FP16) — 16GB
  - All smaller models
  
Expected earnings: $100–300/month at 40% utilization
Expected power cost: $25–45/month
Expected profit: $75–255/month
```

### Tier 4: Professional / Datacenter (Platinum Node)
```
GPU:      NVIDIA A100/A6000/H100, or 4×+ consumer GPUs
VRAM:     40GB+ per GPU
RAM:      128GB+
Storage:  10TB+ NVMe
Internet: 1 Gbps+ upload

Recommended models:
  - All models including full FP16/BF16 precision
  - Custom fine-tuned models
  - Embedding models in parallel
  
Expected earnings: $500–5,000+/month depending on utilization
Expected power cost: $100–1,000/month
Expected profit: $400–4,000+/month
```

---

## 3. Node Daemon Architecture

The daemon is a single binary (Go or Rust) that manages all node functions:

```
QueraIS Node Daemon
├── Config Manager
│   ├── Read config.yaml
│   ├── Wallet management (encrypted keystore)
│   └── Model preferences
│
├── Model Manager
│   ├── Model catalog sync (check available models from registry)
│   ├── Model downloader (background, resumable)
│   ├── Model integrity verifier (SHA256 hash check)
│   ├── Model loader / unloader (based on job demand)
│   └── VRAM manager (prevent OOM)
│
├── Inference Engine Wrapper
│   ├── llama.cpp (primary, GGUF models)
│   ├── vLLM (optional, for advanced nodes)
│   ├── ExLlamaV2 (optional, NVIDIA consumer)
│   ├── Request queue (serialize concurrent requests per model)
│   └── Streaming output handler
│
├── Job Handler
│   ├── Job listener (WebSocket to QueraIS API or P2P)
│   ├── Bid calculator (auto-price based on load + market)
│   ├── Job acceptance logic (check VRAM, queue depth)
│   ├── Result packager (hash, token count, result)
│   └── Completion reporter
│
├── Network Layer
│   ├── P2P client (libp2p — announces presence to DHT)
│   ├── Direct job channel (WebSocket server for job assignments)
│   └── Heartbeat sender (60-second pings to monitoring)
│
├── Wallet & Payments
│   ├── Read-only wallet display (shows earnings)
│   ├── Stake status monitor
│   └── Auto-claim earnings (optional, weekly)
│
├── Metrics & Logging
│   ├── Local metrics server (port 9090 for Prometheus)
│   ├── Earnings tracker
│   ├── Job history (local SQLite)
│   └── Error log with automatic reporting (opt-in)
│
└── Dashboard Server
    ├── Local web UI (http://localhost:3000)
    └── Optional: Public share link for node status
```

---

## 4. Setup Flow (10-Minute Target)

### Step 1: Download (30 seconds)
```
Options:
A) Windows: querais-node-setup.exe (one-click installer)
B) Mac: querais-node.dmg
C) Linux: curl -sSL https://install.querais.io | bash
D) Docker: docker run querais/node
```

### Step 2: Hardware Check (1 minute)
First launch runs automatic hardware detection:
```
✅ GPU detected: NVIDIA RTX 4090 (24GB VRAM)
✅ RAM: 64GB available
✅ Storage: 500GB free on /data/querais
✅ Internet: Upload speed 480 Mbps
✅ Recommended tier: Gold Node

Estimated earnings: $150–280/month at current market rates
```

### Step 3: Wallet Setup (2 minutes)

**Option A — Create new wallet (recommended for beginners)**
```
A new wallet has been created for you:
  Address: 0x4f21...d98a
  
Your seed phrase (WRITE THIS DOWN):
  word1 word2 word3 ... word12
  
Your wallet is stored encrypted at: ~/.querais/keystore
```

**Option B — Import existing wallet**
```
Enter your private key or seed phrase:
[ _________________________ ]
```

**Option C — Hardware wallet (Ledger/Trezor)**
```
Connect your hardware wallet for maximum security
```

### Step 4: Stake (3 minutes)
```
To activate your node, you need to stake $QAIS tokens.

Minimum stake for Gold Node: 2,500 QAIS (~$37.50 at current price)
Your current balance: 0 QAIS

Options:
A) Buy QAIS with ETH/USDC (integrated swap via Uniswap)
B) I already have QAIS — connect wallet
C) Start with Bronze tier (100 QAIS minimum)
```

After staking:
```
✅ Stake confirmed: 2,500 QAIS
✅ Node registered: QmXxx7a9b...
✅ Tier: Gold

Your node will appear in the marketplace in ~2 minutes.
```

### Step 5: Choose Models (2 minutes)
```
Select models to serve (we'll download them in the background):

✅ Llama-3-8B-Instruct (4.7GB) — High demand, good earnings
☐ Llama-3-70B-Instruct (40GB) — Requires 2 GPUs — Very high earnings
✅ Mistral-7B-Instruct-v0.2 (4.1GB) — Popular for coding
✅ Qwen2-7B-Instruct (4.2GB) — High demand from Asia
☐ phi-3-mini-4k-instruct (2.3GB) — Low demand, low earnings

[Download Selected Models →]

Downloading Llama-3-8B: ████████░░░░ 65% (2.8GB / 4.7GB)
ETA: 4 minutes
```

### Done!
```
🎉 Your node is LIVE!

Current status: Active
Jobs received today: 0 (just started!)
Estimated daily earnings: $3.50 – 8.00

View your dashboard: http://localhost:3000
```

---

## 5. Auto-Pricing Algorithm

Nodes can manually set prices or use the auto-pricing algorithm:

```
Auto-Pricing Algorithm:

Base price = market_median_price_for_model × 0.90  (10% below median to win bids)

Adjust for load:
  if current_load < 20%: price × 0.85  (discount to attract jobs)
  if current_load 20-60%: price × 1.00  (market price)
  if current_load 60-80%: price × 1.10  (slight premium)
  if current_load > 80%:  price × 1.25  (scarcity premium)

Adjust for reputation:
  if reputation > 0.95: price × 1.05  (premium for trusted node)
  if reputation < 0.80: price × 0.90  (discount to compete)

Adjust for electricity cost (user-configurable):
  Hard floor: electricity_cost_per_token × 1.20  (20% margin minimum)
  Never price below this floor regardless of other factors.

Final price range: [floor, 2 × market_median]
```

---

## 6. Model Verification

Before serving any model, the daemon verifies integrity:

```
Model Verification Flow:
1. Download model file (GGUF or safetensors)
2. Compute SHA256 hash of downloaded file
3. Compare against canonical hash from QueraIS Model Registry
4. If mismatch → refuse to serve, alert operator, re-download
5. If match → model is approved for serving

Model Registry (maintained by QueraIS, audited by community):
  model_id: "meta-llama/Llama-3-8B-Instruct"
  filename: "Meta-Llama-3-8B-Instruct-Q4_K_M.gguf"
  sha256: "abc123..."
  source: "https://huggingface.co/..."
  ipfs_cid: "QmXxx..."  // backup source
  min_vram_gb: 6
  recommended_backend: "llama.cpp"
```

This prevents:
- Backdoored or trojaned models being served
- Model spoofing (pretending to serve Llama-3-70B but serving a 7B)
- Data poisoning attacks

---

## 7. Node Dashboard (Local Web UI)

The node runs a local web dashboard at `http://localhost:3000`:

```
┌─────────────────────────────────────────────────────────────┐
│  QueraIS Node Dashboard                          🟢 LIVE    │
├─────────────────────────────────────────────────────────────┤
│  EARNINGS                                                   │
│  Today: $4.28    This Month: $127.50    All Time: $892.10   │
│  ─────────────────────────────────────────────────────────  │
│  Earnings Graph (last 30 days)                              │
│  [███████████████████████████████░░░░░░░░░░░░░░░]          │
├─────────────────────────────────────────────────────────────┤
│  REPUTATION: 0.87 ████████████████░░░░                      │
│  Accuracy: 0.96 │ Uptime: 0.98 │ Latency: 0.72 │ Age: 0.41 │
├─────────────────────────────────────────────────────────────┤
│  ACTIVE JOBS (2)                                            │
│  [job_id: 4f2a] Llama-3-8B │ 412/2048 tokens │ streaming   │
│  [job_id: 7b1c] Mistral-7B │ 89/512 tokens │ streaming     │
├─────────────────────────────────────────────────────────────┤
│  HARDWARE                                                   │
│  GPU: NVIDIA RTX 4090 │ VRAM: 18.2/24GB │ Temp: 72°C       │
│  CPU: 24% │ RAM: 28GB/64GB │ Upload: 45 Mbps                │
├─────────────────────────────────────────────────────────────┤
│  MODELS SERVING                                             │
│  ✅ Llama-3-8B-Instruct (Q4_K_M) │ 120 tok/s               │
│  ✅ Mistral-7B-Instruct (Q8_0)   │ 115 tok/s               │
│  ⏬ Qwen2-7B (downloading 67%)                              │
├─────────────────────────────────────────────────────────────┤
│  STAKE: 2,500 QAIS ($37.25)    TIER: Gold                   │
│  Wallet: 0x4f21...d98a                                      │
│  [Add Stake] [Withdraw Earnings] [Unbond]                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Node Operator FAQ (For Documentation)

**Q: Can I run a node on my gaming PC while I game?**
A: Yes. The daemon detects GPU activity and automatically pauses accepting jobs when your GPU is more than 80% utilized by other processes.

**Q: Can I run multiple nodes on one machine (multiple GPUs)?**
A: Yes. Each GPU can run as an independent node instance with its own stake and reputation.

**Q: What happens if my power goes out mid-job?**
A: The job will timeout and be reassigned to another node. You will not be slashed for isolated power failure events (accounted for in uptime tolerance), but frequent failures will reduce your uptime score.

**Q: What if I don't have any $QAIS to stake?**
A: The node installer includes an integrated swap — you can buy $QAIS directly with ETH, USDC, or a credit card (via on-ramp integration with MoonPay or Transak).

**Q: How do I get paid?**
A: Earnings accumulate in your wallet's escrow balance. You can claim them at any time. Claiming costs a small gas fee (~$0.01 on Arbitrum). Auto-claim is available weekly.

---

## 9. Prompt Privacy & Confidentiality

> ⚠️ This section covers a topic that is critical for enterprise adoption. It must be prominently surfaced in developer documentation.

### 9.1 The Fundamental Tension

Nodes must run inference on user prompts. This means the node operator — a stranger on the internet — can technically read every prompt and response that passes through their hardware. For many use cases (general Q&A, coding help, creative writing) this is an acceptable tradeoff. For enterprise use cases involving proprietary data, medical records, legal documents, or financial information, it is not.

This must be **clearly disclosed** to all developers using the platform.

> **Required Developer Disclosure (must appear in docs and terms of service):**
> Prompts submitted to public QueraIS nodes are processed by independent third-party operators. Do not submit personally identifiable information (PII), protected health information (PHI), financial account credentials, attorney-client privileged content, or proprietary trade secrets through public nodes unless using a Confidential Compute-certified node or a private enterprise node.

### 9.2 Phase 1: No Prompt Encryption (Launch State)

- Prompts transmitted to nodes in plaintext
- Node operators *could* log prompt and response content
- **Mitigations in place:**
  * Nodes operate under a staked pseudonym — provably accountable for behavior
  * Terms of service prohibit prompt logging for resale or training
  * Systematic prompt surveillance is economically irrational for nodes (it earns them nothing and risks their stake)
  * Users can inspect node reputation/history before routing sensitive jobs
- **What this means for developers:** Suitable for general-purpose workloads. Not suitable for regulated data (HIPAA, GDPR-sensitive, SOC2-required workloads).

### 9.3 Phase 1.5: Enterprise Private Nodes

Available from launch as an enterprise offering:

- Enterprise customers deploy their own QueraIS node within their own infrastructure (on-premise or private VPC)
- Prompts never leave the enterprise's network
- The enterprise node still participates in the QueraIS protocol for:
  * Payment rails (internal accounting using $QAIS)
  * API compatibility layer
  * Reputation tracking (internal SLA monitoring)
- Billed as an enterprise license with SLA guarantees
- This is the recommended path for any customer with compliance requirements

### 9.4 Phase 2: Trusted Execution Environments (TEE)

The long-term solution for public prompt privacy:

- Inference runs inside a **confidential compute enclave** (Intel TDX or AMD SEV-SNP)
- The enclave cryptographically proves:
  * The correct, unmodified model weights were loaded
  * The prompt was processed inside the encrypted enclave (never accessible to the host OS or node operator)
  * The output was produced by the claimed model
- Requires node operators to have TEE-capable hardware (modern AMD EPYC or Intel Xeon with TDX)
- **TEE Nodes earn a Confidential Compute Premium:**
  * 15% higher base price per token
  * Priority routing for jobs flagged as `"privacy_required": true`
  * "Confidential" badge on Node Card
- TEE nodes are the recommended tier for healthcare, legal, and financial workloads

### 9.5 Hardware Compatibility for TEE

| TEE Technology | Compatible Hardware | Availability |
|---|---|---|
| Intel TDX | Intel Xeon 4th gen (Sapphire Rapids) + | Datacenter/server grade |
| AMD SEV-SNP | AMD EPYC 7003/9004 series | Datacenter/server grade |
| NVIDIA H100 CC Mode | NVIDIA H100 SXM/PCIe | High-end datacenter |

Note: Consumer GPUs (RTX series) do not currently support TEE. This means Phase 2 TEE nodes will predominantly be datacenter Platinum nodes. Consumer nodes remain Phase 1 (unencrypted) until hardware support expands.
