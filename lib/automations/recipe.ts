import { factsFromRecord, render, type Facts } from "../render";
import type { UserRecord } from "../types";
import { day, hoursFromNow, moment, money, words } from "./format";
import type { Automation } from "./types";

/**
 * An automation as JSON, with no code in it.
 *
 * A recipe has a fixed, small vocabulary: which record keys to read, which
 * sentences to derive from them, when to refuse, and what to write. It
 * compiles to the same `Automation` shape a hand-written one has, so the
 * engine and the trace cannot tell the two apart.
 *
 * Most of the shipped automations are recipes, in `data/automations.default.json`.
 * The two that are not are in `coded.ts`, and the reason is always the same:
 * they need a calculation — find the failed invoice, add one to a counter,
 * cut four characters off a request id. A schema that could do those would be
 * a programming language, so the escape hatch is to write the function.
 *
 * Nothing here is evaluated as code. Every step names a record path and one of
 * a handful of operations, so the worst a bad recipe can do is write a field
 * to the wrong string.
 *
 * Recipes are shipped, not authored in the app. Writing your own is out of
 * scope for this proof of concept, so there is no editor for them.
 */

/** How a record value is turned into a display string. */
export type Format = "raw" | "date" | "time" | "money" | "words" | "onOff";

/** What a condition asks of one record value. */
export type Test =
  | "isTrue"
  | "isFalse"
  | "isEmpty"
  | "isSet"
  | "equals"
  | "notEquals"
  | "isFuture"
  | "isPast";

/**
 * One question about the record.
 *
 * `value` is a template, so a condition can compare two fields:
 * `{ path: "technical.sdkVersion", test: "notEquals", value: "{{technical.sdkLatest}}" }`.
 */
export interface Condition {
  path: string;
  test: Test;
  value?: string;
}

/** What a mutating recipe puts in a field. */
export type SetTo = "true" | "false" | "null" | "now" | "inHours" | "text";

export interface Recipe {
  /** snake_case, and unique against the coded ids. */
  id: string;
  /** One line for the picker. */
  title: string;
  /** `readOnly` looks; `mutating` writes the record and needs a guard. */
  kind: "readOnly" | "mutating";
  /** Record keys to offer as slots, formatted for reading. */
  reads: { path: string; format: Format }[];
  /**
   * Extra slots, in order. Each one may use the reads and any derived slot
   * above it, so a sentence can be built out of smaller sentences.
   *
   * With `when`, all its conditions must hold for `text` to be used; otherwise
   * the slot falls back to `else`, which is blank when it is left out. A blank
   * slot that a reply uses stops the reply being sent, and a blank slot used
   * inside another derived sentence simply leaves that spot out.
   */
  derive: { name: string; text: string; when?: Condition[]; else?: string }[];
  /**
   * Mutating only. Rows are tried in order and the first one whose conditions
   * all hold refuses: `say` becomes `{{reason}}` and nothing is written.
   */
  refuse: { when: Condition[]; say: string }[];
  /** Mutating only. Applied in order to a copy of the record. */
  writes: { path: string; set: SetTo; text?: string; hours?: number }[];
  /** Mutating only. Sent when a row refused. */
  blockedReply: string;
}

/** A recipe as an `Automation`, ready for the registry. */
export function compileRecipe(recipe: Recipe): Automation {
  /** Reads and derived slots, in order, each one able to use the last. */
  const read = (user: UserRecord): Facts => {
    const record = factsFromRecord(user);
    const facts: Facts = {};
    for (const one of recipe.reads) {
      facts[one.path] = display(record[one.path] ?? "", one.format, user);
    }
    for (const one of recipe.derive) {
      const pool = { ...record, ...facts };
      facts[one.name] = holdsAll(one.when, record, pool)
        ? render(one.text, pool).text
        : render(one.else ?? "", pool).text;
    }
    return facts;
  };

  const common = { id: recipe.id, title: recipe.title || recipe.id, read };
  if (recipe.kind === "readOnly") return { ...common, kind: "readOnly" };

  return {
    ...common,
    kind: "mutating",
    blockedReply: recipe.blockedReply,
    guard: (user) => {
      const record = factsFromRecord(user);
      const pool = { ...record, ...read(user) };
      for (const one of recipe.refuse) {
        if (holdsAll(one.when, record, pool)) return render(one.say, pool).text;
      }
      return null;
    },
    run: (user) => {
      const pool = { ...factsFromRecord(user), ...read(user) };
      let next = user;
      for (const one of recipe.writes) {
        next = setPath(next, one.path, written(one, pool)) as UserRecord;
      }
      return { user: next };
    },
  };
}

