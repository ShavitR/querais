# Slice 9 — DX, node polish & growth: the full plan

> Stage C closer (EXECUTION_PLAN §Slice 9, "Effort L · Risk L"). Slice 8 closed the
> review loop for the operator; Slice 9 closes the distance for everyone else: a
> developer who wants to call the network, an operator who wants to run a node without
> building from source, and the public repo both of them need. Decisions locked with
> the user 2026-06-12: **MIT license**, **prepare + dry-run publishing** (no live npm/
> PyPI push until the user adds tokens), **off-chain signed model manifest** (no new
> contract).

## 1. Context — why this slice exists

The protocol is complete (Slices 0–6), hosted (7), and observable (8) — but it is a
sealed box:

- The repo is **private**, so the "one-liner installer" and every public doc link 404.
  Going public is irreversible and gated on proof, not hope: a full-history secret
  scan, LICENSE, SECURITY.md, and an explicit user sign-off.
- The TS SDK is `private: true` — unpublishable as-is. There is **no Python SDK**, and
  Python is where the LangChain/LlamaIndex demand lives.
- A node operator must clone + `pnpm install` + build the whole workspace. The GTM doc
  promises "setup in 10 minutes"; today it's a developer-tools gauntlet.
- Models are advertised as **bare strings on the honor system** — nothing pins
  `llama3:8b` on node A to the same weights as node B. The architecture doc promised
  SHA256 integrity checks.
- There are **zero disclosures**. Layer-A silently re-runs ~5% of prompts on oracle
  infrastructure; if the first public cheater-catch happens before we disclose that,
  it reads as a cover-up instead of a feature.

What moved OUT of this slice (already decided in EXECUTION_PLAN): the signup portal and
operator dashboard (→ 10B/10C), the docs site (→ 10E). Slice 9 keeps release
engineering, SDK publishing readiness, model integrity, disclosures, the repo-public
gate, and the campaign *materials* (running the campaign is a human job).

## 2. Scope

### In scope

1. **Repo-public gate** — LICENSE (MIT), SECURITY.md, full-history secret scan
   (gitleaks) run locally + recorded, gitleaks CI job, `docs/REPO_PUBLIC_CHECKLIST.md`
   with the user-sign-off items (enable GitHub secret scanning + push protection, flip
   visibility). The flip itself is the user's, never mine.
2. **Disclosures** — `docs/TERMS.md` + `docs/PRIVACY.md` (testnet/no-value framing;
   prompt-privacy: (a) ~5% of prompts re-run on oracle infra for verification, (b)
   prompts/outputs processed in memory, hashes only persisted, (c) anomalies can
   trigger on-chain disputes against providers). Linked **before the first key**: the
   `POST /v1/keys` response carries `terms`/`privacy` URLs, and the dashboard +
   README link them.
3. **TS SDK publish-ready** — drop `private: true`, full npm metadata (license,
   repository, files, publishConfig), README with quickstart, `npm publish --dry-run`
   green in CI. No live publish.
4. **Python SDK (`sdk-python/`)** — `querais` package: `QueraisClient` (chat +
   streaming, models/nodes/stats helpers), `querais.langchain` / `querais.llamaindex`
   integration modules (configured `ChatOpenAI` / `OpenAILike` via optional extras),
   pytest unit tests on a mock transport, ruff clean, `python -m build` green. No live
   publish.
5. **Model manifest with SHA256 verification (off-chain)** — gateway serves
   `GET /v1/models/manifest` (name → sha256 digest, EIP-191-signed by the gateway
   key); daemons report per-model digests in the WS handshake (Ollama `/api/tags`
   digests; deterministic fake digests for MockBackend); when the gateway has a
   manifest entry for a model, a node that reports a missing or mismatched digest has
   that model **dropped from its advertised set** (logged + flagged, never slashed).
   No manifest configured = no enforcement (today's behavior, and what the live Fly
   gateway keeps until the operator opts in).
6. **Prebuilt release artifacts** — esbuild single-file bundle of the node daemon
   (`scripts/bundle-daemon.mjs` → `dist-release/`), per-OS launcher scripts, zip/tar.gz
   + `SHA256SUMS`, a tag-triggered `release.yml` workflow that builds them and attaches
   to a draft GitHub Release, and `docs/NODE_RELEASE_INSTALL.md` (install from release
   in <5 min, no build). Code-signing certs don't exist yet → artifacts are
   checksummed, and the signing path (Windows EV / Apple notarization) is documented
   as a user-side follow-up.
