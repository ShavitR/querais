# QueraIS — Project Description for AI Coding Assistants

## What We're Building

QueraIS is a decentralized AI inference marketplace — think BitTorrent, but for
GPU compute. Anyone with a GPU can run a node, serve LLM inference jobs, and earn
cryptocurrency. Anyone needing AI compute buys it through the marketplace without
going through OpenAI, Anthropic, or any centralized provider.

The protocol operator (us) earns a 5% fee on every transaction that flows through
the network.

---

## Core Mechanic (How It Works)

1. A developer hits the QueraIS API with a prompt (OpenAI-compatible format)
2. The matching engine finds available GPU nodes that can serve the requested model
3. Nodes compete for the job based on price, reputation, and speed
4. The winning node runs inference and returns the result
5. Payment settles on-chain: 95% to the node, 5% protocol fee
6. The node's reputation score updates based on output quality

---

## The Token ($QAIS)

- ERC-20 token on Arbitrum One (L2)
- All payments on the network use $QAIS
- Nodes must stake $QAIS to participate (skin in the game)
- 5% of every transaction goes to the protocol treasury
- 20% of collected fees are burned (deflationary)
- 20% distributed to stakers
- 60% retained for operations/grants

Fixed supply: 1,000,000,000 $QAIS (no mint after launch)

---

## Smart Contracts (5 core, Solidity 0.8.x, Arbitrum One)

1. QUAISToken.sol       — Standard ERC-20 with burn()
2. NodeRegistry.sol     — Node registration, stake management, reputation storage
3. JobEscrow.sol        — Session credit deposits, batch job settlement, job record store
4. DisputeResolution.sol — Commit-reveal arbitration with slashing
5. ProtocolTreasury.sol  — Fee accumulation, burn execution, fund allocation

All contracts use OpenZeppelin. Transparent Proxy pattern for upgrades.
Access control via OpenZeppelin AccessControl with roles:
ORACLE_ROLE, MATCH
<truncated 1885 bytes>
pre-fund a credit account.
  Jobs settle in batches. Never require a wallet tx per API call.

- **EMA for accuracy score**: Single formula, not a hybrid ratio+delta system.

- **Commit-reveal arbitration**: Arbitrators vote privately then reveal simultaneously.
  Rewards are based on being CORRECT (verified by oracle), not voting with majority.

- **Dispute struct**: mappings cannot be inside structs in Solidity. Vote tracking
  uses parallel external mappings keyed by jobId.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Arbitrum One (EVM L2) |
| Smart Contracts | Solidity 0.8.x + OpenZeppelin |
| Node Daemon | Go or Rust |
| Inference Backend | llama.cpp (primary), vLLM (optional) |
| API | Node.js / FastAPI (OpenAI-compatible) |
| P2P Layer | libp2p |
| Local Dashboard | React (served by daemon) |
| Settlement | EIP-712 signed sessions + batch on-chain settlement |
| Model Registry | IPFS + SHA256 integrity checks |

---

## Project Documents (Read Before Building Anything)

All planning docs are in the project root:

- querais_overview.md           — Vision, stakeholders, business model
- querais_protocol_architecture.md — Full technical architecture, data flows, verification
- querais_token_economics.md    — Token supply, distribution, vesting, burn mechanics
- querais_reputation_system.md  — Scoring formulas, slashing, dispute flow
- querais_smart_contracts.md    — Contract-by-contract specification (not code)
- querais_node_design.md        — Node daemon architecture, hardware tiers, setup UX
- querais_go_to_market.md       — Launch strategy, phases, KPIs

Read all of them before writing any code. They contain critical design constraints.
