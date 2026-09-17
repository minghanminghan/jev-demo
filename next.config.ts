import type { NextConfig } from "next";

/**
 * Deliberately almost empty.
 *
 * Next is here for exactly one thing: app/api/jev and app/api/llm need to run
 * somewhere other than a browser, and under Vite they existed only in
 * `vite dev`. Nothing else about the app wants a framework — there is one
 * page, no router, no server rendering (see app/page.tsx). Resist growing this
 * file; anything added here is a second reason the app needs Next, and the
 * first one is already carrying its weight.
 */
const nextConfig: NextConfig = {
  // Was `<StrictMode>` in src/main.tsx. Next owns the root now, so it is set
  // here instead. Same double-invoked effects in dev, same bugs caught.
  reactStrictMode: true,

  // `next dev` otherwise appends a block of its own to AGENTS.md on every
  // start. That file is written by hand and says so; a generated section in it
  // is an uncommitted change that comes back however often it is deleted.
  // Off, and AGENTS.md stays the one a human wrote.
  agentRules: false,
};

export default nextConfig;