7. **Campaign materials** — `docs/BETA_PLAYBOOK.md`: beta-cohort recruitment script,
   leaderboard campaign mechanics (the leaderboard itself already lives at
   `/v1/nodes`), top-node competition rules from the GTM doc. Running it = operator.
8. **Slice 8 leftover** — remove the `querais_nodes` legacy metric alias (HANDOFF
   says "remove in Slice 9"); update the e2e assertion + OBSERVABILITY.md.

### Out of scope (deliberately)

- **Flipping the repo public, enabling GitHub org settings, creating the npm scope /
  PyPI project, adding publish tokens** — user actions; the checklist names each one.
- **Live npm/PyPI publish** — prepared + dry-run only (user decision 2026-06-12).
- **On-chain model registry contract** — off-chain manifest chosen; revisit if/when
  model identity needs to outlive the gateway.
- **Signed installers with real certs / store distribution** — checksummed archives
  now; signing documented, not performed.
- **Signup portal, operator web dashboard, docs site** — Slice 10B/10C/10E.
- **Upstream LangChain/LlamaIndex partner packages** (`langchain-querais` in their
  monorepos) — our side ships the integration modules; upstream PRs are campaign work.
- **Running the beta campaign** — materials only.

## 3. Architecture

### 3.1 Model manifest — the integrity seam

One new concept: a **model manifest** the gateway owns and daemons verify against.

```
manifest file (operator-authored JSON, path via GATEWAY_MODEL_MANIFEST)
  { "models": { "llama3:8b": { "digest": "sha256:abc…", "note": "…" }, … } }

gateway                                    daemon
  loads + validates file at boot             reads digests from Ollama /api/tags
  GET /v1/models/manifest →                  (MockBackend: deterministic fakes)
    { models, signer, signature }            sends { model, digest } pairs in the
    signature = EIP-191 over the             WS handshake (additive field —
    canonical JSON by the gateway key        old daemons simply omit it)
  handshake enforcement:
    for each advertised model WITH a manifest entry:
      reported digest missing → drop model (log: 'manifest-unverified')
      reported digest ≠ manifest → drop model (log: 'manifest-mismatch')
    models without a manifest entry → untouched (incremental adoption)
    a node left with zero models → handshake refused (nothing to serve)
```

Design properties:

- **No manifest, no change.** The knob is opt-in; the live Fly gateway and every
  existing test run exactly as before until an operator writes a manifest file.
- **Enforcement is exclusion, not punishment.** A digest mismatch drops the model from
  matching and logs it — no slash, no flag-to-dispute. Integrity failures are config
  drift far more often than fraud; the reputation system already handles fraud.
- **The signature makes the manifest portable.** Over TLS the signature is redundant;
  the moment the manifest is mirrored (IPFS, the 10E site, a third-party node script)
  it's the only thing that makes it trustworthy. Daemons verify it against the
  `settler` address they already learn from `/v1/credit/info`.
- **Digests come from Ollama itself** (`/api/tags` reports the content-addressed
  sha256 of each local model) — the daemon never hashes gigabytes on the hot path.

### 3.2 Python SDK shape

```
sdk-python/
  pyproject.toml          # name=querais, httpx dep, [langchain]/[llamaindex] extras
  README.md               # PyPI landing page: 3-line quickstart + OpenAI-compat note
  src/querais/
    __init__.py           # QueraisClient, __version__
    client.py             # chat(), chat_stream(), models(), nodes(), stats()
    langchain.py          # chat_model(...) → langchain_openai.ChatOpenAI (lazy import)
    llamaindex.py         # llm(...) → llama_index OpenAILike (lazy import)
  tests/                  # pytest, httpx.MockTransport — no network, no gateway
```

Principles: the gateway is already OpenAI-compatible, so the client is sugar (exactly
like the TS SDK) — thin, typed, streaming via SSE lines. Integration modules don't
reimplement anything: they return the official LangChain/LlamaIndex OpenAI classes
pointed at the gateway, behind optional extras so `pip install querais` stays light.
Lazy imports + a clear error name the extra to install. Tests for the integrations
skip when the extra isn't installed.

### 3.3 Release artifacts