/** The mistakes that stop a recipe working, in the builder's words. */
export function recipeProblems(recipe: Recipe, takenIds: string[]): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9_]*$/.test(recipe.id)) {
    problems.push(`"${recipe.id || "(no id)"}" must be lower case with underscores`);
  }
  if (takenIds.filter((id) => id === recipe.id).length > 1) {
    problems.push(`two automations are called "${recipe.id}"`);
  }
  for (const one of recipe.reads) {
    if (!one.path.trim()) problems.push(`"${recipe.id}" has a read with no key`);
  }
  for (const one of recipe.derive) {
    // A record path is allowed as a name: that shadows the raw field with a
    // readable version of it, which is what half the shipped recipes do.
    if (!/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*$/.test(one.name)) {
      problems.push(`derived name "${one.name || "(blank)"}" must be camelCase or a record key`);
    }
    if (!one.text.trim()) problems.push(`derived "${one.name}" has no text`);
  }
  if (recipe.kind === "readOnly") {
    if (recipe.writes.length > 0) problems.push(`"${recipe.id}" is read-only, so it cannot write`);
    if (recipe.refuse.length > 0) problems.push(`"${recipe.id}" is read-only, so it never refuses`);
  } else {
    for (const one of recipe.refuse) {
      if (one.when.length === 0) problems.push(`"${recipe.id}" has a refusal with no condition`);
      for (const when of one.when) {
        if (!when.path.trim()) problems.push(`"${recipe.id}" has a condition with no key`);
      }
      if (!one.say.trim()) problems.push(`"${recipe.id}" has a refusal with no reason to give`);
    }
    for (const one of recipe.writes) {
      if (!one.path.trim()) problems.push(`"${recipe.id}" has a write with no key`);
      if (one.set === "text" && !one.text?.trim()) {
        problems.push(`write to "${one.path}" has no text`);
      }
    }
    if (recipe.writes.length === 0) problems.push(`"${recipe.id}" is mutating but writes nothing`);
  }
  return problems;
}

/** All of them, or true when there are none to check. */
function holdsAll(conditions: Condition[] | undefined, record: Facts, pool: Facts): boolean {
  return (conditions ?? []).every((one) => holds(one, record, pool));
}

function holds(condition: Condition, record: Facts, pool: Facts): boolean {
  const value = (record[condition.path] ?? "").trim();
  const target = condition.value ? render(condition.value, pool).text.trim() : "";
  switch (condition.test) {
    case "isTrue":
      return value === "true";
    case "isFalse":
      return value === "false";
    case "isEmpty":
      return value === "";
    case "isSet":
      return value !== "";
    case "equals":
      return value === target;
    case "notEquals":
      return value !== target;
    case "isFuture":
      return value !== "" && new Date(value).getTime() > Date.now();
    case "isPast":
      return value !== "" && new Date(value).getTime() <= Date.now();
  }
}

/** A record value, as the reply should read it. */
function display(value: string, format: Format, user: UserRecord): string {
  if (value === "") return "";
  switch (format) {
    case "date":
      return day(value);
    case "time":
      return moment(value);
    case "money":
      return money(Number(value), user.subscription?.currency ?? "USD");
    case "words":
      return words(value);
    case "onOff":
      return value === "true" ? "on" : "off";
    default:
      return value;
  }
}

/** The value a write puts in the record. */
function written(write: { set: SetTo; text?: string; hours?: number }, facts: Facts): unknown {
  switch (write.set) {
    case "true":
      return true;
    case "false":
      return false;
    case "null":
      return null;
    case "now":
      return new Date().toISOString();
    case "inHours":
      return hoursFromNow(write.hours ?? 1);
    case "text":
      return render(write.text ?? "", facts).text;
  }
}

/**
 * A copy of `value` with `path` set, creating the objects on the way down.
 *
 * Immutable, like every `run` in the registry: the record handed in is never
 * touched, so `changesBetween` can still measure what moved.
 */
export function setPath(value: unknown, path: string, next: unknown): unknown {
  const [key, ...rest] = path.split(".");
  if (key === undefined) return next;

  if (Array.isArray(value)) {
    const index = Number(key);
    if (!Number.isInteger(index)) return value;
    const copy = [...value];
    copy[index] = rest.length === 0 ? next : setPath(copy[index], rest.join("."), next);
    return copy;
  }

  const object =
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ...object,
    [key]: rest.length === 0 ? next : setPath(object[key], rest.join("."), next),
  };
}
