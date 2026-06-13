# QueraIS Website — "10×" Improvement Plan

> **Status:** PLAN — awaiting scope sign-off before building.
> Prepared 2026-06-13 from a full SEO audit of `apps/website` + an inventory of the repo's
> reusable content (the 7 `querais_*.md` whitepapers, README, `docs/`, public gateway endpoints).

## Context

The marketing/docs site (`apps/website`) shipped in Slice 10E as a **minimal but solid static
MVP**: 6 pages (landing, how-it-works, pricing, faq, docs, quickstart), a dark theme, basic root
metadata, and build-time headline numbers. It's **live at https://querais.xyz** (Vercel, static
export). It works — but for an SEO/marketing property it's missing the table-stakes discoverability,
shareability, content depth, and polish. This plan takes it to **best-in-class** while keeping the
resilient, portable static-export architecture and the established slice → PR → green-bar rhythm.

The repo is unusually rich source material: the **7 `querais_*.md` whitepapers** are
spec-grade (100–400 lines each) and publication-ready, and **7 public gateway endpoints**
(`/v1/stats`, `/v1/network/economics`, `/v1/network/recent-jobs`, `/v1/nodes`, `/v1/status`,
`/v1/models`) can feed live numbers at build time.

## Architecture decision: keep `output: 'export'` ✅

