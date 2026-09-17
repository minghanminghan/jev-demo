import { generateObject } from "ai";
import { z } from "zod";

import { describe, MissingKeyError, type Answer, type Oracle, type Question } from "./oracle";
import { buildModel, providerById, rateFor, ready } from "./providers";
import type { LlmSettings } from "./types";

/**
 * The LLM side of the comparison.
 *
 * It answers the same `Question` set jev answers, in the same one round trip,
 * and hands back the same `Round`. Everything after this file — the gates, the
 * walk, the automations, the reply text — is shared code that cannot tell which
 * engine it is reading.
 *
 * **Where the fairness lives.** The instinct when writing this is to make the
 * LLM look bad, so it is worth naming the choices that push the other way:
 *
 *   - It gets a **strict JSON schema**, not JSON-in-a-prompt. A `choice` is a
 *     Zod enum of exactly the options offered, so the provider's own
 *     constrained decoding does the work. That is the strongest structured
 *     output a provider sells, and it is on by default.
 *   - Every provider is reached through its **native AI SDK package** where one
 *     exists, never a compatibility endpoint. Anthropic's documents
 *     `response_format` and a tool's `strict` as ignored, so routing Claude
 *     through it would quietly take the schema away and leave it answering in
 *     prose — losing a comparison it was never allowed to enter properly.
 *   - Only models that **report structured output** are offered at all, so
 *     nobody can accidentally enter a model that cannot be held to a schema
 *     and read the result as a fact about LLMs. See `lib/providers.ts`.
 *   - It gets the **same criteria**, nested subtree and all, and the same
 *     instructions text — no paraphrasing, no extra hints, nothing removed.
 *   - It gets a **real system prompt** explaining the contract. jev does not
 *     need one because the contract *is* its API. Withholding it here would
 *     measure a mistake rather than a model.
 *   - It gets the **same timeout and the same two retries** as the jev client.
 *   - Every question goes in one call for both engines. The LLM is not made to
 *     walk the tree a level at a time while jev fans out.
 *
 * What is not smoothed over: a schema still describes an answer rather than
 * guaranteeing one, so this file counts what came back wrong instead of
 * retrying until it reads well. See `repair` below.
 */

/** Matches the jev client's ceiling, so neither side wins on a timeout. */
const TIMEOUT_MS = 20_000;

/** Matches the jev client's `retry.maxRetries`. */
const MAX_RETRIES = 2;

/**
 * The contract, in words. jev gets this for free from its API shape.
 *
 * Written to be plainly useful rather than flattering or hobbling: it states
 * the output rules, defines the two numbers so they mean what jev's mean, and
 * says nothing about the domain, which is what the criteria are for.
 */
const SYSTEM = [
  "You are a classifier inside a customer-support router. You do not write prose and you never address the customer.",
  "",
  "You are given the conversation state and a set of independent questions. Answer every question. Judge each one only against the criteria given for it; questions do not constrain each other.",
  "",
  "Question kinds:",
  "- choice: pick exactly one of the option names offered. The options are the only allowed answers. `confidence` is how likely it is that your pick is the correct one, from 0 to 1. `probabilities` is your full distribution over the offered options, and the values must sum to 1.",
  "- noul: a single number from 0 to 1, where 0 means the described condition plainly does not hold and 1 means it plainly does.",
  "- score: the index of the rubric level that fits best, counting from 0.",
  "",
  "An option's criteria may include `leads_to`, which lists what sits underneath that option further down the tree. Use it to judge whether the option is the right branch, and still answer with the top-level option name.",
  "",
  'Some choice questions offer "__other__". Pick it when none of the real options fit, rather than forcing the closest one.',
].join("\n");

export function llmOracle(settings: LlmSettings): Oracle {
  if (!ready(settings)) {
    throw new MissingKeyError("No LLM picked. Choose a provider and a model in Settings.");
  }

  const model = buildModel(settings);
  const label = `${providerById(settings.providerId)?.name ?? settings.providerId}/${settings.modelId.trim()}`;

  return {
    engine: "llm",
    model: label,
    rate: rateFor(settings),
    async ask(questions, state) {
      const keys = Object.keys(questions);
      if (keys.length === 0) {
        return { answers: {}, model: label, usage: null, violations: [], sent: null };
      }

      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, question] of Object.entries(questions)) {
        shape[key] = schemaFor(question);
      }

      const result = await generateObject({
        model,
        schema: z.object(shape),
        schemaName: "routing_answers",
        schemaDescription: "One answer per question, keyed by question name.",
        system: SYSTEM,
        prompt: [
          "## Conversation state",
          "```json",
          JSON.stringify(state, null, 2),
          "```",
          "",
          "## Questions",
          "```json",
          JSON.stringify(describe(questions), null, 2),
          "```",
        ].join("\n"),
        maxRetries: MAX_RETRIES,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const violations: string[] = [];
      const answers: Record<string, Answer> = {};
      const raw = result.object as Record<string, unknown>;
      for (const [key, question] of Object.entries(questions)) {
        answers[key] = repair(key, question, raw[key], violations);
      }

      return {
        answers,
        model: result.response.modelId ?? label,
        usage: {
          input_tokens: result.usage.inputTokens ?? 0,
          output_tokens: result.usage.outputTokens ?? 0,
        },
        violations,
        sent: bodyOf(result.request.body),
      };
    },
  };
}

