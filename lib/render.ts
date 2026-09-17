import type { RecordChange } from "./types";

/**
 * Canned text with holes in it.
 *
 * jev picks an option; it never writes a word. So every reply is still a
 * string a human wrote, and the only thing that changes is the facts dropped
 * into its `{{slots}}`.
 *
 * Two kinds of slot name resolve, and both come from the same flat map:
 *   - a key out of the test-user record, spelled as the JSON spells it:
 *     `{{account.emailOnFile}}`. Always available, no automation needed.
 *   - a name an automation derived, `{{latestInvoice}}`. An automation may also
 *     reuse a record path to format that same field, which shadows the raw
 *     value: see `lib/automations/types.ts`.
 *
 * A slot with no fact behind it is never rendered as a gap. `render` reports
 * it as missing, and the engine hands the conversation to a human rather than
 * sending a sentence with a hole in it.
 */

/** Facts a template can fill from. Values are already display-ready strings. */
export type Facts = Record<string, string>;

/** `{{ account.name }}` — spaces allowed, letters, digits, `_` and `.` inside. */
const SLOT = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Every slot name in a template, in the order it appears, without repeats. */
export function slotsIn(template: string): string[] {
  return [...new Set([...template.matchAll(SLOT)].map((match) => match[1]))];
}

/**
 * Fill a template. `missing` lists the slots that had no fact, or whose fact
 * was blank, which is the same problem from the customer's side.
 */
export function render(template: string, facts: Facts): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(SLOT, (_whole, name: string) => {
    const value = facts[name];
    if (value === undefined || value.trim() === "") {
      missing.push(name);
      return "";
    }
    return value;
  });
  return { text, missing: [...new Set(missing)] };
}

/**
 * The whole record as dotted paths, so `{{subscription.plan}}` works with no
 * automation at all. Arrays get index paths and a `.length`, which is enough
 * for "you have 3 invoices" without a helper.
 */
export function factsFromRecord(record: unknown): Facts {
  const facts: Facts = {};
  walk(record, "", facts);
  return facts;
}

/**
 * What actually moved between two records.
 *
 * Flattening both sides and comparing paths means the trace reports the change
 * it can see, rather than the change an automation said it would make. An
 * automation that declares one path and edits another cannot hide.
 */
export function changesBetween(before: unknown, after: unknown): RecordChange[] {
  const was = factsFromRecord(before);
  const now = factsFromRecord(after);
  const paths = new Set([...Object.keys(was), ...Object.keys(now)]);

  const changes: RecordChange[] = [];
  for (const path of paths) {
    const from = was[path] ?? "";
    const to = now[path] ?? "";
    if (from !== to) changes.push({ path, from, to });
  }
  return changes.sort((one, two) => one.path.localeCompare(two.path));
}

function walk(value: unknown, prefix: string, facts: Facts): void {
  if (value === null || value === undefined) {
    if (prefix) facts[prefix] = "";
    return;
  }
  if (Array.isArray(value)) {
    facts[`${prefix}.length`] = String(value.length);
    value.forEach((item, index) => walk(item, `${prefix}.${index}`, facts));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      walk(item, prefix ? `${prefix}.${key}` : key, facts);
    }
    return;
  }
  facts[prefix] = String(value);
}
