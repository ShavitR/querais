# Slither triage (Slice 3B-2)

How Solidity static analysis runs in CI, and the rationale for every triaged finding.
Config: `packages/contracts/slither.config.json`. CI job: `slither` in
`.github/workflows/ci.yml` (non-gating; fails-but-allowed only when findings exceed the
baseline of **1**).

## Why the scratch-copy approach

Tried in order (Slice 0 deferral revisited 2026-06-10, slither-analyzer 0.11.5):

1. **Slither on the Hardhat 3 project** (`slither .`) — crytic-compile's hardhat platform
   still expects the Hardhat 2 build-info shape and crashes with `KeyError: 'output'`
   on HH3's split `<id>.json` / `<id>.output.json` files.
2. **Direct solc on the real tree** — solc `--allow-paths` rejects pnpm's symlinked
   `.pnpm` store (the original Slice 0 blocker).
3. ✅ **Symlink-free scratch copy** — copy `contracts/` plus a dereferenced
   (`cp -rL`) OpenZeppelin into `slither-scratch/`, run
   `slither contracts --solc-remaps "@openzeppelin/contracts/=oz-contracts/"` there.
   No Hardhat, no symlinks, just solc 0.8.28. Verified locally and in CI:
   56 contracts, 94 active detectors.

(A Foundry analysis profile would also work but drags in a second toolchain purely for
analysis; the scratch copy needs nothing beyond solc + slither.)

## Acknowledged finding (the baseline of 1)

| Detector | Where | Verdict |
|---|---|---|
| `arbitrary-send-erc20` | `JobEscrow.createJob` — `safeTransferFrom(requester, address(this), locked)` with `requester` as a parameter | **Acknowledged, by design.** `createJob` is `MATCHING_ENGINE_ROLE`-gated (only the trusted gateway), and the pull is bounded by the allowance each requester granted JobEscrow. A compromised gateway key can drain *up to that allowance* into escrow/settlement — this is the documented trusted-gateway blast radius (`docs/RUNBOOK_KEYS.md` §2). Removing the trusted gateway is Phase 4. Deliberately **left visible** in every run (it's the highest-impact detector class; excluding it would also hide future genuine bugs). |

## Excluded detectors (slither.config.json) and why

| Detector | Findings it matched | Why excluded |
|---|---|---|
| `timestamp` | deadline/unbonding/withdrawal comparisons in all 3 contracts (6) | Deliberate, pinned design rule: deadlines derive from chain time (HANDOFF §6). Sequencer timestamp skew (seconds) is immaterial against hour/day-scale windows. |
| `uninitialized-local` | `total`, `totalFee` accumulators in `batchSettle` (2) | False positives — Solidity zero-initializes locals; both are `+=` accumulators. |
| `cyclomatic-complexity` | `batchSettle` (complexity 14) (1) | Informational; the function is heavily tested (guards, fuzz conservation, reentrancy, gas). |
| `assembly` | array-length truncation in `getEligibleNodes` (1) | Standard trim-a-memory-array idiom, read-only view function. |
| `solc-version`, `pragma`, `naming-convention` | OZ-internal noise | Style/informational; solhint covers our own style as the blocking gate. |

`filter_paths: "oz-contracts|mocks"` — OpenZeppelin is reviewed upstream; `mocks/` are
deliberately-malicious reentrancy test doubles (flagging them is the point of their
existence).

## Maintenance

- New finding in CI → the slither job goes red-but-allowed. Triage it: fix it, or add a
  row here AND (only for whole-detector noise) extend `detectors_to_exclude`.
- If the baseline changes (finding fixed or a new acknowledgment), update the
  `test "${COUNT:-0}" -le 1` threshold in ci.yml and this file together.
- Do NOT add inline `slither-disable` comments to contracts — triage stays in config + here.
