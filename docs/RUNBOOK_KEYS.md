# RUNBOOK — Keys & Emergency Pause

Operational runbook for QueraIS key custody and incident response. Written for
2am-you: every response step is copy-pasteable. Keep this file in sync with
`packages/contracts/test/Pausable.ts` (the pause table below is pinned by those
tests) and the e2e pause drill (`runPauseDrillCase` in `packages/test-e2e`).

---

## 1. Key inventory

| Key / secret | Where it lives | What it holds |
|---|---|---|
| **Gateway hot EOA** `0xc80A8137E57D494b195edA12F74D7Df324F5b9d6` | `GATEWAY_PRIVATE_KEY` in the gateway host's `.env` | ORACLE + SLASHER (NodeRegistry), ORACLE + MATCHING_ENGINE (JobEscrow), SETTLER (CreditAccount); gas ETH; faucet QAIS; is also the Sepolia **treasury** address |
| **Cold admin EOA** `0x85cC469CBB1197480Dc399F5B2AC731102119dE8` | `ADMIN_PRIVATE_KEY` in the repo-root `.env` (gitignored) + offline copy held by the operator | DEFAULT_ADMIN_ROLE + PAUSER_ROLE on all three contracts (split executed 2026-06-10, §7) |
| **Pauser key** | `PAUSER_PRIVATE_KEY` (same as the cold admin EOA today; separate env name so they can diverge later) | `pause()`/`unpause()` authority |
| Node daemon key(s) | each node operator's own `.env` / keystore | that node's stake + job earnings; not protocol-privileged |
| Gateway admin token | `adminToken` in gateway config | issuing API keys via `POST /v1/keys` |
| Requester API keys | gateway SQLite DB (hashed) | per-key quota tier + wallet binding |

**QUAISToken is NOT pausable.** Token transfers can never be frozen — pause
protects protocol flows, not the ERC-20 itself.

