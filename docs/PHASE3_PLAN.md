# QueraIS — Phase 3: Public Testnet Launch (Comprehensive Build Plan)

## Where we are (entering Phase 3)

Built and live: 3 contracts deployed + verified on **Arbitrum Sepolia**; an OpenAI-
compatible **gateway** (matching, on-chain 95/5 settlement, slashing, rate limiting,
`/metrics`, persisted-ish API keys + faucet w/ ETH+QAIS, dashboard); a **node daemon**
(real Ollama inference, encrypted keystore, auto-pricing, model auto-pull, auto-reconnect,
**auto-faucet self-funding**); **dumb-proof two-command onboarding**; a verified **live
cross-machine run** (a Hyper-V VM node served a job that settled on Sepolia); and a
6-scenario e2e gate.

It is **not yet** a hosted, durable, monitored, abuse-resistant service that strangers can
use at volume. That is Phase 3.

## Goal & Definition of Done

**Goal:** a publicly-hosted QueraIS **testnet** that real outsiders use — developers sign
up and call it via the OpenAI client; independent operators run nodes and earn; it stays up,
is monitored, resists abuse, and keeps gas sane at volume. Still hub-and-spoke (one trusted
gateway) and testnet (no real value); full decentralization + mainnet are Phase 4/5.

**Definition of Done (launch-readiness checklist):**
- A stable public URL (`https://gateway.querais.io`) with TLS, ≥99% uptime, healthchecks.
- Self-serve **signup → API key + starter credits**; OpenAI drop-in works unchanged.
- **≥10 independent external nodes** online; jobs routed + settled; node earnings visible.
- **Batched settlement** so per-call gas ≈ 0 for the requester and amortized for the gateway.
- **Persistent** state (jobs, keys, usage, node history) — survives restarts; auditable.
- **Monitored 24/7**: dashboards + alerts (gateway gas balance, error rate, node count,
  settlement failures), a public status page, runbooks.
- **Abuse-resistant**: faucet Sybil/IP throttling, per-key quotas, content limits, pause drill.
- **CI/CD** gating every change (build/test/lint + **Slither** + **coverage**); versioned
  releases that the installer pulls.
- Clear **ToS + prompt-privacy disclosure + "testnet, no real value"** framing.

## Guiding principles
- **Additive, not rewrite** — reuse existing seams (`Settlement` interface, `ApiKeyStore`,
  pure `matching`, `InferenceBackend`, `loadAddresses(network)`).
- **Durable before scalable before fancy** — persistence + deploy + monitoring first.
- **Every workstream ships behind tests + alerts**; nothing goes to the public URL untested.
- **Security proportional to openness** — strangers run nodes and send prompts; assume adversaries.

---

## Workstreams

Each: **Goal · Build (deliverables + touch points) · Acceptance · Effort (S/M/L) · Risk**.

### P3.1 — Production gateway deployment & infra  · Effort L · Risk M
- **Goal:** the gateway runs 24/7 on real infra, not a dev box.
- **Build:** choose host (Fly.io / Railway / a VPS+k8s); deploy `packages/gateway/Dockerfile`;
  TLS + domain (Caddy/Cloudflare); **secrets manager** for the gateway oracle/matching key +
  faucet distributor key (no keys in env files); graceful shutdown; `/ready`/`/health`
  wired to the platform; config per env; a **gas hot-wallet** with low-balance alerting and
  a documented top-up. WebSocket-aware load balancing (node connections are long-lived).
- **Acceptance:** public HTTPS URL serves `/v1/*`; a node connects over the internet; restart
  loses no committed data (see P3.2); secrets never on disk in plaintext.
- **Touch points:** `packages/gateway`, new `deploy/` (compose/k8s/fly config), `scripts/`.

### P3.2 — Persistence & durable state  · Effort L · Risk M
- **Goal:** stop losing state on restart; enable history/audit/billing.
- **Build:** introduce a DB (Postgres prod / SQLite dev) behind small repositories. Persist:
  **API keys** (replace `ApiKeyStore` JSON), **job records** (jobId, requester, provider,
  tokens, status, settlement tx, timestamps), **usage/credits** per key, **faucet claims**
  (replace in-memory Set; enables real Sybil throttle), **node history**. Migrations. The
  dispatcher/settlement write job rows; `/v1/jobs/:id` reads from DB + chain.
