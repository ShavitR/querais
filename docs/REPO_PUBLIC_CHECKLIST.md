# Repo-public checklist

Going public is **irreversible** — once the history is out, it's out. This
checklist is the gate: every box below is either already done (with proof) or
is an explicit user action. Do not flip visibility until every user box is
checked by a human.

## 1. Done in Slice 9 (proof included)

- [x] **LICENSE** — MIT, holder "QueraIS contributors" (repo root).
- [x] **SECURITY.md** — private disclosure path, scope, no-bounty-yet,
      pointer to `docs/SLITHER_TRIAGE.md`.
- [x] **`.gitleaks.toml`** — allowlist contains *only* verifiable public
      constants: the well-known Hardhat dev keys (by exact value) and the
      40-hex contract addresses in deployment manifests (by anchored pattern).
- [x] **Full-history secret scan** — run locally on 2026-06-12 with
      gitleaks 8.24.3 over **all** branches (`--log-opts="--all"`), using the
      repo's `.gitleaks.toml`:

      ```
      12:29AM INF 99 commits scanned.
      12:29AM INF scanned ~1991395 bytes (1.99 MB) in 630ms
      12:29AM INF no leaks found
      (exit code 0)
      ```

      For the record, the raw scan *without* the allowlist finds exactly 7
      matches, all triaged as public constants (nothing rotated, nothing
      rewritten): 3× the `"token":` ERC-20 *contract address* field in
      `packages/contracts/deployments/addresses.arbitrumSepolia.json`
      (40-hex public addresses, Etherscan-verified) and 4× well-known Hardhat
      dev keys in `.env.example` (accounts #0–#3 of the canonical
      "test test … junk" mnemonic — public constants shipped with Hardhat).
- [x] **Gating CI job** — `gitleaks` in `.github/workflows/ci.yml` re-runs the
      same full-history scan (same pinned version, same config) on every push
      and PR; any new finding turns the bar red.

## 2. User actions before the flip (in order)

> The repo is **already public** (flipped by the user) and secret scanning + push
> protection are **enabled** (2026-06-12). This section is retained as the record.

- [x] **Enable GitHub secret scanning + push protection** — enabled 2026-06-12 via
      `gh api -X PATCH repos/ShavitR/querais` (both `secret_scanning` and
      `secret_scanning_push_protection` → `enabled`). Free for public repos.
- [x] **Review this checklist + the scan output above.** If anything in the
      history changes, re-run the scan locally:
      `gitleaks git --log-opts="--all" --config .gitleaks.toml .`
- [x] **Skim the non-code surface** — README, docs/, planning `querais_*.md`
      files — for anything you don't want public. Code is covered by the scan;
      prose is a judgment call only you can make.
- [x] **Flip visibility** — done; the repo is public.

## 3. User actions after the flip (publishing)

`release.yml` **auto-detects** `NPM_TOKEN` / `PYPI_TOKEN`: add the secrets and the next
tag publishes for real; until then every tag is a safe dry-run / build-only rehearsal.
**No workflow edits are needed** — just the secrets.

- [x] **Enable GitHub secret scanning + push protection** — done 2026-06-12 via
      `gh api` (see §2; the repo was already public).
- [ ] **npm**: create the `querais` org/scope on npmjs.com; generate a
      granular **Automation** token (bypasses 2FA in CI); add it as the
      `NPM_TOKEN` repo secret (`gh secret set NPM_TOKEN -R ShavitR/querais`).
      The workflow runs `pnpm publish -r`, which publishes all three public
      packages in topological order — `@querais/contracts` → `@querais/shared`
      → `@querais/sdk` (`@querais/matching` is private, skipped) — and rewrites
      each `workspace:*` range to the real version. (Publishing `shared` without
      `contracts`, which it depends on, would break every install.)
- [ ] **PyPI**: create the `querais` project (or reserve the name); generate a
      project-scoped API token; add it as the `PYPI_TOKEN` repo secret. Trusted
      Publishing (OIDC) is an alternative — register a pending publisher and add
      `id-token: write` perms instead of a long-lived token.
- [ ] **Tag the next version** (e.g. `v0.2.1` — `v0.2.0` is already drafted, and
      npm/PyPI permanently reject re-publishing a version) → the workflow publishes
      the SDKs and opens a fresh draft GitHub Release → review → publish it.
- [ ] **(Optional) Code signing** — Windows EV certificate / Apple Developer
      ID notarization for the release archives. Until then, releases ship with
      `SHA256SUMS` and install docs tell operators to verify checksums.

## 4. Standing policy (post-public)

- New gitleaks finding in CI = treat as a real leak until proven otherwise:
  rotate first, triage second, allowlist only verifiable public constants
  (and never silently — say so in the PR).
- HOT keys (gateway/faucet/admin token) live in Fly secrets only. COLD keys
  (admin/pauser) never leave the operator's machine. See `SECURITY.md`.
