# jev demo

**Next.js 16** (App Router, Turbopack) + **React 19**. One page, no router.

Next is here for one reason: `app/api/jev` and `app/api/llm` have to run
somewhere other than a browser. Everything else still runs in the tab.

- `app/layout.tsx` → `app/page.tsx` → `components/Studio.tsx`. One page.
- `app/page.tsx` loads Studio with `next/dynamic` and **`ssr: false`**. That is
  load bearing, not an optimisation: every component measures the DOM or reads
  `localStorage`, and `lib/route-engine.ts` runs in the browser. `"use client"`
  appears on `app/page.tsx` only; the whole graph below it inherits it.
- `@/` resolves to the repo root (`tsconfig.json`). `components/`, `lib/` and
  `data/` stay at the root rather than moving under `app/`.
- `lib/route-engine.ts` runs **in the browser**. Keep `node:` imports out of
  `lib/` and `components/`. `app/api/`, `next.config.ts` and `scripts/` are the
  only places server or Node code belongs.
- `data/*.json` is imported, not read off disk. Nothing writes a file.
- The jev API allows no browser origin, so the SDK is pointed at `/api/jev` and
  `app/api/jev/[...path]/route.ts` passes it through to `api.typesafe.ai`. The
  comparison LLM goes through `/api/llm`, which reads its real endpoint off an
  `x-llm-url` header — the provider is whatever the user typed, so the target
  cannot be fixed at config time. `/api/llm` forwards only to hosts on the
  allowlist in `app/api/llm/allowlist.ts`, and never to link-local addresses.
  If you change either path, change it in both `lib/types.ts`
  (`JEV_PROXY_PATH`, `LLM_PROXY_PATH`, `LLM_TARGET_HEADER`) and the folder name
  under `app/api/`.
- Both routes are relays: they attach whatever key the caller sends to a
  request the server makes. A deployed copy needs Vercel Deployment Protection
  or equivalent in front of it. See the README.
- `lib/route-engine.ts` must not learn which engine answered it. It takes an
  `Oracle` (`lib/oracle.ts`); `jevOracle` and `llmOracle` are the two. That is
  what makes the side-by-side comparison worth anything, so keep engine-specific
  behaviour behind that interface rather than branching in the walk.
- The AI SDK builds its request URL as `new URL(baseURL + path)` with no base to
  resolve against, so any baseURL handed to a provider has to stay absolute.
- Fonts come from `next/font` in `app/layout.tsx`, which sets `--next-inter` and
  `--next-geist-mono` on `<html>`. `app/globals.css` re-exports both as
  `--font-inter` / `--font-geist-mono` and adds the fallback chain.
- `data/providers.json` is generated — `node scripts/snapshot-providers.mjs`,
  which reads models.dev. Do not hand-edit it.
- Only models reporting `structured_output` are snapshotted. That is load
  bearing: a model that cannot be held to a schema cannot answer the question,
  and offering one makes the comparison lie.

`npm run build` is `next build`, which type-checks as it goes. Run
`npm run lint` too.

`next dev` wants to append a generated block to this file. `agentRules: false`
in `next.config.ts` turns that off, so everything here is hand-written. If a
`<!-- BEGIN:nextjs-agent-rules -->` section reappears, that setting was lost.
