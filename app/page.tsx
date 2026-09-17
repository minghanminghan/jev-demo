"use client";

import dynamic from "next/dynamic";

import { defaultConfig, defaultUser } from "@/lib/defaults";

/**
 * The whole app. One page, mounted once.
 *
 * `ssr: false` is the point of this file rather than an optimisation. Every
 * component here is a browser component — the canvas measures nodes, the theme
 * toggle reads localStorage, and lib/route-engine.ts runs in the tab — so there
 * is nothing for a server render to produce but markup that has to be thrown
 * away and rebuilt. Keeping Next out of it means the app behaves exactly as it
 * did under Vite, and the only thing running in Node is app/api. See AGENTS.md.
 */
const Studio = dynamic(() => import("@/components/Studio"), {
  ssr: false,
  // Full height, so the shell does not collapse and then jump when Studio
  // arrives a frame later.
  loading: () => <div className="h-full" />,
});

/**
 * The seed bot and the seed customer are read once at module scope, not per
 * render, so Studio holds one stable copy of each to edit against and to reset
 * back to. Calling them inside the component would hand it a fresh object on
 * every pass and the "reset" target would drift.
 */
const seedConfig = defaultConfig();
const seedUser = defaultUser();

export default function Page() {
  return <Studio defaultConfig={seedConfig} defaultUser={seedUser} />;
}