esbuild bundles `packages/node-daemon/src/main.ts` into one `daemon.mjs` (deps inlined;
`node:*` builtins external). An archive per OS = bundle + launcher (`run-node.ps1` /
`run-node.sh`) + `.env.example` + install doc. `SHA256SUMS` covers every archive.
Operators need **Node ≥ 22.13 and Ollama** — that's the documented floor (same floor CI
already enforces), not a from-source build. Single-binary SEA packaging is deferred:
the win is small next to "no pnpm, no build" and the toolchain cost is real.

`release.yml` triggers on `v*` tags: green bar first, then bundle, archive, checksum,
`npm publish --dry-run` (sdk), `python -m build` (sdk-python), draft GitHub Release
with everything attached. Drafts publish nothing — releases stay invisible until the
user presses the button (and stay irrelevant until the repo is public).

### 3.4 Disclosures & the key path

`docs/TERMS.md` + `docs/PRIVACY.md` are markdown in-repo (canonical home moves to 10E
later; the *content* is the Slice 9 deliverable). The gateway exposes their canonical
URLs in `POST /v1/keys` responses (`{ key, wallet, tier, terms, privacy }`) so no key
is ever issued without the disclosures attached, and the dashboard footer links both.
The privacy text states the three Layer-A facts in the first screen, not a footnote.

### 3.5 Repo-public gate (proof, then sign-off)

- `.gitleaks.toml` (repo-tuned allowlist: well-known Hardhat dev keys — they are
  public constants, every fork has them) + a gitleaks CI job (gating: new finding =
  red).
- One full-history local run (`gitleaks git --log-opts="--all"`) executed during this
  slice; result recorded verbatim in `docs/REPO_PUBLIC_CHECKLIST.md`.
- The checklist separates **done-by-Claude** (LICENSE, SECURITY.md, scan, CI job)
  from **user-only** (enable GitHub secret scanning + push protection, choose the
  public moment, flip visibility — irreversible, npm scope + PyPI project + tokens).

## 4. Work breakdown (one branch `claude/slice-9-dx`, one PR, commits in this order)

Each step ends green: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
(+ `pnpm test:e2e` where marked ⏱; rebuild first — e2e runs `dist/`).

1. **Repo hygiene** — `LICENSE` (MIT, holder "QueraIS contributors"), `SECURITY.md`
   (private disclosure contact = shavitrwork@gmail.com, scope, no-bounty-yet,
   pointer to `docs/SLITHER_TRIAGE.md`), `license: "MIT"` field in every
   `package.json`.
2. **Secret scan + CI** — `.gitleaks.toml`, run gitleaks over all history locally,
   record output in `docs/REPO_PUBLIC_CHECKLIST.md` (created this step, completed in
   step 12), add the `gitleaks` job to `ci.yml` (gating).
3. **Disclosures** — `docs/TERMS.md`, `docs/PRIVACY.md`; `/v1/keys` response gains
   `terms`/`privacy` URLs (+ route test); dashboard footer links; README links.
4. **Metric alias removal** — delete `querais_nodes`, keep `querais_nodes_connected`;
   fix `metrics.test.ts`, the ops e2e assertion, OBSERVABILITY.md reference table.
5. **TS SDK publish-ready** — package.json metadata (no `private`, `publishConfig`,
   `files`, `repository`, `keywords`), `packages/sdk/README.md`, verify
   `npm publish --dry-run` passes locally.
6. **Manifest — gateway** — `model-manifest.ts` (load/validate file, canonical JSON,
   EIP-191 sign, verify helper), `GATEWAY_MODEL_MANIFEST` knob in `config.ts`,
   `GET /v1/models/manifest` route. Unit tests: file validation, signature
   round-trip, route (404 when unconfigured).
7. **Manifest — handshake enforcement** — daemon: digests from `/api/tags` (backend
   interface gains optional `modelDigests()`; Mock/Canned backends return
   deterministic fakes), handshake message gains optional digest map; gateway
   node-pool: drop-on-mismatch/missing per §3.1, refuse a zero-model node. Unit
   tests both sides.
8. **Manifest — daemon self-verify** — daemon fetches `/v1/models/manifest` over
   HTTP at boot (best-effort), verifies the signature against the `settler` from
   `/v1/credit/info`, warns + skips advertising models it can already see won't pass.
   Unit tests with a stubbed fetch.
9. **e2e scenario 18 (⏱)** — harness gains a `modelManifest` option; node with the
   matching digest serves a job; restart gateway with a poisoned manifest → the
   node's model is dropped (`/v1/nodes` shows no models / handshake refused), chat
   returns no-capacity; remove manifest → recovery.