- **Acceptance:** keys/jobs/faucet-claims survive restart; `/v1/usage` returns per-key
  history; an admin can audit any job end-to-end.
- **Touch points:** new `packages/gateway/src/db/*`, `key-store.ts`, `faucet.ts`, `dispatcher.ts`.

### P3.3 — Settlement at scale (session deposits + batching)  · Effort L · Risk H
- **Goal:** make per-call cost ≈ 0 and amortize gateway gas — the current per-job
  `createJob`/`verifyAndRelease` is 1–2 txs **per request** (doesn't scale).
- **Build:** the docs' **session-deposit model** — `CreditAccount.sol` (deposit, EIP-712
  signed spending cap, `batchSettle([...])`, withdraw-after-notice); off-chain signed debit
  ledger; a **batch settler** (flush every N sec / M jobs) implementing the existing
  `Settlement` interface as `BatchedSettlement`. Keep per-job as the fallback. Conservation +
  cap + revoke tests; gas/job benchmark.
- **Acceptance:** 100 calls settle in 1 tx; requester needs **no per-call wallet action**;
  worst-case loss bounded (settle only at signed prices; no principal theft); `pnpm test:e2e`
  gains a batched-settlement scenario.
- **Touch points:** `packages/contracts` (new contract + tests), `packages/gateway/src/settlement.ts`.

### P3.4 — Observability & SRE  · Effort M · Risk M
- **Goal:** know it's healthy; get paged before users notice.
- **Build:** Prometheus scrape of `/metrics` (extend with latency histograms, per-model
  counters, settlement success/fail, gas balance gauge); Grafana dashboards; **alert rules**
  (gas low, error rate, node-count drop, settlement failures, faucet drained); structured
  logs → aggregation (Loki/Datadog); optional OpenTelemetry traces; a **public status page**;
  **runbooks** (pause contracts, rotate keys, drain a bad node, top up gas).
- **Acceptance:** dashboard shows live jobs/nodes/gas; a simulated gas-low + node-drop fire
  alerts; status page reflects an induced outage.
- **Touch points:** `packages/gateway/src/metrics.ts`, new `deploy/monitoring/*`, `docs/runbooks/*`.

### P3.5 — Abuse, Sybil & security hardening  · Effort M · Risk H
- **Goal:** survive an open, adversarial internet.
- **Build:** faucet anti-abuse (persistent per-address + **per-IP** cooldown, daily cap,
  optional captcha/proof-of-work, distributor balance guard); per-key **quota tiers**;
  prompt-abuse limits (max prompt size, token caps, banned-pattern checks); WS flood/conn
  caps; **key management** (KMS, least-privilege roles, rotation runbook, pause drill);
  **Slither + coverage in CI** (the deferred item) with high/medium triaged; `npm audit` +
  Dependabot + secret scanning; a pre-launch **security review**.
- **Acceptance:** faucet can't be drained by one actor; quotas return 429 with headers;
  Slither passes in CI; a tabletop "gateway key leaked" drill has a runbook.
- **Touch points:** `faucet.ts`, `config.ts`, rate-limit config, `.github/workflows/*`.

### P3.6 — Matching & horizontal scale  · Effort M · Risk M
- **Goal:** more than one gateway instance; backpressure under load.
- **Build:** move the in-memory `NodePool` + job routing to **Redis** (shared pool state +
  pub/sub for assignments) so multiple gateway replicas share nodes; per-node **concurrency
  caps** + queueing + fair scheduling; backpressure (reject/queue when saturated). The pure
  `matching` scorer is unchanged; only the pool/transport becomes distributed.
- **Acceptance:** 2 gateway replicas serve from one node pool; a node’s concurrent jobs are
  capped; load test sustains target RPS without dropping connections.
- **Touch points:** `packages/gateway/src/node-pool.ts`, `dispatcher.ts`, new Redis adapter.