Static export delivers ~95% of the wins and stays portable + resilient (a gateway/Vercel issue
can't take it down). What works in static export: `sitemap.ts`, `robots.ts`, `manifest.ts`,
`icon`/favicon, **dynamic OG images via `app/opengraph-image.tsx` (`next/og` — pre-rendered to PNG
at build)**, JSON-LD `<script>`, `next/font`, build-time syntax highlighting (Shiki), analytics.
What it gives up: **ISR** (request-time-fresh numbers — fine; we rebuild on deploy) and **`next/image`
runtime optimization** (use SVG + pre-optimized assets). ISR stays a documented future option.

---

## Phase 1 — Technical SEO foundation (highest ROI, low risk)

Everything search engines + social need to index and render the site well. All in `apps/website`:

- **`app/sitemap.ts`** + **`app/robots.ts`** — every route with lastmod/priority; robots points at the sitemap.
- **`app/manifest.ts`** — PWA manifest (name, `theme_color: #0b0f17`, icons).
- **Brand + icons** — a simple in-house **⚡ QueraIS SVG logo/wordmark** (`app/icon.svg`,
  `app/apple-icon.png`, favicon) and use it in the nav. (No external designer; on-brand with the
  dashboard palette.)
- **Per-page metadata** — add `alternates.canonical`, a `twitter` card (`summary_large_image`), and
  `openGraph.images` to every page; fix the missing metadata on `/docs`.
- **Dynamic OG images** — `app/opengraph-image.tsx` (root) + per-route variants via `next/og`
  `ImageResponse` (pre-rendered at build): branded 1200×630 cards with the page title on the dark theme.
- **Structured data (JSON-LD)** — a small `components/JsonLd.tsx` injecting `Organization` + `WebSite`
  (root), `SoftwareApplication` (home), `FAQPage` (faq), `BreadcrumbList` (nested), `TechArticle` (docs).
- **Typography** — `next/font` (Inter for UI, JetBrains Mono for code), replacing the system stack.
- **Accessibility** — `:focus-visible` rings, a `<main>` landmark + skip-link, aria on the FAQ
  `<details>`, and a contrast bump for `--muted`. Target Lighthouse A11y ~100.

## Phase 2 — Content depth (the whitepapers → SEO-strong pages)

Turn the spec-grade docs into the pages that rank and convert. New routes (source doc in parens):

- **`/tokenomics`** (`querais_token_economics.md`) — fixed 1B supply, **60/20/20** fee split, burn,
  staking tiers, vesting + a live supply/burn widget (build-time `/v1/network/economics`).
- **`/security`** (`reputation` + `smart_contracts` + `protocol`) — the 2 verification layers,
  slashing, dispute flow, the 5 contracts **with the real Sepolia addresses**, and the honest
  trust-model framing (Phase-1 trusted gateway, can't steal deposits).
- **`/for-developers`** (`protocol` + README) — OpenAI drop-in, one-line migration, the SDKs
  (`@querais/sdk`, `querais`), cost calculator, copy-able code samples.
- **`/for-node-operators`** (`node_design` + `overview`) — hardware tiers, an **earnings calculator**,
  the 5-minute setup, profitability at different utilization.
- **`/architecture`** (`protocol_architecture`) — the 7 layers + the job lifecycle, with a diagram.
- **`/docs/api`** (`protocol` + README) — endpoint reference, request/response shapes, auth, sessions.
- **`/roadmap`** (`docs/EXECUTION_PLAN.md`) — slices shipped + what's next (transparency = credibility).
- **`/terms`** + **`/privacy`** — render `docs/TERMS.md` + `docs/PRIVACY.md` as on-site canonical pages
  (footer links go here instead of GitHub).
- **Authoring:** MDX (`@next/mdx`) for the long-form docs; TSX for the marketing pages. **Code blocks:**
  Shiki (build-time highlighting) + a client `CopyButton`. **Internal linking:** "next steps / see also"
  on every page; nav grouped into Product / Developers / Docs.

## Phase 3 — Design polish & conversion

- **Diagrams** — a hand-authored on-brand SVG **job-lifecycle flow** (Request → Match → Serve → Verify
  → Settle) and a **layered-architecture** diagram.
- **Richer hero + sections** — subtle gradient, the live stat strip, a comparison table (vs Akash /
  Bittensor / io.net / Render, from `overview` §6), clearer CTAs.
- **Live network teaser** — a small build-time network panel that links into the live app explorer.
- **Analytics** — privacy-friendly (Vercel Web Analytics, 1 line, or Plausible) tracking the key CTAs
  (Open app / Quickstart / Run a node).
- **Polish** — a styled `not-found.tsx`, light scroll/hover motion, OG/social QA.

---

## Rollout (PRs — established rhythm; each its own green bar + redeploy)

| PR | Scope | Why this order |
|----|-------|----------------|
| **1** | Phase 1 (SEO foundation + brand + a11y) | Smallest, highest-impact, makes everything indexable/shareable immediately |
| **2** | Phase 2a — for-developers · for-node-operators · tokenomics · security + MDX/Shiki/CopyButton | The 4 persona pillars + the docs toolchain |
| **3** | Phase 2b — architecture · docs/api · roadmap · terms/privacy + internal linking | Remaining content + funnel |
| **4** | Phase 3 — diagrams · polish · analytics · comparison · 404 | Brand glow-up + measurement |

The `website` CI job (`next build` + typecheck) gates each. Deploy = rebuild with
`NEXT_PUBLIC_GATEWAY_URL` then `vercel deploy apps/website/out --prod` (or connect the Git repo for
auto-deploy).

## Verification

- `pnpm --filter @querais/website build` green; `out/` contains `sitemap.xml`, `robots.txt`, the OG
  PNGs, and every route.
- Lighthouse SEO/Perf/A11y/Best-Practices ≈ 100; OG via a card validator; JSON-LD via Google's Rich
  Results Test; submit the sitemap in Search Console.

## Open decisions (your call — they shape the build)

1. **How far now** — start with **PR 1 (SEO foundation) alone** (recommended), or go straight into
   content too.
2. **Content breadth** — the **full persona+docs set** above (recommended for "as good as possible"),
   or a focused subset.
3. **Docs authoring** — **MDX** (recommended for long-form) vs all-TSX (no new toolchain).
4. **Analytics** — add **Vercel Web Analytics** (recommended, 1-line, privacy-friendly), Plausible, or none.
5. **Logo** — I author a **simple ⚡ SVG wordmark** (recommended), or you provide a logo.