10. **Python SDK** — `sdk-python/` per §3.2; ruff + pytest green locally;
    `python -m build` produces sdist+wheel; root `pnpm` scripts untouched (Python has
    its own toolchain); CI gains a `python-sdk` job (ruff + pytest on 3.11).
11. **Release engineering (⏱ smoke)** — `scripts/bundle-daemon.mjs` (esbuild),
    launchers, archive + `SHA256SUMS` script, `release.yml` (tag-triggered, draft
    release), `docs/NODE_RELEASE_INSTALL.md`; local smoke: bundled daemon boots
    against the e2e harness chain and serves one job.
12. **Docs + campaign + plan bookkeeping** — `docs/BETA_PLAYBOOK.md`; README
    quickstart polish (dev path: key → official `openai` client streaming in <5 min);
    finish `docs/REPO_PUBLIC_CHECKLIST.md`; EXECUTION_PLAN Slice 9 → ✅ pointer to
    this file; HANDOFF brought current (§2/§3/§4/§12/§13).
13. **Full green bar (⏱) + PR** — build, typecheck, lint, test, **18-scenario e2e**,
    push, PR with `--body-file`, user merges.

## 5. Acceptance criteria (from EXECUTION_PLAN, made concrete)

- **Dev <5 min:** README quickstart takes a fresh dev from API key (admin-issued —
  the self-serve portal is 10B) to a streamed completion **via the official `openai`
  package** against `querais-gateway.fly.dev` with no human contact beyond the key.
- **Operator <5 min, no build:** `release.yml` produces archives a fresh machine can
  run with only Node 22 + Ollama installed; the install doc is the only required
  reading; the bundled daemon passes the local smoke (serves a real job).
- **Disclosures before first key:** `POST /v1/keys` cannot answer without
  terms/privacy URLs in the response body (route test enforces it).
- **History scan clean:** the full-history gitleaks run is recorded in the checklist
  with zero unallowlisted findings, and CI keeps it that way (gating job).
- **Model integrity:** with a manifest configured, a node whose model digest doesn't
  match cannot have that model matched (e2e 18); with none configured, behavior is
  bit-identical to Slice 8.
- **SDKs publishable on demand:** `npm publish --dry-run` and `python -m build` both
  green in CI; the only missing inputs are the user's tokens.

## 6. Rollout (after merge — operator steps, kept out of the PR)

1. Walk `docs/REPO_PUBLIC_CHECKLIST.md`: enable GitHub secret scanning + push
   protection → review the recorded scan → **flip the repo public** (irreversible —
   your call alone).
2. Create the npm scope/org for `@querais/*` and the PyPI `querais` project; add
   `NPM_TOKEN` / `PYPI_TOKEN` as repo secrets; re-run `release.yml` on a tag and
   change the dry-runs to real publishes (one-line edits, marked TODO in the
   workflow).
3. Tag `v0.2.0` → review the draft GitHub Release → publish it.
4. (Optional) author a real model manifest for the Fly gateway
   (`fly secrets set GATEWAY_MODEL_MANIFEST=…` after baking the file into the image
   or a volume) once the VM node reports digests.
5. Kick off the beta playbook when ready — it's a human campaign, not a deploy.

## 7. Risks & mitigations

- **The handshake change strands the live VM node** → digest field is optional and
  enforcement only activates with a manifest; the Fly gateway ships without one.
  Re-registering the VM node (already pending user-side) picks up the new daemon.
- **esbuild bundle breaks a dynamic require** (pino transports are the classic) →
  smoke test in step 11 boots the actual bundle and serves a job; pino is configured
  without transport workers in the daemon.
- **gitleaks false-positives on dev keys** → `.gitleaks.toml` allowlists the
  well-known Hardhat constants by hash, not by pattern breadth; anything else found
  is treated as real until proven otherwise (and surfaced to the user, not silently
  allowlisted).
- **Python toolchain absent on the dev machine** → CI is the enforcement surface
  (ubuntu + setup-python); local runs are best-effort and the plan doesn't gate other
  steps on them.
- **Scope creep toward 10B/10E** (portal, docs site) → the boundary is written into
  §2 Out-of-scope; disclosures live as repo markdown until 10E gives them a domain.
- **`npm publish --dry-run` differs from real publish** (auth, scope existence) →
  acknowledged; the checklist's first real publish is supervised by the user with
  tokens present.
