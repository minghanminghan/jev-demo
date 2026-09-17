import {
  choice as jevChoice,
  noul as jevNoul,
  score as jevScore,
  TypeSafeClient,
  type ChoiceResponse,
  type Description,
  type EntryType,
  type NoulResponse,
  type Questions,
  type ScoreResponse,
  type Usage,
} from "@typesafe-ai/sdk";

import { JEV_PROXY_PATH, type Engine } from "./types";

/**
 * The one contract both engines answer to.
 *
 * This file exists so the comparison is honest. `route-engine.ts` plans the
 * levels, walks the answers, applies the gates and runs the automations; it
 * never learns which engine replied. Swapping jev for an LLM swaps an
 * `Oracle` and nothing else, so anything the two traces disagree about came
 * out of the engine rather than out of two different codebases.
 *
 * A question here is deliberately jev's shape rather than a neutral one. jev's
 * `Choice` is the primitive being argued about, so bending it toward an LLM's
 * idea of a prompt would be the thumb on the scale. The LLM adapter's job is
 * to answer *this*, in full, and `lib/llm-oracle.ts` shows exactly what that
 * costs it.
 */

/** One question. The three kinds map 1:1 onto the jev SDK's three. */
export type Question =
  | {
      kind: "choice";
      instructions: string;
      /** Option name to its criteria. Values may carry a nested subtree. */
      criteria: Record<string, Description>;
    }
  | { kind: "noul"; instructions: string }
  | {
      kind: "score";
      instructions: string;
      /** The rubric, low to high. An answer is an index into this. */
      levels: readonly string[];
    };

export type Answer =
  | {
      kind: "choice";
      /** A key of the question's `criteria`. Never anything else. */
      choice: string;
      /** 0-1. */
      confidence: number;
      probabilities: Record<string, number>;
    }
  | { kind: "noul"; noul: number }
  /** An index into the question's `levels`. */
  | { kind: "score"; score: number };

/** What one round trip came back with. */
export interface Round {
  answers: Record<string, Answer>;
  /** The model that actually served it, as the engine reports it. */
  model: string;
  usage: { input_tokens: number; output_tokens: number } | null;
  /**
   * Answers that did not honour their question, already repaired.
   *
   * Always empty from jev — a Choice cannot return a non-option. The LLM
   * adapter fills it, and the chat shows the count, because silently retrying
   * until the answer parses would hide the very thing being measured.
   */
  violations: string[];
  /**
   * What went over the wire, for the read-out.
   *
   * A comparison nobody can audit is a claim, not a measurement. This is the
   * payload itself, so anyone doubting the test can read both sides' requests
   * and check that the tree, the criteria and the instructions really were
   * the same. Null when the engine does not expose it.
   */
  sent: string | null;
}

/**
 * An engine that answers a set of questions in **one** round trip.
 *
 * The round-trip count is the whole point of the comparison, so `ask` is the
 * unit of cost: whatever the caller hands over, the engine pays one network
 * hop for. The walk hands over every level of the tree at once; no engine
 * gets to split that up.
 */
export interface Oracle {
  readonly engine: Engine;
  /** The model id the caller asked for, before the engine reports back. */
  readonly model: string;
  /**
   * What this engine charges, so the walk can price a turn without knowing
   * who answered it. Null when the price is unknown — a self-hosted box, or a
   * model the catalog has no figure for — and a turn then reports no cost
   * rather than a made-up one.
   */
  readonly rate: Rate | null;
  ask(questions: Record<string, Question>, state: EntryType): Promise<Round>;
}

/** US dollars per million tokens. */
export interface Rate {
  input: number;
  output: number;
}

export class MissingKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingKeyError";
  }
}

/** Narrowing helpers, so the walk can read an answer without a type guard. */
export function asChoice(answer: Answer | undefined, where: string) {
  if (answer?.kind !== "choice") throw new Error(`${where} did not come back as a choice`);
  return answer;
}

export function asNoul(answer: Answer | undefined): number | null {
  return answer?.kind === "noul" ? answer.noul : null;
}

export function asScore(answer: Answer | undefined): number | null {
  return answer?.kind === "score" ? answer.score : null;
}

/* ------------------------------------------------------------------ jev --- */

