# Slice 10 — The web app (Stage D opener)

> **Status:** 10A MERGED (#53), 10B-1 MERGED (#54). **10B-2 BUILT** — wallet/SIWE sign-in +
> the deposit/session/EIP-712 credit flow; green bar passing (21 e2e scenarios) on branch
> `slice-10b2-sessions-wallet`, PR open. 10C–10E not started. (Plan approved 2026-06-13;
> §5 + §10.7 decisions locked.)
> **Author:** prepared 2026-06-13 from the verified repo state (Slices 0–9 merged). This is
> the planning doc; it becomes the as-built record as increments land (the `Slice8.md` /
> `Slice9.md` convention).

---

## 0. Why this is next (the decision is already made)

`docs/EXECUTION_PLAN.md` ends Stage C and opens **Stage D** with Slice 10. Both the plan and
`HANDOFF.md §13.6` name it as the next code-side work:

- Stage A (foundation), Stage B (protocol depth), Stage C (operate) are **complete** — Slices
  0–9 are merged to `main` (PR trail #1 → … → #40, plus release/docs PRs #42–#47).
- The protocol now has sessions, a 5-dimension reputation score, Layer-A sampling, FAST-track
  disputes, treasury burns, and staking rewards — **and no human can see any of it.** Today's
  "frontend" is `packages/gateway/src/routes/dashboard.ts`: a 124-line inline-HTML page that
  polls `/v1/stats` + `/v1/nodes` and offers one prompt box. `apps/dashboard/` is an **empty
  placeholder** (`package.json` only, dev script literally prints "Vite app lands in M6").
- A real frontend **multiplies the value of every prior slice** and is the adoption
  bottleneck for the Slice 9 growth push. That is the EXECUTION_PLAN's stated rationale for
  ordering the web app first in Stage D, ahead of arbitration (11), scale (12), and the
  mainnet gate (13).

**The remaining Slice 9 work is operator-side, not code-side** (repo-public flip, npm/PyPI
tokens — though #42–#47 show publishing is now live; tag/release mechanics). Nothing there
blocks Slice 10.

---

## 1. Shape of Slice 10 (one product, five shippable increments)

Per `EXECUTION_PLAN.md` Slice 10, the web app ships as 10A–10E. **10A is the foundation;
10B/10C/10D are independent once 10A lands; 10E is fully independent.** Each is its own
branch + PR + green bar, following the established rhythm (HANDOFF §2).

| Inc. | Title | Effort | Auth surface | Depends on |
|------|-------|--------|--------------|------------|
| **10A** | Foundation: real app + auth + served-by-gateway | M | sign-in seam | — (this PR first) |
| 10B | Requester console (playground, keys/usage, jobs, **sessions+EIP-712**) | M | API key + requester wallet | 10A |
| 10C | Operator console + admin review queue | M | node wallet + admin | 10A (+ Slice 8 ✓) |
| 10D | Network explorer (live, unauthenticated) | S | none | 10A (+ 6A ✓) |
| 10E | Marketing & docs site (**separate Next.js app**, SEO surface) | M | none | nothing hard |

**The boundary rule (decided in EXECUTION_PLAN, restated so we don't re-litigate it):**
- Pages a **signed-in human or live data** needs → the **Vite app** (10A–10D), **served by
  the gateway** at same-origin (no CORS, no second server — Slice 7's single-instance model
  holds).
- Pages a **crawler** should index → a **separate Next.js static/ISR site** (10E), deployed
  off the gateway (Vercel/CDN), fetching public read-only endpoints at build/revalidate time.
  If 10E goes down the protocol doesn't notice; it never touches the money path.
- Litmus test for an ambiguous page: *does it need a wallet, a key, or a WebSocket?* yes ⇒
  app, no ⇒ site.

**This plan is build-ready for 10A** (the immediate next PR) and forward-sketches 10B–10E so
the architecture chosen in 10A doesn't paint them into a corner.

---

## 2. Verified ground truth (what 10A builds on / against)

Confirmed by reading the current `main` (not assumed):

**Gateway server (`packages/gateway/src/server.ts`)**
- Fastify app built at `server.ts:315` (`bodyLimit: 5MB`, no logger). Plugins: `@fastify/websocket`
  (`:429`), `@fastify/rate-limit` (`:432`). **`@fastify/static` is NOT a dependency** —
  static serving must be added.
- Route registration block at `:480–:493`. Infra routes at `:443–:478`: `/node` (WS),
  `/health`, `/ready`, `/metrics` — all opt out of rate limiting via `noLimit`.
- `registerDashboard(app, deps)` at `:488` owns `GET /` (the inline HTML to retire).

**Auth (`packages/gateway/src/auth.ts`, `key-store.ts`)**
- Today: **API-key bearer only.** `resolveRequester()` reads `Authorization: Bearer <key>` →
  `ApiKeyStore.get()` → wallet `Address`. **No SIWE / wallet-signature / nonce / session
  cookie exists.** (auth.ts comment: "wallet-signature mode is deferred".)
- Admin routes gate on header **`x-admin-token` == `config.adminToken`** (exact compare):
  `routes/keys.ts`, `routes/flags.ts`, `routes/alerts-admin.ts`, `routes/incentives.ts`.
- `ApiKeyStore.issue(wallet, tier)` mints `sk-querais-<hex>` (DB-backed).

**Read-only data routes the app will consume (shapes verified):**
- `GET /v1/stats` → `{ nodes, models[], treasury{address,balanceQais}, jobs{created,settled,failed,tokensServed} }`
- `GET /v1/nodes` → `{ object:'list', data:[{ wallet, nodeId, reputation, dimensions{accuracy,uptime,latency,longevity,stake}, flags, claimableRewardsWei, jobsServed, models[{model,pricePerTokenWei,tokensPerSecond}] }] }`
- `GET /v1/jobs/:id` → full job record (status, requester, provider, tokens, settlement, model, providerPay, protocolFee, …)
- `GET /v1/usage` → `{ wallet, jobsServed, tokensServed, qaisSpentWei }` **(bearer auth)**
- `GET /v1/sessions` → `{ requester, settler, session|null, spentAgainstWei, creditBalanceWei, pendingDebitsWei, pendingCount }` **(bearer auth)**
- `GET /v1/credit/info` → `{ chainId, creditAccount, token, settler }`
- `GET /v1/status` → `{ status, nodes, rpcOk, jobs24h, lastSettlementAgeSeconds, uptimeSeconds, openIncidents }` (5s cache)
- `GET /v1/models` → OpenAI-shaped model list; `GET /v1/models/manifest` → signed manifest (404 if unset)
- Admin: `GET /v1/admin/flags`, `POST /v1/admin/flags/:id/review`, `GET /v1/admin/incentives`, `POST /v1/admin/alerts/test`

**Live updates:** none today beyond the `/node` operator WS and chat SSE. The inline
dashboard **polls every 2s**. 10A will keep polling (simplest correct thing); a read-only
push channel is an optional later optimization, not a 10A requirement.

**Build & CI:**
- Root `build` = `pnpm -r --filter "./packages/**" build` — **note: `apps/**` is NOT built
  today.** Wiring the Vite build into the green bar is part of 10A (see §3.6).
- Gateway build = `tsc -b` → `dist/`. `pnpm-workspace.yaml` already includes `apps/*`.
- e2e harness (`packages/test-e2e/src/harness.ts`) does `buildGateway(...)` → `app.listen({port:0})`;
  **no served-app smoke check exists today** — 10A adds one.

**Single-instance invariant (load-bearing, do not break):** `node:sqlite` is single-writer
and all gateway timers assume one owner (HANDOFF §6, Slice 7). The app is served **by that
one gateway, same-origin** — there is no second app server. 10E's Next.js site is the only
other deployable, and it has no server and no gateway access.

---

## 3. Slice 10A — Foundation (the immediate next PR, build-ready)

**Goal (from EXECUTION_PLAN 10A):** stand up the actual Vite + React + TS app in
`apps/dashboard`, served by the gateway at `/`, retire the inline HTML in the **same PR**,
add an auth/sign-in seam, a typed data client over `/v1/*`, and fold the app's
build/typecheck/lint into the green bar plus an e2e served-app smoke.

### 3.1 The app (`apps/dashboard`)
- **Vite + React + TypeScript.** Dark theme matching the current page's palette
  (`#0b0f17` bg, `#111726` cards, `#2563eb` accent — lift the existing CSS variables so the
  look is continuous). A **small in-repo component kit** (Card, StatRow, Table, Badge, simple
  SVG/canvas chart) — **no heavyweight UI framework**, per the slice. Charts: hand-rolled SVG
  or one tiny dependency (decision §5.4).
- Routing: a lightweight client router (React Router or a ~30-line hash/history switch). 10A
  ships only the **shell + a landing/overview view** that renders `/v1/stats` + `/v1/nodes`
  (parity with today's page) behind the new component kit — proving the pipeline end-to-end.
  10B/10C/10D fill in the real consoles.
- **Typed data layer:** a `src/api/` client with one typed function per `/v1/*` route this
  slice touches, returning the shapes in §2. Single source of truth for response types
  (hand-written to mirror the routes; the gateway has no OpenAPI emit and adding one is out
  of scope for 10A).

### 3.2 Served by the gateway (retire the inline dashboard)
- Add **`@fastify/static`** to `packages/gateway` deps; register it to serve the app's built
  `dist/` at `/` (SPA fallback: unknown non-`/v1`, non-infra paths → `index.html`).
- **`registerDashboard` is deleted** and its `:488` call removed — one frontend, not two.
  The inline `routes/dashboard.ts` file is removed (or gutted to the static registration).
- **Infra + API routes are untouched and take precedence:** `/v1/*`, `/health`, `/ready`,
  `/metrics`, `/status`, `/node` must still resolve before the SPA catch-all. Register static
  **after** the API routes, scope the fallback to exclude those prefixes.
- **Asset resolution:** the gateway needs the app's `dist/` at runtime. Resolve it via a
  configurable path (`GATEWAY_DASHBOARD_DIR`, default = the workspace
  `apps/dashboard/dist` resolved relative to the gateway package). If the directory is
  **absent, the gateway still boots** and serves a tiny built-in fallback at `/` (so a
  gateway-only build / the Fly image without the app never 500s) — this preserves the
  "gateway is the money path, the app is cosmetic" separation.

### 3.3 Auth / sign-in seam
The slice's stated auth model: **sign in with an API key (requester) OR a wallet signature
(node operator / requester wallet, SIWE-style nonce verified gateway-side); read-only public
mode with no sign-in; the key never sits in `localStorage` in plaintext — a session cookie is
minted by the gateway.**

This is **net-new server surface** (today is bearer-only). Two honest options on *how much*
of it lands in 10A — see the open decision in §5.2. The plan is written for the **recommended
split**: ship the **API-key → session-cookie** path + **read-only public mode** in 10A, and
**defer SIWE/wallet sign-in to 10B/10C**, where a connected wallet is already required (10B
signs the EIP-712 spending cap; 10C is wallet-gated to a node's own data). Rationale: 10A
stays a tight, reviewable foundation PR; we don't build a signature-recovery + nonce-store
auth path one increment before the wallet is actually present.

**10A auth, concretely (recommended split):**
- `POST /v1/auth/session` — body `{ apiKey }`; gateway validates via `ApiKeyStore.get()`,
  mints a signed, httpOnly, SameSite=strict session cookie (HMAC over `{wallet, exp}` with a
  gateway secret; **stateless — no new DB table**, consistent with the thin-DB rule). Returns
  `{ wallet, tier }`.
- `GET /v1/auth/me` — returns the cookie's `{ wallet, tier }` or 401.
- `POST /v1/auth/logout` — clears the cookie.
- Existing `Authorization: Bearer` continues to work unchanged (SDK/CLI/curl). The cookie is
  an **additional** accepted credential on read routes the app calls (`/v1/usage`,
  `/v1/sessions`), resolved by extending `resolveRequester()` to also read the cookie. Bearer
  still wins if both are present.
- **Read-only public mode:** the overview/explorer views need no sign-in (they hit public
  `/v1/stats`, `/v1/nodes`, `/v1/status`).
- Wallet/SIWE sign-in lands in 10B (`POST /v1/auth/nonce` + `POST /v1/auth/wallet` verifying
  an EIP-191 personal-sign over the nonce) — designed now so the cookie format is wallet-shaped
  from day one (the cookie already carries a `wallet`, so SIWE just mints the same cookie via a
  different proof).

### 3.4 Config additions (`gateway/src/config.ts`)
All optional, defaulted, env-overridable (the `HARDENING_DEFAULTS` pattern):
- `GATEWAY_DASHBOARD_DIR` — path to the app's built `dist/` (default: resolved workspace path).
- `GATEWAY_SESSION_SECRET` — HMAC key for the session cookie (default: derived from the
  gateway private key so dev/e2e need no extra env; production sets it explicitly).
- `GATEWAY_SESSION_TTL_SECONDS` — cookie lifetime (default 86400).

### 3.5 What 10A explicitly does NOT do (kept for later increments)
- No playground/keys/jobs/sessions consoles (10B), no operator/admin views (10C), no live
  explorer leaderboard (10D), no Next.js site (10E), no SIWE (10B), no push/WS live channel
  (optional later). 10A is the **shell + auth seam + serving + green-bar wiring** only.

### 3.6 Green-bar wiring (the part that's easy to underestimate)
- Add `apps/dashboard` to the build so `pnpm build` produces `apps/dashboard/dist`. Options:
  widen the root `build` filter to include `apps/**`, **or** add an explicit
  `pnpm --filter @querais/dashboard build` step ordered **before** the gateway in CI. The app
  build must not block the protocol packages' build/test (keep it a separate, parallelizable
  step). Decision §5.3.
- `apps/dashboard` gets its own `typecheck` + `lint` (ESLint flat config extended to the app;
  Prettier already covers it). CI `lint`/`typecheck` must include it.
- **e2e served-app smoke (the slice's acceptance hook):** the harness already starts the
  gateway; add a check that `GET /` returns the built app's HTML shell (asserting a known
  marker, e.g. the app's root div / a `<title>`), and that a static asset 200s. Cheap, proves
  "the gateway serves the app." Bumps the e2e scenario count (currently 18) — the doc/test
  counters in HANDOFF §12 update with it.
- **CI cost awareness:** the Vite build adds a step; keep it incremental and cached where the
  runner allows (the user is cost-aware about CI churn — HANDOFF §11).

### 3.7 10A acceptance (from EXECUTION_PLAN, made concrete)
1. `pnpm build` produces `apps/dashboard/dist`; `pnpm --filter @querais/gateway start` serves
   the real app at `/`.
2. The **old inline page is gone** (`registerDashboard` deleted; one frontend).
3. Sign-in works with an **API key** (cookie minted, `/v1/auth/me` returns the wallet);
   read-only public mode renders stats/nodes with no sign-in. *(Wallet/SIWE sign-in: 10B —
   see §5.2 if the user wants it in 10A.)*
4. The green bar (`build · typecheck · lint · test · test:e2e`) includes the app and **stays
   green**; e2e gains the served-app smoke.
5. Infra/API routes (`/health`, `/ready`, `/metrics`, `/v1/*`, `/node`) are byte-for-byte
   unaffected; a gateway built without the app still boots (fallback `/`).

---

## 4. Forward sketch — 10B / 10C / 10D / 10E (not built yet, scoped so 10A doesn't block them)

- **10B — Requester console.** Split into two PRs:
  - **10B-1 — BUILT (`slice-10b-requester-console`):** hash router + nav, **Playground**
    (model picker, streamed output, best-effort per-request cost from the usage delta), **Jobs
    explorer** (`GET /v1/jobs` list + Arbiscan provider links), **Usage** (settled totals +
    tier). All over the **existing API-key session cookie** — no new wallet/contract surface.
    Gateway: `/v1/chat/completions` + `GET /v1/jobs` now accept the cookie (Bearer still wins);
    `QuotaEnforcer.checkWithTier` runs the cookie's tier; `JobStore.listForRequester`. 20th e2e
    scenario (`runRequesterConsoleCase`: cookie-auth chat + jobs list). *Follow-ups noted:*
    per-job **venue** (batched vs escrow) and **settlement-tx** links want extra persistence
    (not stored today) — deferred; the jobs list shows status/tokens/95-5 split/provider.
  - **10B-2 — NOT STARTED (the flagship, its own PR, confirm before building):** **SIWE wallet
    sign-in** (§3.3) + the **deposit → sign the EIP-712 spending cap in the browser wallet →
    live cap-spend / headroom / pending debits from `GET /v1/sessions` → withdraw** flow. This
    is what finally makes Slice 2 demoable to a human. *Acceptance:* deposit → session → 10
    streamed completions → see the single `batchSettle` land, entirely in the UI.
- **10C — Operator console + admin review queue:** wallet-gated node view (earnings, the
  **5-dimension reputation breakdown** with history from `reputation_snapshots`, TTFT trend,
  stake, flags against the node, **dispute counter-evidence deadline countdown** — 5B's 24h
  window is unusable without a UI); admin-gated **review queue** over `node_flags` +
  `layer_a_checks` (hashes/scores only — **never prompt text**, the privacy rule) with
  mark-reviewed + raise-dispute. This is the UI for Slice 8's notification loop.
- **10D — Network explorer (live, unauthenticated, Effort S):** live stats, **node
  leaderboard** (composite + dimensions — also the Slice 9 leaderboard campaign artifact),
  recent-jobs ticker (job hashes + models only — privacy), **token-economics panel** (fees
  collected/burned/staker pool from the 6A treasury; render zeros gracefully if absent),
  status indicator, the **"testnet, no real value" banner** on every page. Live data belongs
  in the app, not 10E.
- **10E — Marketing & docs site (separate Next.js app `apps/website`, SEO surface):**
  statically rendered / ISR, deployed off the gateway (Vercel/CDN), landing + how-it-works +
  pricing/calculator + FAQ + **the docs site absorbed as MDX** (quickstart, migration, API
  reference — the Slice 9 docs requirement lands here). Headline numbers fetched at
  build/revalidate from public read-only endpoints (no client-side gateway calls, no CORS).
  Disclosures (ToS, prompt-privacy incl. Layer-A sampling, testnet framing) live here
  canonically; the app links to them. Signup CTA deep-links into the app (`app.…/signup`).

---

## 5. Decisions — LOCKED (confirmed with the user 2026-06-13)

### 5.1 First-PR scope — ✅ **10A alone**
Shell + serve-by-gateway + retire inline dashboard + auth seam + green-bar wiring, following
the one-slice-per-PR rhythm. 10B/10C/10D/10E follow as separate PRs. (10D not bundled.)

### 5.2 Auth in 10A — ✅ **API-key → session-cookie + read-only public mode; SIWE deferred to 10B**
10A ships the API-key → gateway-minted session-cookie path (§3.3) and the no-sign-in public
mode. Wallet/SIWE sign-in lands in **10B**, where the wallet is already connected for EIP-712
signing. The cookie is wallet-shaped from day one so 10B's SIWE just mints the same cookie via
a different proof. (This intentionally relaxes the EXECUTION_PLAN's literal 10A "sign in with a
wallet" line to 10B — noted as a deliberate, user-approved deviation.)

### 5.3 Build/serve wiring — ✅ **`@fastify/static` + separate ordered Vite build step**
Standard plugin for serving; the app build is a separate CI step that does not gate the
protocol packages; the gateway resolves `dist/` at runtime with a graceful fallback if absent
(§3.2). (My recommendation; taken.)

### 5.4 Chart/UI footprint — ✅ **hand-rolled SVG in the in-repo component kit, zero UI deps**
Matches "no heavyweight framework." Revisit a tiny charting dep only if 10B/10C need richer
charts. (My recommendation; taken.)

---

## 6. Design rules that MUST hold (carry-over, do not "fix")

- **One gateway instance, same-origin app** — never add a second app server; `node:sqlite` is
  single-writer and the timers assume one owner (HANDOFF §6, Slice 7). The Next.js site (10E)
  is the only other deployable and never touches the money path.
- **The gateway is the money path; the app is cosmetic** — a missing/broken app build must
  never stop the gateway from booting and settling (the §3.2 fallback enforces this).
- **Privacy:** the UI shows **hashes/scores, never prompt or output text** for flags/jobs
  (the Layer-A privacy rule — HANDOFF §6). Recent-jobs/explorer show job hashes + models only.
- **Thin DB:** auth sessions are **stateless signed cookies**, not a new table; usage/quota
  stay **derived** from job rows. No counter/session tables added for the UI.
- **Additive via existing seams:** the app consumes the existing `/v1/*` routes; new auth
  routes extend `resolveRequester`, they don't replace bearer auth (SDK/CLI keep working).
- **Green bar is the gate:** `build · typecheck · lint · test · test:e2e` (now incl. the app)
  must be green; **rebuild before `test:e2e`** (it runs `dist/` — HANDOFF §8); `prettier
  --write .` then `pnpm lint` before committing.
- **Money-moving / outward changes need sign-off** — 10A moves no money and ships no contract,
  so it proceeds on approval of this plan; 10B's deposit/EIP-712 flow and any contract work in
  Slice 11 get explicit design sign-off per the standing rule (HANDOFF §11).

---

## 7. Working rhythm for this slice

Branch `slice-10a-app-foundation` → build → green bar → PR → **CI green → you approve the
merge** (the permission classifier blocks self-merge; a short "yes" authorizes
`gh pr merge --squash --delete-branch`). Pause for review at the 10A boundary before 10B.
Keep this file updated to an as-built record as each increment lands.

---

## 8. As-built record — 10A (branch `slice-10a-app-foundation`)

**Resolved housekeeping:** the separate workstream that was uncommitted at plan time
(node-daemon `:latest` model-name tolerance + SDK polish) **landed on `main` as PR #48**
(with #49–#52) while planning — so 10A branched from a clean tree; the §8 concern is moot.

**What shipped:**
- `apps/dashboard/` — real **Vite 6 + React 18 + TS** app. Component kit (`components/kit.tsx`:
  Card/StatRow/Table/Badge/Bars), typed `/v1/*` client (`api/`), `usePoll` polling hook,
  API-key sign-in (`auth/session.tsx` + `components/SignIn.tsx`), and the read-only **Overview**
  (network stats + node leaderboard with the 5-dimension breakdown + per-account usage when
  signed in). Dark theme carried over from the retired inline page. Own toolchain
  (vite/tsc/eslint), its own `eslint.config.js` (the repo-root config ignores this tree).
- **Gateway** — `@fastify/static` serves the built app at `/` (`routes/static-app.ts`, SPA
  fallback that excludes `/v1`·`/node`·`/health`·`/ready`·`/metrics`·`/status` and keeps the
  JSON 404 for API misses; **boot-safe fallback page** if `dist/` is absent). The inline
  `routes/dashboard.ts` is **deleted**. `@fastify/cookie` + `session.ts` (`SessionAuth`, stateless
  HMAC cookie, wallet-shaped for 10B) back `routes/auth.ts` (`POST /v1/auth/session`,
  `GET /v1/auth/me`, `POST /v1/auth/logout`); `resolveRequesterOrSession` lets the cookie
  authenticate `GET /v1/usage` + `GET /v1/sessions` (bearer still wins). Config:
  `GATEWAY_DASHBOARD_DIR`, `GATEWAY_SESSION_SECRET` (defaults to a digest of the gateway key),
  `GATEWAY_SESSION_TTL_SECONDS`.
- **Green-bar wiring** — root `build`/`typecheck`/`lint` extended to include the app; new
  19th e2e scenario `runServedAppCase` (serves `/`, the hashed asset, SPA deep-link fallback,
  API coexistence + JSON 404, and the API-key → cookie → `/v1/auth/me` + `/v1/usage` flow).
  4 new `session.test.ts` unit tests.

**Green bar (local, full):** build · typecheck · lint · test (gateway 165) · test:e2e (19
scenarios) all pass.

**Deferred to follow-ups (noted, not silently dropped):** the production **Dockerfile** /
self-hosted gateway image must include `apps/dashboard/dist` (or set `GATEWAY_DASHBOARD_DIR`)
for the live gateway to serve the app — the gateway boots fine without it (fallback page), so
this is a deploy-time follow-up, not a 10A blocker. The chat **playground**, keys/jobs/sessions
consoles (10B), operator/admin (10C), live explorer (10D), and the Next.js site (10E) are their
own PRs.

> The working tree also carries an unrelated local edit to `start-gateway-sepolia.ps1` (an
> operator helper, a public dev-key mapping) made by a parallel session — deliberately **left
> unstaged**, not part of the 10A commit.

---

## 9. As-built record — 10B-1 (merged, PR #54 → main `7b87d82`)

The requester console over the 10A session cookie — **no new wallet/contract surface**.
- **App:** hash router + nav (`useHashRoute`); **Playground** (model picker, streamed output,
  best-effort per-request cost from the usage delta); **Jobs explorer** (`GET /v1/jobs` list +
  Arbiscan provider links); **Usage** (settled totals + tier); shared `lib/format`; client
  additions (`getJobs`/`getModels`/`getCreditInfo`/`streamChat` — the last surfaces the in-band
  SSE error frame like the SDK).
- **Gateway:** `/v1/chat/completions` + new `GET /v1/jobs` accept the cookie (Bearer wins);
  `QuotaEnforcer.checkWithTier` (cookie tier, per-wallet consumption); `JobStore.listForRequester`.
- **Green bar:** build/typecheck/lint/test (gateway 165) + **20 e2e scenarios**
  (`runRequesterConsoleCase`). **Follow-up:** per-job venue + settlement-tx links need extra
  persistence (not stored) — deferred.

---

## 10. Build-ready plan — 10B-2 (the wallet + EIP-712 sessions flagship)

> **Status:** PLAN — awaiting user sign-off before any build (money-adjacent: browser wallet
> signing of an EIP-712 spending cap). Grounded in the verified contract/route surface below.

**Goal (EXECUTION_PLAN 10B flagship):** make Slice 2 — batched session-deposit settlement —
demoable to a human entirely in the UI. A requester connects a browser wallet, **deposits**
QAIS into `CreditAccount`, **signs ONE EIP-712 spending cap**, fires streamed completions that
batch-settle with **zero per-call wallet txs**, watches **cap-spend / headroom / pending debits**
live, and **withdraws-after-notice**.

### 10.2 Verified ground truth (what this builds on)
- **EIP-712 cap** (`shared/src/spending-cap.ts`, mirrors `CreditAccount.sol`): struct
  `SpendingCap { requester, settler, maxSpendWei, nonce, deadline }`, domain
  `EIP712("QueraIS CreditAccount","1", chainId, creditAccount)`, types `SPENDING_CAP_TYPES`.
  Helpers `signSpendingCap`, `toSignedSpendingCapWire` are pure and browser-safe (viem).
- **CreditAccount.sol**: `deposit(uint256 amount)` (needs a prior QAIS `approve(creditAccount, amount)`),
  `initiateWithdrawal()` then `completeWithdrawal()` after the on-chain notice delay.
- **Gateway routes (exist):** `GET /v1/credit/info` → `{ chainId, creditAccount, token, settler }`;
  `POST /v1/sessions` registers a signed cap (validates `cap.requester == authed wallet`,
  `cap.settler == gateway`, deadline future, recovers signer == requester) — **today bearer-only**;
  `GET /v1/sessions` → live `{ session, spentAgainstWei, creditBalanceWei, pendingDebitsWei,
  pendingCount, … }` (already cookie-aware from 10A).

### 10.3 Gateway work (small, additive)
1. **SIWE wallet sign-in** (new, mints the SAME 10A cookie via a signature proof):
   - `POST /v1/auth/nonce` → a **stateless** nonce (HMAC over `{addr, exp}`, no DB — thin-DB rule).
   - `POST /v1/auth/wallet` `{ address, signature }` → verify an EIP-191 `personal_sign` over the
     nonce message (viem `verifyMessage`, already a gateway dep), then `deps.session.mint(addr, 'free')`
     and set the cookie. The cookie is already wallet-shaped (10A), so `/v1/auth/me` is unchanged.
   - Tier for a pure-wallet principal defaults to `free` (no API key); a wallet that also owns a
     key keeps its key tier when signing in by key. (Document the choice.)
2. **`POST /v1/sessions` accepts the cookie** (extend with `resolveRequesterOrSession`, like
   `GET /v1/sessions`/`/v1/usage`/chat) so a wallet-signed-in user can register their cap. Bearer
   still wins. The existing `cap.requester == requester` check already binds the cap to the signer.
3. No contract changes, no migrations.

### 10.4 App work (`apps/dashboard`)
- **Add `viem`** as an app dependency (the only web3 lib; tree-shaken). A `lib/wallet.ts`
  wraps `window.ethereum` (EIP-1193) into a viem Wallet/Account: connect, `signTypedData` (cap),
  `signMessage` (SIWE), `writeContract` (approve/deposit/withdraw), chain-guard (prompt to switch
  to the deployment's `chainId` from `/v1/credit/info`). Graceful **no-wallet** state (link to a
  wallet; the rest of the app is unaffected).
- **Wallet sign-in** in `SignIn` (a second button next to API-key): connect → `/v1/auth/nonce`
  → `signMessage` → `/v1/auth/wallet`. Reuses the existing session context unchanged.
- **Sessions & credit view** (`views/Sessions.tsx`, new nav entry "credit"):
  - **Deposit:** amount input → `approve` (if needed) → `deposit(amount)` (two txs, with a
    progress/receipt UI). Reads balance/allowance via viem from `token`/`creditAccount`.
  - **Open session:** pick `maxSpend` + `deadline` → build the cap (`shared` helper) →
    **`signTypedData` in the wallet** → `POST /v1/sessions`. One signature, no gas.
  - **Live status:** poll `GET /v1/sessions` → cap spent / **remaining** / headroom / pending
    debits / credit balance (the math already lives server-side in `buildSessionStatus`).
  - **Withdraw:** `initiateWithdrawal()` → countdown to `completeWithdrawal()` (notice from chain).
- **Playground integration:** when a session is active, the cost readout notes "batched (0 gas)".

### 10.5 Acceptance (EXECUTION_PLAN 10B)
A new user goes **deposit → session → 10 streamed completions → sees the single `batchSettle`
land**, entirely in the UI, no CLI. Plus: wallet sign-in works; withdraw-after-notice completes.

### 10.6 Tests / green bar
- e2e: a 21st scenario driving the **SIWE handshake** (nonce → sign → cookie) and **`POST /v1/sessions`
  via the cookie** with a programmatically-signed cap (viem account in the harness, no browser),
  then a batched completion settles — reusing the existing batched-settlement assertions.
- Browser wallet calls (`window.ethereum`) aren't unit-testable headlessly; the **gateway** side
  (SIWE verify, cookie-authed `POST /v1/sessions`) gets full e2e + unit coverage; the **client**
  wallet wrapper is kept thin and typed.

### 10.7 Decisions — LOCKED (confirmed 2026-06-13)
1. **SIWE message format — ✅ Full EIP-4361** ("Sign-In with Ethereum"). Built with `viem/siwe`
   (`createSiweMessage` in the app, `parseSiweMessage` + signature recover on the gateway —
   viem ≥2.17 ships these; the repo's viem 2.52 has them). The nonce is a stateless,
   alphanumeric, expiry-bound HMAC token (`gateway/src/siwe.ts`) — no nonce table (thin-DB);
   documented 5-min replay window is the accepted testnet trade-off.
2. **Wallet-principal tier — ✅ `free`** (pure-wallet sign-ins; revisit with 10C operator auth).
3. **viem in the browser — ✅ the app's one web3 dep**, plus **`@querais/shared`** for the
   spending-cap helpers + ABIs (no re-deriving the EIP-712 surface).

### 10.8 Design rules that hold
Same-origin/cookie auth (no CORS); **no private keys or signatures persisted** (the cap signature
is stored as the session authorization, exactly as the SDK already does via `POST /v1/sessions`);
the gateway only ever settles at the signed cap (on-chain enforced); pause leaves withdrawal/exit
open (Slice 6 rule). Money-moving in the browser → this plan gets your sign-off before any code.

### 10.9 As-built record — 10B-2 (branch `slice-10b2-sessions-wallet`)
- **Gateway:** EIP-4361 SIWE — `SessionAuth.siweNonce`/`verifySiweNonce` (stateless expiry-bound
  HMAC, EIP-4361-valid) + `POST /v1/auth/nonce` and `POST /v1/auth/wallet` (`viem/siwe`
  `parseSiweMessage`/`validateSiweMessage` + `recoverMessageAddress`, chain-bound, mints the
  same cookie, tier `free`). `POST /v1/sessions` accepts the cookie. 4 SIWE unit tests.
- **App:** `viem` added; `lib/contracts.ts` (inlined ERC-20 + CreditAccount ABIs + the EIP-712
  cap type/domain — kept identical to `shared/spending-cap.ts`); `lib/wallet.ts` (EIP-1193
  connect / chain-guard / SIWE-sign / cap-sign / deposit+approve / withdraw / reads); wallet
  "connect" in `SignIn`; `views/Sessions.tsx` (credit account + active session status from
  `GET /v1/sessions`, deposit → sign-cap → live status → withdraw-after-notice); `credit` nav.
- **Bug fixed in passing (real, not test-only): `forceCloseConnections: true`** on the Fastify
  server. The bigger viem app bundle shifted the keep-alive connection lifecycle enough that
  `app.close()` waited indefinitely on an idle pooled socket (Fastify's default never force-closes
  it) — stalling graceful shutdown / e2e teardown past the drain window. Forcing idle sockets shut
  lets `close()` complete and the onClose **debit-flush still runs** (graceful-shutdown e2e still
  green). Diagnosed via per-step harness instrumentation; a latent shutdown-robustness gap, now closed.
- **21st e2e scenario** (`runWalletSessionCase`): SIWE nonce → sign → cookie; a foreign-wallet
  signature → 401; the cookie registers a browser-signed cap via `POST /v1/sessions`; live status
  reflects it. **Green bar:** build/typecheck/lint/test (gateway 167) + **21 e2e scenarios** pass.
- **Browser wallet UI** (`window.ethereum` deposit/sign/withdraw) isn't headless-testable, so the
  gateway side is fully covered by e2e/unit and the client wallet wrapper is kept thin + typed.
