import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import snapshot from "@/data/providers.json";

import { LLM_PROXY_PATH, LLM_TARGET_HEADER, type LlmSettings } from "./types";

/**
 * The providers the comparison can run against, and how to build one.
 *
 * Four, plus an escape hatch — OpenAI, Anthropic and Google natively, and
 * OpenRouter for the long tail, which fronts Groq, DeepSeek, Mistral, xAI and a
 * few hundred more behind one key. `custom` is anything OpenAI-shaped you host
 * yourself. A separate entry per provider would be another npm package each to
 * reach models OpenRouter already reaches.
 *
 * The list is `data/providers.json`, taken from the models.dev catalog by
 * `scripts/snapshot-providers.mjs`. It holds only models that report
 * structured output, which is a fairness filter rather than a tidy one: a
 * model that cannot be held to a schema cannot answer the question being
 * asked, and letting someone pick one turns "this model lost" into a claim
 * about LLMs when it is a fact about the pick.
 *
 * Two things follow from the catalog that shape the Settings form:
 *
 *   - Every provider with a first-party AI SDK package has no base URL in the
 *     catalog, because the package already holds its own. So picking OpenAI or
 *     Anthropic asks for a key and nothing else.
 *   - Native packages are used wherever one exists. A compatibility endpoint is
 *     not the same API — Anthropic's documents `response_format` as ignored —
 *     so routing through one would quietly take the schema away from one side.
 */

/** Which AI SDK package speaks to a provider. */
export type SdkKind = "openai" | "anthropic" | "google" | "openai-compatible";

export interface CatalogModel {
  id: string;
  name: string;
  /** Per million tokens. Null on a local model, where there is no price. */
  cost: { input: number; output: number } | null;
}

export interface CatalogProvider {
  id: string;
  name: string;
  sdk: SdkKind;
  /** Only set where the SDK has no default of its own. */
  api: string | null;
  local: boolean;
  doc: string | null;
  /** Empty on `custom`, where nobody can know what is loaded. */
  models: CatalogModel[];
}

export const PROVIDERS = snapshot.providers as CatalogProvider[];

export const CATALOG_SOURCE = snapshot.source;
export const CATALOG_DATE = snapshot.takenAt;

export function providerById(id: string): CatalogProvider | undefined {
  return PROVIDERS.find((one) => one.id === id);
}

/** The default pick, so a fresh Settings form is already usable. */
export const DEFAULT_PROVIDER = PROVIDERS[0]?.id ?? "custom";

/**
 * True when there is enough to make a call.
 *
 * A provider with a model list needs one of its models; `custom` needs a base
 * URL and a model id typed in, because there is nothing to pick from.
 */
export function ready(settings: LlmSettings): boolean {
  const provider = providerById(settings.providerId);
  if (!provider) return false;
  if (!settings.modelId.trim()) return false;
  const needsUrl = provider.api === null && provider.sdk === "openai-compatible";
  return !needsUrl || settings.baseUrl.trim() !== "";
}

/**
 * The picked model's price, per million tokens, from the catalog.
 *
 * Null on `custom` and on any model the catalog carries no figure for, which
 * is the honest answer: the price of a box someone else is hosting is not
 * knowable from here, and a zero would read as free.
 */
export function rateFor(settings: LlmSettings): { input: number; output: number } | null {
  const provider = providerById(settings.providerId);
  const model = provider?.models.find((one) => one.id === settings.modelId.trim());
  return model?.cost ?? null;
}

/** The endpoint, when the SDK needs telling. Null means it already knows. */
export function baseUrlFor(settings: LlmSettings): string | undefined {
  const provider = providerById(settings.providerId);
  // A typed-in URL always wins: it is how you reach a self-hosted box, or a
  // gateway standing in front of a provider on the list.
  const typed = settings.baseUrl.trim();
  if (typed) return typed.replace(/\/$/, "");
  return provider?.api ?? undefined;
}

/**
 * A `fetch` that sends every provider call through the pass-through.
 *
 * This is why the form does not have to know any provider's URL. Each SDK
 * builds its own absolute request URL from whatever default it holds; this
 * moves that URL into a header and posts to the local proxy instead, which
 * checks it against its allowlist and forwards it (see vite.config.ts).
 *
 * Without it, every provider would need a base URL hard-coded here just to be
 * rewritten — and a browser cannot call these hosts directly anyway, because
 * none of them send a CORS header for this origin.
 */
function proxiedFetch(): typeof globalThis.fetch {
  const proxy = new URL(LLM_PROXY_PATH, globalThis.location?.href ?? "http://localhost/").href;

  return async (input, init) => {
    // `new Request` normalises the three shapes fetch accepts into one, so the
    // url, method, headers and body can be read off without special cases.
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set(LLM_TARGET_HEADER, request.url);

    const empty = request.method === "GET" || request.method === "HEAD";
    return fetch(proxy, {
      method: request.method,
      headers,
      body: empty ? undefined : await request.arrayBuffer(),
      signal: request.signal,
    });
  };
}

/**
 * The language model for these settings.
 *
 * Every branch gets the same three things: the key, the proxied fetch, and a
 * base URL only where one is needed. Nothing else differs, so no provider is
 * quietly configured better than another.
 */
export function buildModel(settings: LlmSettings): LanguageModel {
  const provider = providerById(settings.providerId);
  if (!provider) throw new Error(`unknown provider "${settings.providerId}"`);

  const apiKey = settings.apiKey.trim() || undefined;
  const baseURL = baseUrlFor(settings);
  const fetch = proxiedFetch();
  const common = { apiKey, baseURL, fetch };
  const modelId = settings.modelId.trim();

  switch (provider.sdk) {
    case "openai":
      return createOpenAI(common)(modelId);
    case "anthropic":
      return createAnthropic(common)(modelId);
    case "google":
      return createGoogleGenerativeAI(common)(modelId);
    case "openai-compatible":
      return createOpenAICompatible({
        name: provider.id,
        // The one branch that cannot fall back on an SDK default.
        baseURL: baseURL ?? "",
        apiKey,
        fetch,
        // Ask for the provider's own strict schema enforcement rather than
        // hoping prose JSON parses. The native packages above do this already.
        supportsStructuredOutputs: settings.strictSchema,
      }).chatModel(modelId);
  }
}
