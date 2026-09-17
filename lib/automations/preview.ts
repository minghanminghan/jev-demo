import { changesBetween, factsFromRecord, type Facts } from "../render";
import type { BotNode, RecordChange, UserRecord } from "../types";
import { findAutomation } from "./index";
import type { Recipe } from "./recipe";
import type { Automation } from "./types";

/**
 * What an automation does, worked out by running it — not by describing it.
 *
 * The left bar needs to show the logic behind a leaf before anyone sends a
 * message: which slots it fills, whether its guard would let it through, and
 * which record fields it would move. All three are already answered by the
 * automation's own pure functions, so this asks them rather than keeping a
 * second copy of the truth in some metadata field that can drift.
 *
 * Nothing here writes. `run` returns a new record and this throws it away, so
 * a preview is as safe to compute on every keystroke as reading a string.
 */
export interface AutomationPreview {
  id: string;
  title: string;
  kind: "readOnly" | "mutating";
  /** Slots it fills right now, by name. Record paths and derived names both. */
  facts: Facts;
  /**
   * The guard's sentence when an active one would refuse, else null. Always
   * null on a passive one, which has no guard.
   */
  blocked: string | null;
  /** Fields running it now would move. Empty when read-only or blocked. */
  changes: RecordChange[];
  /** Set when `read`, `guard` or `run` threw. The rest is then best-effort. */
  error: string | null;
}

/** Null when the leaf has no automation, or names one that is not installed. */
export function previewAutomation(
  id: string | undefined,
  user: UserRecord | null,
  recipes: Recipe[] = [],
): AutomationPreview | null {
  if (!id) return null;
  const automation = findAutomation(id, recipes);
  return automation ? previewOf(automation, user) : null;
}

/** The same read-out for an automation in hand, such as a half-written recipe. */
export function previewOf(automation: Automation, user: UserRecord | null): AutomationPreview {
  const base: AutomationPreview = {
    id: automation.id,
    title: automation.title,
    kind: automation.kind,
    facts: {},
    blocked: null,
    changes: [],
    error: null,
  };
  if (!user) return { ...base, error: "no customer record to read" };

  try {
    if (automation.kind === "readOnly") {
      return { ...base, facts: automation.read(user) };
    }

    const blocked = automation.guard(user);
    if (blocked !== null) {
      return { ...base, blocked, facts: { ...automation.read(user), reason: blocked } };
    }

    const { user: next, facts = {} } = automation.run(user);
    return {
      ...base,
      facts: { ...automation.read(next), ...facts },
      changes: changesBetween(user, next),
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : "unknown error" };
  }
}

/** Where a slot's value comes from, which is the only thing a builder needs. */
export type SlotSource = "record" | "automation";

export interface Slot {
  name: string;
  /** Display string, exactly as the reply would show it. */
  value: string;
  source: SlotSource;
  /** True when the value is blank, so a reply using it hands off instead. */
  empty: boolean;
}

/**
 * Every slot this node could use, automation facts first.
 *
 * The record is always available as dotted paths, so most of this list is the
 * customer record flattened. A leaf with an automation gets its facts on top,
 * and a fact keyed with a record path shadows the raw value — same name, nicer
 * string — which is exactly what happens at run time.
 */
export function slotsFor(node: BotNode, user: UserRecord | null, recipes: Recipe[] = []): Slot[] {
  const record = user ? factsFromRecord(user) : {};
  const preview = previewAutomation(node.automation, user, recipes);
  const facts = preview?.facts ?? {};

  const slots: Slot[] = [];
  for (const [name, value] of Object.entries(facts)) {
    slots.push({ name, value, source: "automation", empty: value.trim() === "" });
  }
  for (const [name, value] of Object.entries(record)) {
    if (name in facts) continue;
    slots.push({ name, value, source: "record", empty: value.trim() === "" });
  }
  return slots;
}
