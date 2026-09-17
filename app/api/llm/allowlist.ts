import snapshot from "@/data/providers.json";

/**
 * Hosts the LLM pass-through is willing to forward to.
 *
 * The provider is whatever the user typed into Settings, so the target cannot
 * be fixed the way the jev one is — but "not fixed" must not mean "anywhere".
 * A forwarder that takes its destination from a request header and attaches a
 * credential to it is a server-side request forgery tool: point it at an
 * internal service, or at a cloud metadata endpoint, and it fetches whatever
 * is there with this machine's network position.
 *
 * So the destination is a choice from a list rather than free text. Add your
 * own with LLM_ALLOWED_HOSTS, comma separated. On Vercel that is a project
 * environment variable; locally it is an env var like any other:
 *
 *     LLM_ALLOWED_HOSTS=my-vllm.internal,gpu-box.lan npm run dev
 *
 * `localhost` is on the default list because Settings offers Ollama, vLLM and
 * LM Studio, which all run there on a port of their own. The port is not
 * matched, only the host. Note that on a deployed build `localhost` is the
 * *server's* localhost, not the visitor's, so those three only work in dev.
 */
const ALLOWED: string[] = [
  // The hosts behind data/providers.json. The first-party AI SDK packages hold
  // their own URLs, so those cannot be read off the catalog and are named here.
  "api.openai.com",
  // Reached through the native Anthropic package, never the OpenAI-compatible
  // endpoint: that one ignores `response_format`. See lib/providers.ts.
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.groq.com",
  // Other providers people reach for, and the shapes a gateway takes.
  "openrouter.ai",
  "api.deepseek.com",
  "api.together.xyz",
  "api.mistral.ai",
  "api.x.ai",
  "api.fireworks.ai",
  "api.cerebras.ai",
  "*.openai.azure.com",
  "localhost",
  "127.0.0.1",
  "[::1]",
  // Anything the snapshot names that is not already above, so refreshing the
  // catalog cannot leave the proxy refusing a provider the picker offers.
  ...catalogHosts(),
  ...(process.env.LLM_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
];

/** The list as the error message should print it. */
export function allowedHosts(): string[] {
  return ALLOWED;
}

/**
 * Hostnames from the snapshot's `api` fields.
 *
 * Imported rather than read off disk, so it survives bundling and needs no
 * path resolution at runtime. Empty if an entry is not a URL.
 */
function catalogHosts(): string[] {
  return snapshot.providers
    .map((one) => {
      if (!one.api) return "";
      try {
        return new URL(one.api).hostname.toLowerCase();
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

/**
 * Link-local, and therefore the cloud metadata endpoint at 169.254.169.254.
 *
 * Refused whatever the allowlist says. No LLM has ever lived there, and it is
 * the first address anyone reaches for when they find a forwarder, so there is
 * nothing to be gained by making it configurable.
 */
export function linkLocal(hostname: string): boolean {
  // URL.hostname keeps the brackets on an IPv6 literal, so take them off first.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host.startsWith("169.254.") || host.startsWith("fe80:");
}

/** Exact host, or a `*.example.com` entry matching any subdomain of it. */
export function onList(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED.some((entry) =>
    entry.startsWith("*.") ? host.endsWith(entry.slice(1)) : host === entry,
  );
}
