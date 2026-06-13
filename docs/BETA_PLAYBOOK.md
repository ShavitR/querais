# Beta Playbook — recruiting the first node cohort & running the campaigns

Campaign *materials* for the private-beta push (GTM doc Phase 0 → Phase 1). Everything
here runs on rails that already exist in the repo — the leaderboard data is
`GET /v1/nodes`, the prizes pay out through the Slice 6C incentive programs
(`docs/INCENTIVES.md`), and the install path is the release archive
(`docs/NODE_RELEASE_INSTALL.md`). **Running the campaign is an operator/human job;
nothing in this file executes by itself.**

> Testnet framing applies to every word said in public: **no token has launched, testnet
> QAIS has no monetary value**, and earnings claims must say so. See `docs/TERMS.md`.

---

## 1. Goals (GTM Phase 0, made concrete)

| Goal | Measure | Source of truth |
| --- | --- | --- |
| Stable beta cohort | 50+ nodes ≥95% uptime | `/v1/nodes` uptime dimension |
| Geographic spread | 5+ countries | operator's cohort sheet (not on-chain) |
| Real traffic | 1,000+ settled API calls | `/v1/stats`, `/metrics` |
| Quality floor | <5% verification failure rate | `querais_jobs_total{outcome}` |

## 2. Recruitment script (copy, adapt, post)

Where to post (GTM §3.1): r/LocalLLaMA, r/nvidia, GPU/AI Discord servers, crypto Twitter.
One thread per community, adapted to local rules — never spam.

**Short version (Discord / X):**

> Got a GPU and Ollama? We're running a private beta of **QueraIS** — a decentralized
> marketplace where your machine serves LLM inference jobs and earns testnet QAIS
> (no real value yet — this is protocol validation, you'd be in at the ground floor).
> Setup is a release download + two commands, ~5 minutes, no build tools. Contracts are
> live on Arbitrum Sepolia and jobs settle on-chain end-to-end. DM for an invite.

**Long version (Reddit post body):**

> **What it is.** QueraIS is "BitTorrent for AI inference": an OpenAI-compatible API on
> one side, independent GPU operators on the other, payment settling on-chain (95% to
> the node, 5% protocol fee) with staking + reputation keeping everyone honest. The
> whole thing is real and running on Arbitrum Sepolia testnet today.
>
> **What we're asking.** Run a node through the beta — one command does it:
> `iwr -useb https://querais.xyz/install.ps1 | iex` (Windows) or
> `curl -fsSL https://querais.xyz/install.sh | sh` (mac/Linux), then keep it up. Your node
> auto-funds itself from the testnet faucet (gas + stake), registers on-chain, and starts
> competing for jobs. Hardware floor is modest — any machine that runs Ollama comfortably can
> serve small models.
>
> **What you get.** Testnet QAIS earnings per served job (**no monetary value — no
> token has launched**), launch bonuses for the earliest stable nodes, a spot on the
> public leaderboard, and a real voice in protocol decisions while it's still small.
> When mainnet comes, testnet operators migrate first.
>
> **What we won't do.** Ask for money, ask for your keys (the daemon generates its own
> hot wallet), or promise returns.

**Developer-side invite (the 20–30 early API teams):**

> We'll issue you an API key for an OpenAI-compatible endpoint backed by independent
> GPU nodes. Point the official `openai` client at our base URL and your existing code
> runs unchanged — streaming included. Free testnet credits; we want feedback on
> latency, model coverage, and failure modes, weekly 30-min call optional.

## 3. Leaderboard campaign

The leaderboard **is** `GET /v1/nodes` — public, no auth, already serving: composite
reputation + the five dimension scores (accuracy/uptime/latency/longevity/stake),
models served, price, open-flag count, and claimable rewards. The campaign is
presentation + cadence, not new software:

- **Weekly snapshot post** (Discord + X): top 10 by composite, biggest climber, new
  joiners. Pull the JSON, render a table, post it. Same weekday every week — the rhythm
  is the product.
- **Ranking metric:** composite reputation (NOT raw earnings — earnings favor whoever
  joined first; the composite rewards behavior that helps the network: accuracy,
  uptime, latency, tenure, stake).
