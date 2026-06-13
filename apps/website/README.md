# @querais/website

The QueraIS marketing + docs site — **Next.js (App Router), static export** — the SEO surface on
the root **`querais.xyz`**. Deployed **off the gateway**; a gateway outage never affects it, and a
website outage never affects the protocol. The signed-in app + live data live on the gateway at
`gateway.querais.xyz` (Slice 10A–10D); this site only links into it.

## Develop

```bash
pnpm --filter @querais/website dev    # http://localhost:3000
```

## Build (static export → `apps/website/out/`)

```bash
pnpm --filter @querais/website build
```

## Headline numbers

The landing page bakes live numbers (nodes, jobs, $QAIS burned) at **build time**, and only when
`NEXT_PUBLIC_GATEWAY_URL` is set — otherwise it shows dashes (so CI builds stay hermetic). For the
real deploy:

```bash
NEXT_PUBLIC_GATEWAY_URL=https://gateway.querais.xyz pnpm --filter @querais/website build
```

The fetch is build-time only, with a fallback — there are **no client-side gateway calls** (no
CORS), so the site is fully static and resilient.

## Deploy (operator)

The static `out/` deploys to any CDN or to Vercel on the root domain:

- **Vercel:** project root `apps/website`, framework auto-detected (Next.js); set
  `NEXT_PUBLIC_GATEWAY_URL`. Rebuild to refresh the headline numbers.
- **Any static host / CDN:** run the build and upload `apps/website/out/`.

Disclosures (Terms, Privacy) currently link to the canonical docs in the repo; the signup CTA
deep-links into the app where keys and wallets already work.
