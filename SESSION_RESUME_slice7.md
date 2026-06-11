# Session resume — Slice 7 deploy (web → local Claude Code)

> Scratch/continuation note for picking this conversation up in **local Claude Code**.
> NOT the project handoff — see `HANDOFF.md` + `docs/EXECUTION_PLAN.md` for the full
> roadmap. This file only captures the *latest* thread: shipping Slice 7 and doing the
> live Fly.io deploy from a Windows machine. Safe to delete once the deploy is live.

Date: 2026-06-11 · Branch: `claude/reputation-slice-4-m8nd69` · Open PR: **#37**

---

## Where we are in one paragraph

Slices 4 (Reputation), 5 (Layer-A verification), and 6 (Tokenomics) are all built and
**merged** (through PR #35). **Slice 7A (deploy hardening, code-side)** is built and sitting
in **PR #37**, green and mergeable, **awaiting your merge** (Claude does not self-merge).
7A is the gateway's production-readiness work: graceful SIGTERM drain, a real `/ready`
probe, a SQLite backup primitive + restore drill, a non-root Docker image, a Fly.io
config, and an **opt-in** CI deploy pipeline. **Slice 7B is the operator half** — that's
*you* running the actual `fly` commands to stand the gateway up. We were mid-7B: the first
live deploy failed on Windows **purely due to shell syntax** (see below), now fixed.

## What just happened (the Windows deploy snag)

The deploy commands in `docs/DEPLOY.md` were written bash-style with `\` line-continuations
and inline `# comments`. **Windows cmd.exe doesn't understand either** — it runs each
physical line separately and tries to *execute* `#...` as a command. So every multi-line
`fly` command failed ("accepts at most 1 arg(s)", "unknown command #"). You were also in
`C:\Users\mynew` (home dir) instead of inside the repo clone, so `fly deploy .` had no
Dockerfile to build. **The deploy itself is fine — only the shell form was wrong.**

Fix shipped to PR #37 (commit `ff3265c`): `docs/DEPLOY.md` commands are now **single-line,
comment-free** so they paste cleanly into cmd.exe, PowerShell, and bash.

## Your next action: run the live deploy (single-line, from the repo root)

```
cd C:\Users\mynew\querais          (wherever you cloned querais; that's where fly.toml lives)
```

Confirm Step 4 secrets actually got set (the old multi-line `fly secrets set` failed the
same way the deploy did, so they may be missing — `/ready` returns 503 without `RPC_URL`):

```
fly secrets list --app querais-gateway
```

If `RPC_URL` / `GATEWAY_PRIVATE_KEY` aren't listed, set them (ONE line, HOT keys only):

```
fly secrets set GATEWAY_PRIVATE_KEY=0x... GATEWAY_ADMIN_TOKEN=<any-random-string> GATEWAY_API_KEYS="sk-live-...:0x<wallet>" RPC_URL=https://<arbitrum-sepolia-rpc> ARBITRUM_SEPOLIA_RPC_URL=https://<arbitrum-sepolia-rpc> --app querais-gateway
```

Then deploy + verify (one line each):

```
fly deploy . --config packages/gateway/fly.toml --dockerfile packages/gateway/Dockerfile --strategy immediate
fly scale count 1 --app querais-gateway
fly status --app querais-gateway
curl https://querais-gateway.fly.dev/health
curl https://querais-gateway.fly.dev/ready
```

`/health` = liveness (200 while up). `/ready` = 200 only when RPC + DB are reachable, else
503. `GATEWAY_ADMIN_TOKEN` is a secret **you invent** (any random string) — not issued by
anyone.

## Hard security rules (carry these into the local session)

- **COLD keys never leave your machine.** `ADMIN_PRIVATE_KEY` / `PAUSER_PRIVATE_KEY` are
  never given to Claude, never set in Fly, never in CI/GitHub. Pause + incentive payouts
  run locally with those keys (runbook §7 / §7d).
- **HOT keys** (`GATEWAY_PRIVATE_KEY`, faucet key, admin token, API keys) go in **Fly
  secrets only** — never committed, never echoed into CI logs.
- The CI deploy is **opt-in**: it's a no-op until you add repo secret `FLY_API_TOKEN` and
  repo variable `DEPLOY_ENABLED=true`. Until then the deploy job is skipped (green).

## Process rhythm (so the local session keeps the same discipline)

- One branch + one PR per slice; full green bar before asking to merge:
  `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`.
- **Claude never self-merges** — it asks you to merge.
- Stay on branch `claude/reputation-slice-4-m8nd69` for this work; don't push elsewhere
  without explicit say-so.
- Commit trailer convention: `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Slice 7A — files to orient on in PR #37

- `packages/gateway/src/main.ts` — SIGTERM/SIGINT graceful shutdown (flush pending debits,
  `GATEWAY_SHUTDOWN_GRACE_MS` default 25000, force-exit timer).
- `packages/gateway/src/server.ts` — `/ready` probes RPC (`chain.latestBlockTimestamp()`) +
  DB (`PRAGMA user_version`), 503 on failure; `/health` stays pure liveness.
- `packages/gateway/src/db/index.ts` — `backupTo(path)` via `VACUUM INTO`.
- `packages/gateway/src/db/backup.test.ts` — automated backup→crash→restore drill
  (gateway tests 105 → 107).
- `packages/gateway/Dockerfile` — `USER node`, HEALTHCHECK, single-instance note.
- `packages/gateway/fly.toml` — single stateful machine, volume `querais_data` → `/data`,
  `auto_stop_machines=false`, `min_machines_running=1`, immediate strategy, health+ready
  checks.
- `packages/gateway/litestream.yml` — optional continuous WAL backup (RPO seconds).
- `.github/workflows/deploy.yml` — opt-in `fly deploy` after CI green on `main`.
- `docs/DEPLOY.md` — operator runbook (now cmd.exe-safe).
- `docs/RUNBOOK_KEYS.md` §7d — production deploy & state custody.

## Why the gateway is exactly ONE instance (don't scale up)

`node:sqlite` is single-writer and every gateway timer (debit flush, reputation snapshot,
Layer-A sampling, pattern sweep, dispute resolution, treasury distribute, rewards epoch)
assumes a single owner. Two instances would double-publish reputation and double-raise
disputes (only settlement is idempotent). The Fly **volume binds to one machine** — that's
the physical guarantee. Never `fly scale count` above 1.

## Open threads / TODO for the local session

1. **Finish the live deploy** (commands above); read back `fly status` + the two `curl`
   results and debug `/ready` 503s (almost always a missing/wrong `RPC_URL` secret).
2. **Merge PR #37** when you're satisfied (your call — Claude won't self-merge). Latest
   commit `ff3265c` is the doc-only cmd.exe fix; **CI confirmed green** (all 5 checks
   passing as of 2026-06-11 — build·typecheck·lint·test·e2e, solhint, Slither, audit,
   coverage). Clean to merge.
3. **Optional: full Stage-B redeploy.** The current Sepolia deployment predates Slices
   5B/6, so the dispute + tokenomics contracts aren't on it. To run the full protocol:
   `pnpm deploy:sepolia`, redo the admin/pauser key split, update the committed manifest —
   the dispute hook + treasury/rewards keepers arm automatically once the manifest has the
   addresses (runbook §7b).
4. **Next slice — Slice 8 (Observability).** Highest-value item: close the **manual-review
   paging loop**. Today `node_flags`, rapid-decline detection, and Layer-A anomalies are
   all *computed* but nobody is *paged* — wire those to an actual alert sink. Plan this and
   get approval before building.

## Reload context fast in the local session

- `HANDOFF.md` — current project state across all slices.
- `docs/EXECUTION_PLAN.md` — slice-by-slice plan (Stages A+B done; Slice 7 ◐).
- `docs/DEPLOY.md` — the Fly operator runbook (start here for the deploy).
- `docs/RUNBOOK_KEYS.md` — key custody, pause, incident procedures.
- `git log --oneline -20` on `claude/reputation-slice-4-m8nd69` — recent commits.
