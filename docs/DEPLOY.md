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

```bash
fly auth login
fly apps create querais-gateway                      # match `app` in packages/gateway/fly.toml
fly volumes create querais_data --region iad --size 1   # SQLite is small; 1 GB is ample

# App secrets — set ON the platform, never in GitHub or CI logs. HOT keys only.
fly secrets set \
  GATEWAY_PRIVATE_KEY=0x... \
  GATEWAY_ADMIN_TOKEN=<random> \
  GATEWAY_API_KEYS="sk-live-...:0x<wallet>" \
  RPC_URL=https://<arbitrum-sepolia-rpc> \
  ARBITRUM_SEPOLIA_RPC_URL=https://<arbitrum-sepolia-rpc>
# Optional: faucet (needs a distributor key holding QAIS+ETH):
#   fly secrets set GATEWAY_FAUCET_PRIVATE_KEY=0x...
# Optional: enable the Layer-A oracle + on-chain disputes (needs Ollama + bond funds):
#   fly secrets set GATEWAY_ORACLE_OLLAMA_URL=... GATEWAY_LAYER_A_DISPUTE_ON_ANOMALY=true
```

**The COLD admin + pauser keys are NEVER set here.** Pause (`pnpm ops:pause`) and incentive
payouts (`pnpm ops:allocate`) run from your own machine with those keys — runbook §7/§7d.

## First deploy + enforce single instance

```bash
# From the repo ROOT (build context = the whole monorepo):
fly deploy . --config packages/gateway/fly.toml \
             --dockerfile packages/gateway/Dockerfile --strategy immediate
fly scale count 1            # belt-and-suspenders on top of the single-volume guarantee
fly status                   # confirm 1 machine, health + ready checks passing
curl https://querais-gateway.fly.dev/health   # liveness
curl https://querais-gateway.fly.dev/ready     # 200 when RPC+DB reachable, else 503
```

## Auto-deploy on merge to main

```bash
fly tokens create deploy -x 999999h          # a deploy-scoped token
# Add it as a GitHub repo SECRET named FLY_API_TOKEN (Settings → Secrets → Actions).
# Then flip the switch: add a GitHub repo VARIABLE  DEPLOY_ENABLED = true.
```

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