On **localhost/e2e** the admin+pauser is the Hardhat deployer (account #0), which
is deliberately *not* the gateway key (account #1) — the e2e pause drill rehearses
the production posture where pause works without the hot key.

## 2. Blast radius of a gateway-key leak

An attacker holding the gateway hot key **can**:

- settle fabricated debits against any **open signed cap**, up to each cap's
  remaining headroom (SETTLER_ROLE) — bounded per requester by `maxSpendWei`
- drain the gateway's gas ETH and the faucet's QAIS (plain transfers)
- slash any node 1% per call (SLASHER_ROLE) and corrupt reputation (ORACLE_ROLE)
- create/assign/complete junk jobs (MATCHING_ENGINE + ORACLE on JobEscrow) —
  including pulling each requester's **standing JobEscrow allowance** into escrow
  via `createJob` and settling it to a colluding provider (Slither's acknowledged
  `arbitrary-send-erc20` finding, `docs/SLITHER_TRIAGE.md`) — bounded per
  requester by whatever allowance they granted JobEscrow

An attacker **cannot**:

- steal credit principal beyond open signed caps (the chain enforces cap +
  balance bounds in `batchSettle`)
- steal node stakes (only slash 1%-per-call into the treasury)
- mint tokens (fixed supply, no mint)
- *(after the key split)* pause/unpause, grant/revoke roles, or change the
  treasury/fee — those need the cold admin key

**Before the §7 key split, admin == gateway**, so a leak also compromised pause
and rotation. That is exactly what the split fixes; keep it that way.

## 3. Immediate response (gateway key compromised)

Run these in order. Step 2 needs only the repo + the pauser key — it works even
if the gateway host itself is owned.

```powershell
# 1. Stop the gateway process (kills batched intake + the gas-spending loop).
#    On the gateway host:
Get-Process node | Stop-Process -Force     # or: stop the service/container

# 2. Pause all three contracts (from ANY machine with the repo + PAUSER_PRIVATE_KEY):
cd packages/contracts
pnpm pause pause --network arbitrumSepolia

# 3. Verify:
pnpm pause status --network arbitrumSepolia      # expect paused=true ×3

# 4. Damage assessment — query settlement/slash events since the suspected leak:
#    BatchSettled on CreditAccount, NodeSlashed on NodeRegistry, JobVerified on JobEscrow.
#    (Arbiscan: each contract address → Events; or a viem getContractEvents script.)

# 5. Rotate the gateway key (see §4), update the gateway .env, restart the gateway.

# 6. Unpause:
pnpm pause unpause --network arbitrumSepolia
pnpm pause status --network arbitrumSepolia      # expect paused=false ×3
```

Notes:

- `pause`/`unpause` are **idempotent** — contracts already in the target state are
  skipped, so re-running after a partial failure is safe.
- The script signs with `PAUSER_PRIVATE_KEY` (falls back to `DEPLOYER_PRIVATE_KEY`)
  from the process env or the repo-root `.env`, checks every receipt, and exits
  non-zero if any contract failed — **read the output, don't assume**.
- **Pausing does NOT stop batched intake by itself**: an already-running gateway
  keeps accepting jobs and accruing off-chain debits (its flush just reverts and
  retries). A real freeze = **stop the gateway process AND pause the contracts**
  — that's why step 1 is first.

## 4. Key rotation (gateway hot key)

Roles are plain OpenZeppelin AccessControl — rotation is grant-new, then
revoke-old, per role per contract, signed by the **cold admin** key.

1. Generate a fresh EOA; fund it with a little Sepolia ETH for gas.
2. With the cold admin key, for each (contract, role) pair grant to the new
   address, then revoke from the old:
   - NodeRegistry: `ORACLE_ROLE`, `SLASHER_ROLE`
   - JobEscrow: `ORACLE_ROLE`, `MATCHING_ENGINE_ROLE`
   - CreditAccount: `SETTLER_ROLE`
3. Verify with `hasRole` reads: new == true and old == false for all five pairs.
4. Update `GATEWAY_PRIVATE_KEY` in the gateway host's `.env`; restart; check
   `/health` and run one job end-to-end.
5. Sweep any remaining gas ETH / faucet QAIS from the old address.
6. If the old key was also the treasury (it is, on Sepolia today): point the fee
   sink elsewhere via `setTreasury` (admin) on JobEscrow + CreditAccount.

**Order matters: grant before revoke** (never leave a role unheld), and
**check every receipt** — a mined-but-reverted grant followed by a successful
revoke locks the gateway out of its own role.

Important caveat: open sessions name the settler **inside the signed cap**
(`cap.settler`), so after rotating the settler key, existing sessions cannot be
settled by the new key. Flush all pending debits *before* the revoke
(stop intake → wait for/force a flush → then rotate), or accept eating the
unflushed debits; requesters must re-open sessions naming the new settler.

## 5. What pause does / does not stop

Pinned by `packages/contracts/test/Pausable.ts` — update both together.

| Contract | Frozen while paused (`EnforcedPause`) | Still works while paused |
|---|---|---|
| NodeRegistry | `registerNode`, `addStake`, `initiateUnbonding` | `completeUnbonding` (stake exit), `updateReputation`, `slash`, all reads |
| JobEscrow | `createJob`, `assignJob`, `completeJob`, `verifyAndRelease` | `failJob`, `cancelJob`, `timeoutJob` (all refund paths), all reads |
| CreditAccount | `deposit`, `batchSettle` | `initiateWithdrawal`, `completeWithdrawal` (principal exit), all reads |
| QUAISToken | — (not pausable) | everything, always |

Design intent: pause freezes **value inflows and settlement** (nothing new gets
locked or paid out through the protocol) while **every user exit/refund path
stays open** — a pause can never trap user funds.

## 6. Drill log

| # | Date | Network | Operator | What was exercised | Result |
|---|---|---|---|---|---|
| 1 | 2026-06-10 | localhost (e2e) | automated — `runPauseDrillCase` | real `scripts/pause.ts` pause → chat 5xx while `/health` stays up → unpause → service restored | ✅ pass; re-runs on every `pnpm test:e2e` |
| 2 | 2026-06-10 | Arbitrum Sepolia | operator + Claude (cold key `0x85cC…9dE8`) | key split (§7: 6 grants by hot, 6 revokes by cold, `hasRole`-verified) then live `pause` ×3 → `status` → `unpause` ×3 → `status` | ✅ pass; **time-to-pause 10.5s** for all three contracts; pause txs `0x87c2bb…`, `0x617f2b…`, `0x322e67…` |

## 7. Admin/pauser key split (one-time hardening)

Goal: the hot gateway key must **not** hold DEFAULT_ADMIN_ROLE or PAUSER_ROLE —
a leaked hot key must not also surrender pause and rotation authority.

Procedure (all txs signed by whoever currently holds admin — initially the hot
key itself; receipt-check every tx):

1. Generate a fresh cold EOA **offline**. Store it as `ADMIN_PRIVATE_KEY` (and
   `PAUSER_PRIVATE_KEY`) in the repo-root `.env` (gitignored) and keep an
   offline copy. Fund it with a sliver of ETH for gas.
2. On each of NodeRegistry, JobEscrow, CreditAccount:
   `grantRole(DEFAULT_ADMIN_ROLE, cold)` then `grantRole(PAUSER_ROLE, cold)`.
3. Verify with `hasRole` reads that the cold EOA holds both roles on all three
   contracts **before any revoke** (grant-before-revoke; never leave a role
   unheld).
4. On each contract, *signed by the cold key*:
   `revokeRole(PAUSER_ROLE, hot)` then `revokeRole(DEFAULT_ADMIN_ROLE, hot)`
   (admin last, since it gates the other revokes).
5. Verify end state: cold has ADMIN+PAUSER ×3; hot has neither, but keeps its
   operational roles (ORACLE/SLASHER/MATCHING/SETTLER).
6. Rehearse: `pnpm pause pause` + `unpause` with the cold key (drill log §6).

Status: **executed on Arbitrum Sepolia 2026-06-10** (drill log entry #2). The
script that ran it is committed: `packages/contracts/scripts/split-admin.ts`
(`status` / `grant` / `revoke`). End state verified: cold
`0x85cC469CBB1197480Dc399F5B2AC731102119dE8` holds ADMIN+PAUSER on all three
contracts; the hot gateway key holds neither, keeping only its operational
roles.

## 8. Why there is no `/v1/admin/pause` HTTP endpoint

Deliberate. Pause authority must work **when the gateway itself is compromised
or down** — the exact scenarios where an HTTP endpoint on the gateway is useless
or attacker-controlled. Pause stays a CLI (`scripts/pause.ts`) signed by its own
key, runnable from any machine with the repo and an RPC URL.