- **Tie-breaker:** jobs settled in the window (from `/v1/stats`).
- **Disqualification:** any node with an open integrity flag (`flags > 0` in
  `/v1/nodes`) is listed but marked ineligible for prizes until the flag is reviewed
  and cleared (review queue: `GET /v1/admin/flags`). Say this rule out loud in advance
  — the first public cheater-catch should look like the system working, because it is.

## 4. Top Node competition (monthly)

GTM §2 Phase 1 names the prize: **monthly "Top Node" competition, 50,000 testnet QAIS**
(operator may resize; testnet QAIS has no monetary value — the prize is status +
mainnet-migration priority).

**Rules (publish verbatim with each month's kickoff):**

1. Window = calendar month, UTC.
2. Winner = highest composite reputation at month-end snapshot among nodes with
   **≥95% uptime** over the window and **≥30 days tenure** (longevity dimension).
3. Open integrity flag at any point in the window without a cleared review =
   ineligible that month.
4. One prize per operator per quarter (self-reported operator identity; sybil-running
   multiple nodes for placement is grounds for disqualification — stake + reputation
   make this expensive anyway).
5. Payout is a one-time allocation from the ops treasury share, executed by the
   operator from the cold key: `pnpm ops:allocate` with a canonical purpose string
   `top-node:<YYYY-MM>` — the same on-chain `Allocated` event dedup used by every
   Slice 6C program (`docs/INCENTIVES.md`), so a month can never pay twice.

## 5. Launch bonuses (already built — just announce them)

These run on the Slice 6C programs; the gateway computes recommendations at
`GET /v1/admin/incentives` and the operator pays each line with `pnpm ops:allocate`:

| Program | Offer (announce this) | Mechanics |
| --- | --- | --- |
| Bootstrap bonus | "5,000 testnet QAIS to the first N nodes that stay active 30 days" | earliest-N actives with ≥30d tenure; on-chain dedup |
| Uptime pool | "Monthly pool split among every node ≥95% uptime, tenure-multiplied" | equal split × 1.00/1.05/1.15/1.25 at 0/30/60/90d |
| First-model bonus | "First node to serve a new model verified gets a bonus" | earliest verified provider per model, from job rows |

Budgets/thresholds are env-tunable (`GATEWAY_INCENTIVE_*`).

## 6. Cohort operations (weekly rhythm)

- **Office hours / feedback call** — one slot weekly; the agenda is whatever broke.
- **Support channel** — one Discord/Telegram group; pin `docs/NODE_RELEASE_INSTALL.md`
  troubleshooting table; triage everything else into GitHub issues.
- **Health watch** — the operator already gets paged (Slice 8 alerts: node-drop,
  faucet-low, open-flags); the playbook adds only: post a weekly "network health" line
  (nodes, uptime, jobs, failure rate) to the cohort channel. Numbers from `/v1/status`
  and `/metrics`.
- **Exit survey** — when a beta node leaves, ask why (one question). The answer list
  is the Slice 10 backlog.

## 7. What NOT to say (legal/positioning guardrails)

- No earnings projections, no "passive income" framing with numbers, no token-price
  talk. Testnet QAIS: always "no monetary value, no token has launched."
- Don't name competitor companies in campaign headlines (GTM §2: neutral "closed API
  providers" language).
- Don't promise mainnet dates. "Mainnet follows a security audit and a go/no-go gate"
  is the only commitment that exists (EXECUTION_PLAN Stage D).
- The privacy disclosure travels with every developer invite: ~5% of prompts are
  re-run on verification infrastructure (`docs/PRIVACY.md`) — said up front, not found
  later.

## 8. Prerequisites before the first public post

In order — each is a hard gate:

1. Repo public (`docs/REPO_PUBLIC_CHECKLIST.md` — user sign-off, irreversible).
2. A published GitHub Release with archives + `SHA256SUMS` (tag `v0.2.0`; the
   release.yml draft → user presses publish).
3. Disclosures live (`docs/TERMS.md` / `docs/PRIVACY.md` — already linked by
   `POST /v1/keys` and the dashboard).
4. Alert webhook armed (`docs/OBSERVABILITY.md`) — don't recruit a cohort the
   operator can't get paged about.
5. Faucet funded for the expected cohort size (each node draws gas + stake;
   `querais_faucet_*` gauges + the faucet-low alert watch the level).