/**
 * The schema for one question.
 *
 * Every field is spelled out as a required property of a closed object, which
 * is what a provider's strict mode needs: `additionalProperties: false` and no
 * optional keys. That also rules out the cheap failure where a model answers
 * three of four questions.
 *
 * `confidence` carries no numeric bounds because strict schemas do not accept
 * `minimum`/`maximum` — that one is checked in `repair` instead.
 */
function schemaFor(question: Question): z.ZodTypeAny {
  switch (question.kind) {
    case "choice": {
      const options = Object.keys(question.criteria);
      const probabilities: Record<string, z.ZodTypeAny> = {};
      for (const option of options) probabilities[option] = z.number();
      return z.object({
        choice: z.enum(options as [string, ...string[]]),
        confidence: z.number(),
        probabilities: z.object(probabilities),
      });
    }
    case "noul":
      return z.object({ noul: z.number() });
    case "score": {
      const members = question.levels.map((_level, index) => z.literal(index));
      return z.object({
        score: z.union(members as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]),
      });
    }
  }
}

/**
 * Read one answer, note anything wrong with it, and carry on.
 *
 * The rule is repair-and-report, never retry-until-it-reads-well. A second
 * call to get a cleaner answer would quietly buy the LLM another round trip,
 * which is the exact quantity under test; and a silent clamp would hide that
 * the number came back outside its range. So the value is made usable and the
 * problem is written down, where the chat's read-out shows it.
 *
 * A break the schema itself catches never reaches this function: the SDK
 * throws, and `lib/chat.ts` reports that as a failed turn.
 */
function repair(
  key: string,
  question: Question,
  raw: unknown,
  violations: string[],
): Answer {
  const value = (raw ?? {}) as Record<string, unknown>;

  switch (question.kind) {
    case "choice": {
      const options = Object.keys(question.criteria);
      let choice = String(value.choice ?? "");
      if (!options.includes(choice)) {
        violations.push(`${key}: "${choice}" is not one of the ${options.length} options offered`);
        // Fall back to the distribution's own favourite when that at least
        // names a real option, so one bad field does not throw the turn away.
        choice = bestOf(value.probabilities, options) ?? options[0];
      }

      const rawConfidence = Number(value.confidence);
      let confidence = rawConfidence;
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        violations.push(`${key}: confidence ${value.confidence} is not a number from 0 to 1`);
        confidence = Number.isFinite(rawConfidence) ? Math.min(Math.max(rawConfidence, 0), 1) : 0;
      }

      return {
        kind: "choice",
        choice,
        confidence,
        probabilities: normalise(key, value.probabilities, options, violations),
      };
    }

    case "noul": {
      const raw = Number(value.noul);
      if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
        violations.push(`${key}: noul ${value.noul} is not a number from 0 to 1`);
        return { kind: "noul", noul: Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0 };
      }
      return { kind: "noul", noul: raw };
    }

    case "score": {
      const top = question.levels.length - 1;
      const raw = Number(value.score);
      if (!Number.isInteger(raw) || raw < 0 || raw > top) {
        violations.push(`${key}: score ${value.score} is not a whole number from 0 to ${top}`);
        const clamped = Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 0), top) : 0;
        return { kind: "score", score: clamped };
      }
      return { kind: "score", score: raw };
    }
  }
}

/** The highest-weighted option that is actually an option, or null. */
function bestOf(raw: unknown, options: string[]): string | null {
  if (raw === null || typeof raw !== "object") return null;
  let best: string | null = null;
  let seen = -Infinity;
  for (const [name, weight] of Object.entries(raw as Record<string, unknown>)) {
    const value = Number(weight);
    if (!options.includes(name) || !Number.isFinite(value) || value <= seen) continue;
    best = name;
    seen = value;
  }
  return best;
}

/**
 * A distribution over exactly the offered options, summing to 1.
 *
 * Off-menu keys, missing keys and a sum that is not 1 are each reported once
 * and then fixed, because the confidence bars in the chat read-out have to
 * mean the same thing on both sides to be worth putting next to each other.
 */
function normalise(
  key: string,
  raw: unknown,
  options: string[],
  violations: string[],
): Record<string, number> {
  const given = (raw ?? {}) as Record<string, unknown>;

  const extra = Object.keys(given).filter((name) => !options.includes(name));
  if (extra.length > 0) {
    violations.push(`${key}: probabilities name ${extra.length} option(s) nobody offered`);
  }

  const weights: Record<string, number> = {};
  let total = 0;
  let missing = 0;
  for (const option of options) {
    const value = Number(given[option]);
    const usable = Number.isFinite(value) && value >= 0;
    if (!usable) missing += 1;
    weights[option] = usable ? value : 0;
    total += weights[option];
  }
  if (missing > 0) {
    violations.push(`${key}: probabilities missing or negative for ${missing} of ${options.length} options`);
  }

  if (total === 0) {
    // Nothing usable came back. A flat distribution is the honest stand-in:
    // it says "this told us nothing" rather than inventing a winner.
    const flat = 1 / options.length;
    return Object.fromEntries(options.map((option) => [option, flat]));
  }

  // A sum that is off by rounding is not worth reporting; one that is plainly
  // not a distribution is.
  if (Math.abs(total - 1) > 0.02) {
    violations.push(`${key}: probabilities sum to ${total.toFixed(3)}, not 1`);
  }
  return Object.fromEntries(options.map((option) => [option, weights[option] / total]));
}

/** The request body as text, for the read-out. Shapes vary by provider. */
function bodyOf(body: unknown): string | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return null;
  }
}