/**
 * jev, through the SDK.
 *
 * The client is built per turn because the key comes from Settings and lives
 * only in this tab. Timeout and retry are set here and mirrored in the LLM
 * adapter, so neither side wins on a client setting.
 */
/**
 * jev's published price. Input only: output tokens are not billed.
 *
 * Hard-coded because the SDK reports usage but no money, and a price the
 * reader cannot see is worse than none. Check it against jev's pricing page
 * before trusting a dollar figure in a demo.
 */
const JEV_RATE: Rate = { input: 0.042, output: 0 };

export function jevOracle(model: string, apiKey?: string): Oracle {
  const key = apiKey?.trim();
  if (!key) throw new MissingKeyError("No jev API key. Paste one into Settings.");

  const client = new TypeSafeClient({
    apiKey: key,
    // Everything runs in the tab, including this. The usual reason not to is
    // that a build-time key would leak to every visitor; here the key is the
    // one the person at the keyboard just typed, so there is nothing to leak.
    dangerouslyAllowBrowser: true,
    // Via the proxy, because api.typesafe.ai allows no browser origin.
    baseURL: JEV_PROXY_PATH,
    // A batched call carries every level of the tree, so give it more than the
    // 10s default. Same number on the LLM side.
    timeout: 20_000,
    // A customer is waiting. Two quick tries, then tell them.
    retry: { maxRetries: 2, backoffInitialMs: 250, backoffMaxMs: 1_500 },
  });

  return {
    engine: "jev",
    model,
    rate: JEV_RATE,
    async ask(questions, state) {
      const asked: Questions = {};
      for (const [key, question] of Object.entries(questions)) {
        asked[key] = build(question);
      }

      const result = await client.systemOne({ state, model, questions: asked });

      const answers: Record<string, Answer> = {};
      for (const [key, question] of Object.entries(questions)) {
        answers[key] = read(question, result.answers[key]);
      }

      return {
        answers,
        model: result.model,
        usage: totals(result.usage),
        // Nothing to report. The SDK's Choice returns a key of the criteria it
        // was given, so there is no such thing as an off-menu answer here.
        violations: [],
        // The SDK does not hand back its own serialised body, so this is the
        // request rebuilt from the same two inputs it was given. It is what
        // the LLM side prints, which is the point: the criteria and the state
        // can be read side by side and checked for being identical.
        sent: JSON.stringify({ model, state, questions: describe(questions) }, null, 2),
      };
    },
  };
}

/**
 * The questions as plain JSON, for a prompt or a read-out.
 *
 * Shared by both engines on purpose: the LLM adapter puts this in its prompt
 * and the jev adapter puts it in its `sent`, so the two read-outs are directly
 * comparable and neither is a reworded version of the other.
 */
export function describe(questions: Record<string, Question>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, question] of Object.entries(questions)) {
    switch (question.kind) {
      case "choice":
        out[key] = {
          kind: "choice",
          instructions: question.instructions,
          options: question.criteria,
        };
        break;
      case "noul":
        out[key] = { kind: "noul", instructions: question.instructions };
        break;
      case "score":
        out[key] = {
          kind: "score",
          instructions: question.instructions,
          levels: Object.fromEntries(question.levels.map((level, index) => [index, level])),
        };
        break;
    }
  }
  return out;
}

function build(question: Question) {
  switch (question.kind) {
    case "choice":
      return jevChoice(question.instructions, question.criteria);
    case "noul":
      return jevNoul(question.instructions);
    case "score":
      // The SDK wants at least two levels, which every caller here satisfies.
      return jevScore(
        question.instructions,
        question.levels as unknown as readonly [EntryType, EntryType, ...EntryType[]],
      );
  }
}

function read(question: Question, raw: unknown): Answer {
  switch (question.kind) {
    case "choice": {
      const answer = raw as ChoiceResponse;
      return {
        kind: "choice",
        choice: String(answer.choice),
        confidence: answer.confidence,
        probabilities: { ...answer.probabilities } as Record<string, number>,
      };
    }
    case "noul":
      return { kind: "noul", noul: (raw as NoulResponse).noul };
    case "score":
      return { kind: "score", score: Number((raw as ScoreResponse).score) };
  }
}

function totals(usage: Usage | undefined) {
  return usage ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } : null;
}
