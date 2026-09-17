import type { Facts } from "../render";
import type { UserRecord } from "../types";

/**
 * An automation is the thing a leaf does before it answers.
 *
 * There are exactly two kinds, and the split is the point:
 *
 *   - **read-only** looks at the record. It cannot change anything, so it is
 *     always safe to run, needs no confirmation, and costs nothing to get
 *     wrong.
 *   - **mutating** does something on the customer's behalf. It writes the
 *     record, so it gets a guard, and the guard's answer is canned text, not a
 *     guess.
 *
 * Both only ever *fill in* text a human wrote. Nothing here generates language.
 *
 * Most automations are JSON recipes — see `recipe.ts`, which compiles one into
 * this shape. What is left in TypeScript is in `coded.ts`, and nothing outside
 * these files can tell which kind it is holding.
 */

/** The two kinds, as words for a screen. */
export const KIND_LABEL = {
  readOnly: "read-only",
  mutating: "mutating",
} as const;

interface Common {
  /** Stable id. It is what the node stores, so renaming one is a migration. */
  id: string;
  /** One line for the builder's picker. */
  title: string;
  /**
   * Facts for the reply's `{{slots}}`, read from the record. Pure, and it must
   * never return a blank value: a blank fact is a hole in a sentence, and the
   * engine escalates rather than send one.
   *
   * One rule for the keys, so a template is always written against the JSON:
   *
   *   - a key that is a **record path** — `"subscription.renewsOn"` — formats
   *     that very field. It overrides the raw value, so `{{subscription.renewsOn}}`
   *     reads "1 Oct 2026" here and the bare ISO date everywhere else.
   *   - any other key is **camelCase and derived** — `otherPlans`, `syncNote` —
   *     and is something the record does not hold.
   *
   * A key that is a path but describes a different field is a lie the builder
   * cannot see through. Do not write one.
   */
  read: (user: UserRecord) => Facts;
}

/** Reads the record. Writes nothing. */
export interface ReadOnlyAutomation extends Common {
  kind: "readOnly";
}

/** Does something for the customer, and writes the record. */
export interface MutatingAutomation extends Common {
  kind: "mutating";
  /**
   * `null` means go ahead. A string is the reason it cannot, written as a
   * sentence, because it is dropped straight into `blockedReply` as
   * `{{reason}}`.
   */
  guard: (user: UserRecord) => string | null;
  /**
   * Do it. Pure: return a new record, never edit the one handed in. Extra
   * facts here describe what just happened, like the id of a filed bug.
   */
  run: (user: UserRecord) => { user: UserRecord; facts?: Facts };
  /** Canned text for a guard that said no. `{{reason}}` is the guard's words. */
  blockedReply: string;
}

export type Automation = ReadOnlyAutomation | MutatingAutomation;
