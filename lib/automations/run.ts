import { changesBetween, factsFromRecord, render, type Facts } from "../render";
import type { AutomationTrace, BotNode, UserRecord } from "../types";
import { findAutomation } from "./index";
import type { Recipe } from "./recipe";

/**
 * Running a leaf's automation, and filling its canned reply.
 *
 * The rules that matter, all in one place:
 *
 *   - a missing fact is never sent. A reply with an unfilled `{{slot}}` is a
 *     sentence with a hole in it, so the bot hands off to a human instead.
 *   - a read-only automation cannot fail in a way that changes anything.
 *   - a mutating automation changes the record only after its guard says yes,
 *     and hands the new record back rather than writing it anywhere.
 *   - anything that throws escalates. It never turns into an apology the bot
 *     made up.
 */

/** What a leaf decided to say, and whether it gave up and called a human. */
export interface LeafAnswer {
  reply: string;
  /** True when the engine should escalate instead of sending `reply`. */
  escalate: boolean;
  reason: string;
  automation: AutomationTrace | null;
  /**
   * The record as a mutating automation left it, or null when nothing changed.
   *
   * Nothing is written here. The record was passed in and the new one is
   * handed back, so this tab's memory stays the only place the customer's
   * data lives.
   */
  record: UserRecord | null;
}

/** Canned text plus the record, with no automation in the middle. */
export function fillFromRecord(template: string, user: UserRecord | null): LeafAnswer {
  return finish(template, user ? factsFromRecord(user) : {}, "sent as written", null);
}

/**
 * Answer one leaf.
 *
 * `user` is null only when the record could not be read. A plain reply still
 * goes out in that case; an automation cannot, so it escalates.
 *
 * A recipe the builder wrote is compiled and run exactly like a typed one, so
 * nothing below this line knows which kind it got.
 */
export function answerLeaf(
  node: BotNode,
  user: UserRecord | null,
  /** Recipes from `config.automations`, which came in with the bot. */
  recipes: Recipe[] = [],
): LeafAnswer {
  const id = node.automation;
  if (!id) return fillFromRecord(node.response, user);

  const automation = findAutomation(id, recipes);
  if (!automation) {
    return handOff(`node "${node.name}" points at unknown automation "${id}"`, null);
  }
  // Every trace starts from this, so a read-out always names what ran.
  const ran = { id, title: automation.title, kind: automation.kind };

  if (!user) {
    return handOff(`no customer record, so "${id}" cannot run`, {
      ...ran,
      outcome: "failed",
      reason: "the customer record could not be read",
      facts: {},
      changes: [],
    });
  }

  const base = factsFromRecord(user);

  try {
    if (automation.kind === "readOnly") {
      const looked = automation.read(user);
      return finish(node.response, { ...base, ...looked }, `read by ${id}`, {
        ...ran,
        kind: "readOnly",
        outcome: "read",
        reason: null,
        facts: looked,
        changes: [],
      });
    }

    // Mutating. The guard decides, and its words become the reply.
    const blocked = automation.guard(user);
    if (blocked !== null) {
      const looked = automation.read(user);
      return finish(
        automation.blockedReply,
        { ...base, ...looked, reason: blocked },
        `${id} blocked: ${blocked}`,
        {
          ...ran,
          kind: "mutating",
          outcome: "blocked",
          reason: blocked,
          facts: looked,
          changes: [],
        },
      );
    }

    const { user: next, facts = {} } = automation.run(user);
    // Read back from the record it produced, so the reply describes the
    // account as it is now rather than as it was a moment ago.
    const looked = { ...automation.read(next), ...facts };
    // An automation can run and settle on the record it was given — filing the
    // same bug twice, say. Then there is nothing to hand back.
    const changes = changesBetween(user, next);

    return finish(
      node.response,
      { ...factsFromRecord(next), ...looked },
      `${id} done`,
      {
        ...ran,
        kind: "mutating",
        outcome: "done",
        reason: null,
        facts: looked,
        changes,
      },
      changes.length > 0 ? next : null,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    return handOff(`"${id}" failed: ${detail}`, {
      ...ran,
      outcome: "failed",
      reason: detail,
      facts: {},
      changes: [],
    });
  }
}

/** Fill the template, or hand off when a fact behind it is missing. */
function finish(
  template: string,
  facts: Facts,
  reason: string,
  automation: AutomationTrace | null,
  record: UserRecord | null = null,
): LeafAnswer {
  const { text, missing } = render(template, facts);
  if (missing.length > 0) {
    // The change happened, but the sentence describing it has a hole in it.
    // Keep the change and hand off: the customer gets a person, not a gap.
    return handOff(
      `no fact for ${missing.map((slot) => `{{${slot}}}`).join(", ")}`,
      automation,
      record,
    );
  }
  return { reply: text, escalate: false, reason, automation, record };
}

function handOff(
  reason: string,
  automation: AutomationTrace | null,
  record: UserRecord | null = null,
): LeafAnswer {
  return { reply: "", escalate: true, reason, automation, record };
}