### P3.7 — Reputation completeness  · Effort M · Risk L
- **Goal:** the full multi-dimensional reputation from the design docs (today: accuracy EMA only).
- **Build:** **heartbeats** (daemon → gateway pings) → **Uptime**; **Latency** (TTFT measured
  per job) ; **Longevity** (registeredAt); composite 5-dim score; **batched on-chain snapshots**
  (daily `updateReputation`), decay, rapid-decline detection → manual-review flag.
- **Acceptance:** a flaky/slow node’s score reflects it; scores snapshot on-chain daily;
  matching uses the composite score.
- **Touch points:** `packages/node-daemon` (heartbeat), `packages/gateway` (scoring), `NodeRegistry`.

### P3.8 — Verification depth for open nodes  · Effort L · Risk H
- **Goal:** catch cheating beyond Layer-B, since strangers run nodes.
- **Build:** **Layer-A** semantic sampling — re-run ~5% of jobs on 2–3 gateway-controlled
  oracle nodes (same backend) and compare **embedding cosine similarity** (no cross-node hash
  matching — temp=0 isn't deterministic across hardware); thresholds → reputation signal /
  dispute flag; **pattern detection** (identical outputs, always-truncated, fingerprint reuse);
  **oracle redundancy** (2-of-N); wire the **challenge path** to `DisputeResolution` (full
  arbitration deferred to Phase 5, but the on-chain challenge + auto-resolve-on-clear lands here).
- **Acceptance:** a node returning plausible-but-wrong output is flagged by sampling; a
  pattern-cheater is caught; a dispute can be raised + auto-resolved for clear cases.
- **Touch points:** new `packages/gateway/src/verify-layer-a.ts`, oracle nodes, `DisputeResolution.sol`.

### P3.9 — Node-operator product polish  · Effort M · Risk L
- **Goal:** make node operation pleasant + trustworthy for non-devs.
- **Build:** **signed installers** / prebuilt release artifacts (so onboarding skips the
  source build — a single download); **model registry** with SHA256 verification + curated
  catalog; a **local operator dashboard** (earnings, uptime, GPU/VRAM, active jobs); GPU
  detection + tier suggestion; **uptime/bootstrap rewards** payout (Ecosystem Fund).
- **Acceptance:** an operator installs from a release in <5 min with no build; the local
  dashboard shows live earnings; rewards land for qualifying uptime.
- **Touch points:** `packages/node-daemon`, release pipeline (P3.14), `scripts/`.

### P3.10 — Developer experience & onboarding at volume  · Effort L · Risk L
- **Goal:** a developer goes from zero → first call in minutes, self-serve.
- **Build:** a **signup portal** (wallet/email → API key + starter credits via `/v1/keys` +
  faucet); a **usage/credits dashboard**; a **docs site** (Docusaurus): quickstart, migration
  guide, model catalog, cost calculator; publish the **Python SDK**; **LangChain / LlamaIndex
  provider** integrations; a cookbook (RAG, agents).
- **Acceptance:** a new dev signs up and gets a streamed completion via the official `openai`
  client in <5 min without talking to anyone; LangChain points at QueraIS as a provider.
- **Touch points:** new `apps/portal`, `apps/docs`, `packages/sdk` (publish), `apps/dashboard`.

### P3.11 — Tokenomics activation (testnet)  · Effort M · Risk M
- **Goal:** turn on the economic loops from the token-economics doc (today: fee → treasury EOA).
- **Build:** `ProtocolTreasury.sol` with the **60/20/20** burn/staker/ops split + `receiveFee`;
  **staking rewards** distribution to $QAIS stakers; **node incentives** (bootstrap multiplier,
  uptime pool, first-model bonus) funded from the Ecosystem Fund. All on testnet.
- **Acceptance:** fees split + burn on settlement; stakers accrue rewards; incentive payouts
  observable on-chain.
- **Touch points:** `packages/contracts` (Treasury + tests), settlement wiring.

### P3.12 — Compliance & trust surface  · Effort S · Risk M
- **Goal:** responsible framing for an open service handling user prompts + a token.
- **Build:** **Terms of Service** + **prompt-privacy disclosure** (the docs require it — public
  nodes can read prompts); pervasive **"testnet — no real value"** banners; abuse-reporting
  path; incident-comms template; mainnet **geofencing/KYC** posture documented (not built).
- **Acceptance:** ToS + privacy disclosure linked from portal/docs/dashboard; disclosure shown
  before first API key.
- **Touch points:** `apps/portal`, `apps/docs`, README.

### P3.13 — Growth & launch ops  · Effort M · Risk L
- **Goal:** actually get operators + developers on it (from the GTM doc).
- **Build:** beta cohort recruitment (r/LocalLLaMA, GPU Discords); **faucet + leaderboard
  campaign**; node "Top Operator" incentives; content (the "change one line" demo, a launch
  post); integration PRs to popular OSS; AMAs.
- **Acceptance:** hit the Phase-3 KPIs (e.g., 100+ nodes, 1k+ devs, 100k calls/day from the GTM doc).
- **Touch points:** non-code; coordinate with P3.9/P3.10.

### P3.14 — QA & release engineering  · Effort M · Risk M
- **Goal:** ship safely + repeatably.
- **Build:** **CI/CD** (GitHub Actions: build/test/lint/typecheck + Slither + coverage on PR;
  deploy gateway + publish node release on tagged merge); a **staging** environment mirroring
  prod; **load testing** (k6/artillery) + **chaos/failover** tests (kill nodes/gateway/Redis,
  verify recovery + reconnect — the daemon backoff already exists); **semantic versioning** +
  GitHub Releases that the installer/`bootstrap` consume.
- **Acceptance:** PRs blocked on green CI + Slither; a tagged release auto-deploys staging,
  then prod; load test report at target RPS; chaos test passes.
- **Touch points:** `.github/workflows/*`, `deploy/`, `scripts/`, release config.

---

## Sequencing — three sub-milestones

**M3.A — Durable & deployable** (foundation): P3.1 deploy · P3.2 persistence · P3.4
observability · P3.14 CI/CD · P3.5 (core security) → *a real hosted, monitored, persistent
gateway on Sepolia.*

**M3.B — Scale & trustworthy** (handle volume + adversaries): P3.3 batched settlement · P3.6
Redis matching · P3.7 reputation · P3.8 Layer-A verify · P3.5 (abuse hardening) → *survives
load + open, possibly-cheating nodes, with sane gas.*

**M3.C — Usable & growing** (onboard the world): P3.9 node polish · P3.10 DX portal/docs ·
P3.11 tokenomics · P3.12 compliance · P3.13 growth → *strangers self-serve and the network grows.*

Build M3.A fully before opening the URL widely; M3.B before promoting volume; M3.C is the
public launch push. Each sub-milestone ends with the same gates we use today (build/typecheck/
lint/unit/e2e) plus its own acceptance criteria and a staging soak.

## Top risks & mitigations
- **Gas cost / centralized gas wallet** → P3.3 batching + P3.4 balance alerts/top-up; documented as a Phase-4 decentralization target.
- **Open adversarial nodes** → P3.8 Layer-A + pattern detection + slashing (built) + reputation (P3.7).
- **Sybil / faucet drain** → P3.5 persistent IP+address throttle, caps, optional PoW.
- **Gateway key compromise** (holds privileged roles + gas) → KMS, least privilege, pause drill, bounded blast radius (settles only at signed prices).
- **Operational burden** → P3.4 SRE + runbooks + P3.14 CI/CD; keep scope to testnet.
- **Legal/positioning** → P3.12 ToS + disclosures + "no real value" framing.

## Explicitly OUT of scope (Phase 4 / 5)
- Removing the trusted gateway: **libp2p** P2P discovery, **on-chain sealed-bid auction**,
  **decentralized oracle** (Chainlink/UMA), permissionless settlement.
- Full **DisputeResolution** arbitration panel (only the challenge hook lands in P3.8).
- **TEE / confidential compute** prompt privacy.
- **Mainnet** deployment, **TGE**, and **DAO governance**.

## First step on approval
**M3.A → P3.2 persistence + P3.1 deploy skeleton**: introduce the DB layer (keys/jobs/
faucet-claims) behind repositories and a deployable gateway config — it unblocks durability,
audit, billing, and a real hosted URL, and everything else builds on persistent state.
