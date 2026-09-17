import type { NextRequest } from "next/server";

import { LLM_TARGET_HEADER } from "@/lib/types";

import { allowedHosts, linkLocal, onList } from "./allowlist";

/**
 * The LLM pass-through: the same job as app/api/jev, for the other side of the
 * comparison.
 *
 * The whole destination URL rides in `x-llm-url` — not a base to append a path
 * to, but the exact URL the provider's own SDK built — so nothing here has to
 * know any provider's layout, and one route covers every provider the user
 * might type in. lib/providers.ts is what moves it into the header.
 *
 * It never touches the credentials: the auth headers are copied through from
 * the tab and nothing is read, logged or stored here.
 *
 * **This is still a relay.** The allowlist stops it being a way into your
 * network, but it attaches whatever key the caller sends to a request this
 * server makes, so a deployed copy wants Vercel Deployment Protection (or
 * equivalent) in front of it. See the README.
 */
export const dynamic = "force-dynamic";

/**
 * Only the headers a provider actually needs. Forwarding the browser's whole
 * set would send an `Origin` and a `Referer` the provider may reject, and leak
 * this app's hostname to it.
 *
 * `authorization` is the OpenAI-compatible shape. `x-api-key` and
 * `anthropic-version` are the native Anthropic one — Claude does not
 * authenticate with a bearer token, so without these the Anthropic protocol
 * cannot work at all. `x-goog-api-key` is the Google one: @ai-sdk/google sends
 * the key in that header and nothing else, so dropping it 401s every Gemini
 * model.
 */
const FORWARD = [
  "authorization",
  "x-api-key",
  "anthropic-version",
  "anthropic-beta",
  "x-goog-api-key",
];

function fail(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

export async function POST(request: NextRequest) {
  const base = request.headers.get(LLM_TARGET_HEADER);
  if (!base || base.trim() === "") return fail(400, `missing ${LLM_TARGET_HEADER}`);

  let target: URL;
  try {
    // The complete URL, path and query included. The request path is ignored:
    // lib/providers.ts posts everything to the mount point itself.
    target = new URL(base);
  } catch {
    return fail(400, `${LLM_TARGET_HEADER} is not a URL: ${base}`);
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return fail(400, `${LLM_TARGET_HEADER} must be http or https`);
  }
  // 403 rather than 400 on both of these: the request is well formed, the
  // destination is the problem.
  if (linkLocal(target.hostname)) {
    // Deliberately no way out offered. This one is not configurable.
    return fail(403, `"${target.hostname}" is link-local and is never forwarded to.`);
  }
  if (!onList(target.hostname)) {
    // Name the way out, so this reads as a list to add to rather than as a
    // thing that is broken.
    return fail(
      403,
      `"${target.hostname}" is not an allowed LLM host. ` +
        `Add it with LLM_ALLOWED_HOSTS=${target.hostname} in the environment, ` +
        `or use one of: ${allowedHosts().join(", ")}`,
    );
  }

  const headers = new Headers({ "content-type": "application/json" });
  for (const name of FORWARD) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers,
      body: request.body,
      // Required whenever a body is a stream, which `request.body` is.
      duplex: "half",
      // Do not follow redirects. Following one would let an allowed host hand
      // this route a second destination that never went past the allowlist,
      // which is the whole check undone. Nothing that answers
      // /chat/completions redirects, so a 3xx here is worth seeing rather
      // than chasing.
      redirect: "manual",
      cache: "no-store",
    } as RequestInit & { duplex: "half" });

    const type = upstream.headers.get("content-type");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: type ? { "content-type": type } : undefined,
    });
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : "upstream request failed");
  }
}
