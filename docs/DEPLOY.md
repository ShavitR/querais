# Deploying the QueraIS gateway to Fly.io (Slice 7)

The gateway is a **single stateful instance** — its SQLite DB holds the pending-debit
ledger (unsettled money owed to nodes) plus operational state. Hosting is custody of that
state. This doc is the operator runbook; the code-side hardening (graceful drain, `/ready`,
backup primitive, Docker) is already built and tested. Incident/key procedures stay in
`docs/RUNBOOK_KEYS.md` (this doc points back to it).

## Why exactly one instance

`node:sqlite` is single-writer, and every gateway timer — debit flush, reputation
snapshot, Layer-A sampling, pattern sweep, dispute resolution, treasury distribute,
rewards epoch — assumes a single owner. Two instances would double-publish reputation and
double-raise disputes (only settlement is idempotent via `settledJob`). A Fly **volume
binds to one machine**, which is the physical guarantee; never `fly scale count` above 1.

## First-time setup (operator, once)

> **Shell note (Windows especially).** Every `fly`/`curl` command below is written as a
> **single line with no inline `# comments`** so it pastes verbatim into cmd.exe, PowerShell,
> *and* bash. On Windows cmd.exe a trailing `\` is **not** a line-continuation and a `#` is
> **not** a comment — cmd.exe runs each physical line on its own and treats `#...` as a
> command, which is exactly what broke the multi-line form. Run them one line at a time.

Create the app, the single volume, and the secrets:

```bash
fly auth login
fly apps create querais-gateway
fly volumes create querais_data --region iad --size 1 --app querais-gateway
```

`fly apps create` must match `app` in `packages/gateway/fly.toml`; the volume is tiny
(SQLite — 1 GB is ample) and binding it to one machine is what enforces single-writer.

App secrets are set **on the platform**, never in GitHub or CI logs, and only the **HOT**
keys go here (one line — values are space-separated):

```bash
fly secrets set GATEWAY_PRIVATE_KEY=0x... GATEWAY_ADMIN_TOKEN=<random> GATEWAY_API_KEYS="sk-live-...:0x<wallet>" RPC_URL=https://<arbitrum-sepolia-rpc> ARBITRUM_SEPOLIA_RPC_URL=https://<arbitrum-sepolia-rpc> --app querais-gateway
```

Optional add-ons, each its own one-line `fly secrets set`:

- Faucet (needs a distributor key holding QAIS+ETH): `fly secrets set GATEWAY_FAUCET_PRIVATE_KEY=0x... --app querais-gateway`
- Layer-A oracle + on-chain disputes (needs Ollama + bond funds): `fly secrets set GATEWAY_ORACLE_OLLAMA_URL=... GATEWAY_LAYER_A_DISPUTE_ON_ANOMALY=true --app querais-gateway`

**The COLD admin + pauser keys are NEVER set here.** Pause (`pnpm ops:pause`) and incentive
payouts (`pnpm ops:allocate`) run from your own machine with those keys — runbook §7/§7d.

## First deploy + enforce single instance

Run this **from the repo root** (the build context `.` is the whole monorepo — `cd` into
your local clone of `querais` first; running it from your home directory has no Dockerfile
to build):

```bash
fly deploy . --config packages/gateway/fly.toml --dockerfile packages/gateway/Dockerfile --strategy immediate
fly scale count 1 --app querais-gateway
fly status --app querais-gateway
curl https://querais-gateway.fly.dev/health
curl https://querais-gateway.fly.dev/ready
```

`fly scale count 1` is belt-and-suspenders on top of the single-volume guarantee; `fly
status` should show exactly 1 machine with health + ready checks passing; `/health` is
liveness (always 200 while up) and `/ready` returns 200 only when RPC+DB are reachable,
else 503.

## Auto-deploy on merge to main

```bash
fly tokens create deploy -x 999999h
```

Add that token as a GitHub repo **secret** named `FLY_API_TOKEN` (Settings → Secrets →
Actions), then flip the switch by adding a GitHub repo **variable** `DEPLOY_ENABLED = true`.

`.github/workflows/deploy.yml` then runs `fly deploy` after the CI green bar passes on
`main`. Before the variable + token exist, the deploy job is skipped (green) — it never
blocks PRs. Use **Actions → Deploy (Fly.io) → Run workflow** for a manual redeploy/rollback.

## Continuous backup (RPO seconds; recommended)

Fly takes automatic daily volume snapshots (≈24h RPO baseline). To tighten the recovery
point to seconds, run **Litestream** wrapping the gateway — it ships the SQLite WAL to an
object store. Config: `packages/gateway/litestream.yml`. To enable, add the litestream
binary to the runtime image and change the CMD to wrap node:

```dockerfile
# In packages/gateway/Dockerfile runtime stage:
COPY --from=litestream/litestream:0.3 /usr/local/bin/litestream /usr/local/bin/litestream
CMD ["litestream", "replicate", "-config", "packages/gateway/litestream.yml", \
     "-exec", "node dist/main.js"]
```

…and set the store creds as Fly secrets: `LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT`,
`LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`.

## Drills before trusting prod (append results to RUNBOOK_KEYS §6)

1. **Restore**: the logic is pinned in CI (`packages/gateway/src/db/backup.test.ts`).
   Live: `fly machine stop` → restore the latest snapshot to the volume (`litestream
   restore` or `fly volume snapshots`) → `fly machine start` → confirm settled jobs intact
   via `GET /v1/jobs/:id`; any debits from the lost window self-heal on the next flush
   (Slice-2C reconcile-on-revert).
2. **Pause**: `pnpm ops:pause pause --network arbitrumSepolia` from your machine (cold
   key), confirm `/v1/chat/completions` 5xx while `/health` stays 200, then `unpause`.
3. **Graceful drain**: `fly apps restart querais-gateway` with pending debits outstanding;
   confirm the logs show "drain complete" and the debits settled on-chain.

## Going live with the full Stage-B protocol

The current Sepolia deployment predates Slices 5B/6, so disputes + tokenomics contracts
aren't on it. Redeploy the full set first (runbook **§7b**): `pnpm deploy:sepolia`, re-run
the admin/pauser key split, update the committed manifest. The dispute hook + treasury and
rewards keepers then arm automatically once the manifest has the addresses.
