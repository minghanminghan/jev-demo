import type { NextRequest } from "next/server";

/**
 * The jev pass-through.
 *
 * `api.typesafe.ai` sends no `Access-Control-Allow-Origin`, so the browser
 * refuses to call it and something of ours has to make the call instead. That
 * is the only job on this hop. Everything else in the app runs in the tab.
 *
 * `TypeSafeClient` is pointed at JEV_PROXY_PATH (see lib/oracle.ts); this
 * route sits under it and drops the prefix again, so the SDK's own `/v1/...`
 * paths arrive unchanged. Under Vite this was a `server.proxy` entry in
 * vite.config.ts and therefore existed in dev only. As a route handler it
 * works in production too, which is the whole reason for the move.
 *
 * Keep the segment in this file's path the same as JEV_PROXY_PATH in
 * lib/types.ts.
 */
const JEV_API = "https://api.typesafe.ai";

/**
 * Always run this per request. Next would otherwise be free to treat the GET
 * as static and answer a later caller from a cached body — with the previous
 * caller's key having fetched it.
 */
export const dynamic = "force-dynamic";

/**
 * Only the headers jev actually needs.
 *
 * Forwarding the browser's whole set would send an `Origin` and a `Referer`
 * that leak this app's hostname, and a `Host` that points at the wrong server
 * entirely. `authorization` and `x-api-key` are the two shapes the SDK
 * authenticates with; nothing here reads, logs or stores either one.
 */
const FORWARD = ["authorization", "x-api-key", "content-type", "accept"];

type Context = { params: Promise<{ path: string[] }> };

async function pass(request: NextRequest, context: Context) {
  const { path } = await context.params;

  // Re-attached by hand rather than copied off `request.url`, so a caller
  // cannot smuggle a second host in through a path segment: `URL` resolves
  // each segment against JEV_API and anything absolute in there is dropped.
  const target = new URL(path.map(encodeURIComponent).join("/"), `${JEV_API}/`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARD) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      // GET and HEAD carry none, and passing an empty stream on one throws.
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      // Required whenever a body is a stream, which `request.body` is.
      duplex: "half",
      // Do not follow redirects. Following one would let jev hand this route a
      // second destination, and the credential would ride along to it.
      redirect: "manual",
      cache: "no-store",
    } as RequestInit & { duplex: "half" });

    const type = upstream.headers.get("content-type");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: type ? { "content-type": type } : undefined,
    });
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : "upstream request failed" } },
      { status: 502 },
    );
  }
}

export const GET = pass;
export const POST = pass;
