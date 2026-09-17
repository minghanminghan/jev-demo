import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "@typesafe-ai/sdk";
import {
  APICallError,
  InvalidResponseDataError,
  NoObjectGeneratedError,
  TypeValidationError,
} from "ai";

import { llmOracle } from "./llm-oracle";
import { jevOracle, MissingKeyError, type Oracle } from "./oracle";
import { enter, route } from "./route-engine";
import type {
  BotConfig,
  ChatTurn,
  Engine,
  LlmSettings,
  UserRecord,
} from "./types";

/**
 * One turn of chat, as the panel asks for it.
 *
 * This was an API route. It does not need to be: `route()` walks the tree in
 * ordinary code, and every input it wants — the bot, the customer record, the
 * keys — already lives in this tab. So the turn runs here, and the only thing
 * still crossing a network is the engine call itself, through the proxy.
 *
 * What survives from the route handler is the error wording. Both SDKs raise a
 * class per failure, so a bad key, a rate limit and a timeout each get their
 * own sentence instead of one flat "request failed" — and a comparison where
 * one side fails is only readable if it says *why* it failed.
 */

/** A failed turn, with wording the chat panel can show as-is. */
export class ChatError extends Error {
  /** Set when the failure came from the API. Support asks for it. */
  readonly requestId?: string;

  constructor(message: string, requestId?: string) {
    super(requestId ? `${message} (request ${requestId})` : message);
    this.name = "ChatError";
    this.requestId = requestId;
  }
}

/** Turn a jev SDK error into a line worth reading. */
function explainJev(error: unknown): string | null {
  if (error instanceof AuthenticationError) {
    return "jev rejected the API key. Check Settings › jev.";
  }
  if (error instanceof PermissionDeniedError) {
    return "This jev key is not allowed to use that model.";
  }
  if (error instanceof RateLimitError) {
    const wait = error.retryAfterMs ? ` Retry in ${Math.ceil(error.retryAfterMs / 1000)}s.` : "";
    return `Rate limited by jev.${wait}`;
  }
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
    // Almost always the tree: a blank label, or criteria jev cannot read.
    return `jev refused the questions: ${error.message}`;
  }
  if (error instanceof APITimeoutError) {
    return `jev did not answer within ${error.timeoutMs} ms.`;
  }
  if (error instanceof APIConnectionError) {
    return "Could not reach jev. Check the network, and that /api/jev is proxied.";
  }
  if (error instanceof APIError) {
    return `jev returned ${error.status}: ${error.message}`;
  }
  return null;
}

/**
 * Turn an AI SDK error into a line worth reading.
 *
 * `NoObjectGeneratedError` is the interesting one and it gets its own sentence:
 * it means the model could not produce an answer matching the schema, even
 * after the same two retries jev gets. That is a contract break bad enough to
 * end the turn, so it is named as one rather than blamed on the network.
 */
function explainLlm(error: unknown): string | null {
  if (NoObjectGeneratedError.isInstance(error)) {
    return "The LLM did not return an answer matching the schema, after 2 retries. Try a stronger model. On an OpenAI-compatible endpoint that rejects strict schemas, try turning that off in Settings.";
  }
  if (TypeValidationError.isInstance(error) || InvalidResponseDataError.isInstance(error)) {
    return `The LLM's answer did not fit the schema: ${error.message}`;
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ? ` ${error.statusCode}` : "";
    if (error.statusCode === 401 || error.statusCode === 403) {
      return `The LLM provider rejected the key (${error.statusCode}). Check Settings › LLM.`;
    }
    if (error.statusCode === 404) {
      return `The LLM provider returned 404. Check the base URL and the model id in Settings.`;
    }
    if (error.statusCode === 429) return "Rate limited by the LLM provider.";
    return `The LLM provider returned${status}: ${error.message}`;
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The LLM did not answer within 20000 ms.";
  }
  return null;
}

function explain(error: unknown, engine: Engine): string {
  if (error instanceof MissingKeyError) return error.message;
  const said = engine === "jev" ? explainJev(error) : explainLlm(error);
  if (said) return said;
  return error instanceof Error ? error.message : "unknown error";
}

function rethrow(error: unknown, engine: Engine): never {
  throw new ChatError(
    explain(error, engine),
    error instanceof APIError ? error.requestId : undefined,
  );
}

/** Everything both engines need, so neither can be handed a different tree. */
export interface SendInput {
  message: string;
  history?: ChatTurn[];
  engine: Engine;
  /** Typed into Settings. The only place a jev key comes from. */
  apiKey?: string;
  /** Typed into Settings. The only place the LLM endpoint comes from. */
  llm: LlmSettings;
  /** Node id to start from, when the chat was opened at one. */
  startAt?: string | null;
  config: BotConfig;
  /** The customer. An automation may hand back a changed one. */
  user?: UserRecord | null;
}

function oracleFor(input: SendInput): Oracle {
  return input.engine === "jev"
    ? jevOracle(input.config.model, input.apiKey)
    : llmOracle(input.llm);
}

/** Classify one message and answer it. The one path that calls an engine. */
export async function send(input: SendInput) {
  const { message, history = [], startAt, config, user, engine } = input;
  if (!config?.root) throw new ChatError("no config loaded");
  if (!message?.trim()) throw new ChatError("message is empty");
  try {
    return await route({
      config,
      history,
      message,
      oracle: oracleFor(input),
      startAt,
      user: user ?? null,
    });
  } catch (error) {
    rethrow(error, engine);
  }
}

/**
 * Open the chat at a node, with nothing typed yet. A leaf answers straight
 * away, which is what "Start chat here" on a leaf means. No engine call, so no
 * key needed and nothing to fail — both sides of a comparison show the same
 * reply here, which is itself worth seeing.
 */
export function open(
  config: BotConfig,
  nodeId: string,
  user: UserRecord | null | undefined,
  engine: Engine,
) {
  if (!config?.root) throw new ChatError("no config loaded");
  try {
    return enter(config, nodeId, user ?? null, { engine });
  } catch (error) {
    rethrow(error, engine);
  }
}
