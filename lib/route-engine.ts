import type { Description, EntryType } from "@typesafe-ai/sdk";

import { answerLeaf, fillFromRecord } from "./automations/run";
import { asChoice, asNoul, asScore, type Oracle, type Question, type Round } from "./oracle";
import { find } from "./tree";
import {
  DEBUG_MODEL,
  FRUSTRATION_LEVELS,
  MAX_FANOUT,
  OTHER,
  type AutomationTrace,
  type BotConfig,
  type BotNode,
  type ChatTurn,
  type Engine,
  type Step,
  type Trace,
  type UserRecord,
} from "./types";

/**
 * Routes one message through the tree.
 *
 * Nothing in this file knows which engine is answering. It plans the questions,
 * spends one round trip on them, walks the answers, applies the gates and runs
 * the leaf's automation — and an `Oracle` supplies the answers. That is what
 * makes the jev-versus-LLM comparison in the chat panel worth anything: the two
 * runs differ by one object, not by two implementations.
 *
 * Every level of the tree goes in one call. jev answers questions in a call in
 * parallel and in isolation, so extra questions cost almost no wall-clock time;
 * that makes speculative fan-out the right shape, and one turn is one round
 * trip whatever the depth. The answers for levels the walk never reaches are
 * thrown away.
 *
 * Riding along in that call:
 *   - a Noul, "does this person want a human?"
 *   - a Score, "how frustrated are they?" against FRUSTRATION_LEVELS
 *
 * Neither depends on where the message lands, so both are read before the walk
 * starts and either can hand off. Low confidence at any level hands off too,
 * rather than guessing.
 *
 * A tree bigger than MAX_FANOUT levels is planned breadth first up to the cap.
 * If the walk then reaches a level nobody asked about, it asks for that one
 * level and carries on, so correctness never depends on the tree being small.
 *
 * The customer record is passed in and the changed one is handed back. There
 * is no database and no file, so a turn that acts on the account is still one
 * round trip and nothing is stored anywhere.
 */

/**
 * The state the engine reads, as a JSON object rather than a pasted blob.
 *
 * The docs ask for labelled keys, and an array for a conversation thread, so
 * the model can tell the turn it must judge from the turns that are only
 * context. A blob leaves that to guesswork; `latest_customer_message` does not.
 */
function buildState(history: ChatTurn[], message: string, turns: number): EntryType {
  const recent = turns > 0 ? history.slice(-turns) : [];
  return {
    earlier_turns: recent.map((turn) => ({ role: turn.role, text: turn.text })),
    latest_customer_message: message,
  };
}

/**
 * How far below an option its subtree is shown. The docs' taxonomy advice is to
 * let the model "see what lives under a branch before committing to it", which
 * is how a vague message reaches the right branch instead of the nearest one.
 *
 * Two levels covers the shipped tree. Deeper costs input tokens for detail the
 * Choice being asked cannot act on anyway.
 */
const SUBTREE_DEPTH = 2;

/**
 * One option, as structured JSON rather than a bare sentence.
 *
 * A leaf is just its criteria text. A branch also lists what sits under it, so
 * "my reset email never arrives" can see `reset_password` sitting under
 * `account` before it has to commit to `account`.
 */
function describeOption(node: BotNode, depth: number): Description {
  const covers = node.label || null;
  if (node.children.length === 0 || depth <= 0) return covers;
  return {
    covers,
    leads_to: Object.fromEntries(
      node.children.map((child) => [child.name, describeOption(child, depth - 1)]),
    ),
  };
}

function criteriaOf(nodes: BotNode[], other: string): Record<string, Description> {
  return {
    ...Object.fromEntries(nodes.map((n) => [n.name, describeOption(n, SUBTREE_DEPTH)])),
    [OTHER]: other,
  };
}

/** How many times this conversation has already asked the customer for more. */
function clarificationsSoFar(history: ChatTurn[]): number {
  return history.filter((turn) => turn.role === "bot" && turn.trace?.clarified).length;
}

/** "the customer's message" at the top, then the branch walked so far. */
function describePath(trail: string[]): string {
  return trail.length === 0 ? "the customer's message" : `a ${trail.join(" > ")} message`;
}

/** A 0-to-N Score read as 0-to-1, so a threshold means the same at any rubric size. */
function normalise(value: number, levels: number): number {
  return levels > 1 ? value / (levels - 1) : 0;
}

/**
 * One turn: what to say, and the customer record if an automation changed it.
 *
 * The record is not part of the trace on purpose. A trace is kept on every
 * turn and sent back as history, and nobody needs twenty copies of the same
 * account riding along with the next message.
 */
export interface TurnResult {
  trace: Trace;
  /** Null unless a mutating automation changed the record this turn. */
  user: UserRecord | null;
}

/** Where a leaf leaves the changed record, on its way out of the turn. */
interface Changed {
  user: UserRecord | null;
}

/** The two signal questions. Their names cannot collide with a level key. */
const WANTS_HUMAN = "wants_human";
const FRUSTRATION = "frustration";

/**
 * One Choice we may need: the options at some point in the tree, and the branch
 * that leads there. `node` is null for the top level.
 */
interface Level {
  key: string;
  node: BotNode | null;
  options: BotNode[];
  /** Ancestor names including `node`, which is what {path} is filled with. */
  trail: string[];
  /** Choices already made above this one. */
  depth: number;
}

function levelOf(node: BotNode | null, top: BotNode[], trail: string[], depth: number): Level {
  return {
    key: node ? `q_${node.id}` : "q_root",
    node,
    options: node ? node.children : top,
    trail,
    depth,
  };
}

/**
 * Every level the walk could possibly reach, breadth first.
 *
 * Breadth first matters when the cap bites: the shallow levels are the ones a
 * turn is most likely to want, so they are the ones worth paying for.
 *
 * Levels that would escalate on sight are skipped. A level with fewer than two
 * options is not a Choice, and a node marked escalate ends the walk, so neither
 * needs a question.
 */
function planLevels(config: BotConfig, start: BotNode | null, budget: number): Level[] {
  const first = levelOf(start, config.root.children, start ? [start.name] : [], 0);
  const planned: Level[] = [];
  const queue: Level[] = [first];

  while (queue.length > 0 && planned.length < budget) {
    const level = queue.shift() as Level;
    if (level.depth >= config.maxDepth) continue;
    if (level.options.length < 2) continue;
    planned.push(level);

    for (const child of level.options) {
      if (child.escalate || child.children.length === 0) continue;
      queue.push(levelOf(child, config.root.children, [...level.trail, child.name], level.depth + 1));
    }
  }
  return planned;
}

/** A trace's engine stamp, which every turn carries. */
interface Ran {
  engine: Engine;
}

/**
 * Debug mode: no engine call, no API key. Typing "2" picks the second child of
 * the node the conversation is on, and the bot walks one level down.
 *
 * It is a developer toggle, so the bot never says a word about it. The replies
 * are the same configured text a real customer would see: no option numbers,
 * no menus. Only the trace read-out shows what was matched.
 *
 * The client carries the position forward, so there is no history to unwind
 * and no "back".
 */
function routeByNumber(
  config: BotConfig,
  message: string,
  startAt: string | null | undefined,
  user: UserRecord | null,
  changed: Changed,
  ran: Ran,
): Trace {
  const started = Date.now();
  const at = startAt ? find([config.root], startAt) : null;
  if (startAt && !at) throw new Error(`unknown start node "${startAt}"`);

  const above = at ? [...at.trail, at.node] : [];
  const level = at ? at.node.children : config.root.children;

  const done = (
    picked: BotNode | null,
    reply: string,
    flags: { escalated: boolean; clarified: boolean },
    reason: string,
    automation: AutomationTrace | null = null,
  ): Trace => ({
    ...ran,
    violations: [],
    sent: null,
    reply,
    ...flags,
    reason,
    automation,
    steps: [
      {
        options: level.map((node) => node.name),
        choice: picked?.name ?? "",
        confidence: picked ? 1 : 0,
        probabilities: {},
      },
    ],
    path: [...above.map((node) => node.id), ...(picked ? [picked.id] : [])],
    startedAt: startAt ?? null,
    escalationNoul: null,
    frustration: null,
    calls: 0,
    asked: 0,
    model: config.model,
    usage: null,
    costUsd: null,
    latencyMs: Date.now() - started,
  });

  const stay = (reply: string, reason: string) =>
    done(null, reply, { escalated: false, clarified: true }, reason);

  if (level.length === 0) {
    return stay(config.clarifyReply, "nothing to pick: this node has no children");
  }

  const choice = Number(message.trim());
  if (!Number.isInteger(choice) || choice < 1 || choice > level.length) {
    return stay(
      config.clarifyReply,
      `"${message.trim()}" is not an option number (1 to ${level.length})`,
    );
  }

  const picked = level[choice - 1];
  if (picked.escalate) {
    return done(
      picked,
      config.escalationReply,
      { escalated: true, clarified: false },
      `picked ${picked.name}`,
    );
  }
  if (picked.children.length === 0) {
    if (!picked.response.trim()) {
      return done(
        picked,
        config.escalationReply,
        { escalated: true, clarified: false },
        `node "${picked.name}" is a leaf with no response`,
      );
    }
    // The automation runs here too, so a tree can be walked, and an account
    // really changed, without spending a single engine call.
    const answer = answerLeaf(picked, user, config.automations);
    changed.user = answer.record;
    return answer.escalate
      ? done(
          picked,
          config.escalationReply,
          { escalated: true, clarified: false },
          `picked ${picked.name}: ${answer.reason}`,
          answer.automation,
        )
      : done(
          picked,
          answer.reply,
          { escalated: false, clarified: false },
          `picked ${picked.name} · ${answer.reason}`,
          answer.automation,
        );
  }

  // A node with children answers with its opening line, the same one a chat
  // started there would show.
  const opening = fillFromRecord(picked.response.trim(), user);
  return done(
    picked,
    opening.escalate || !opening.reply ? config.clarifyReply : opening.reply,
    { escalated: false, clarified: false },
    opening.reply ? `picked ${picked.name}` : `node "${picked.name}" has no opening line`,
  );
}

/**
 * Enter one node, with no customer message and no engine call.
 *
 * "Start chat here" on a leaf has nothing to classify. Whatever the customer
 * might have said, the answer is that leaf's, so the chat opens with it: the
 * automation runs, the canned reply is filled, and the record it changed goes
 * back the same way a normal turn's does.
 *
 * A node with children is only its opening line, so this costs nothing there
 * either. Both are free: no engine call, no API key needed — which is why both
 * sides of a comparison show the same thing here.
 */
export function enter(
  config: BotConfig,
  nodeId: string,
  user: UserRecord | null = null,
  ran: Ran = { engine: "jev" },
): TurnResult {
  const started = Date.now();
  const hit = find([config.root], nodeId);
  // The whole trail, so the canvas can draw the way in and badge the node the
  // conversation is sitting on.
  const path = hit ? [...hit.trail.map((node) => node.id), hit.node.id] : [];

  const done = (
    reply: string,
    escalated: boolean,
    reason: string,
    automation: AutomationTrace | null = null,
  ): Trace => ({
    ...ran,
    violations: [],
    sent: null,
    reply,
    escalated,
    clarified: false,
    reason,
    steps: [],
    path,
    startedAt: nodeId,
    automation,
    escalationNoul: null,
    frustration: null,
    calls: 0,
    asked: 0,
    model: config.model,
    usage: null,
    costUsd: null,
    latencyMs: Date.now() - started,
  });

  const handOff = (reason: string, automation: AutomationTrace | null = null): TurnResult => ({
    trace: done(config.escalationReply, true, reason, automation),
    user: null,
  });

  if (!hit) return handOff(`unknown node "${nodeId}"`);
  const node = hit.node;
  if (node.escalate) return handOff(`node "${node.name}" is marked escalate`);
  if (!node.response.trim()) return handOff(`node "${node.name}" has no response`);

  const answer =
    node.children.length === 0
      ? answerLeaf(node, user, config.automations)
      : fillFromRecord(node.response, user);

  if (answer.escalate) {
    return {
      trace: done(
        config.escalationReply,
        true,
        `entered ${node.name}: ${answer.reason}`,
        answer.automation,
      ),
      // Kept even on a hand-off: the automation may have changed the account
      // before the sentence describing it turned out to have a hole in it.
      user: answer.record,
    };
  }

  return {
    trace: done(answer.reply, false, `entered ${node.name} · ${answer.reason}`, answer.automation),
    user: answer.record,
  };
}

export interface RouteInput {
  config: BotConfig;
  history: ChatTurn[];
  message: string;
  /** Who answers the questions. The only thing that differs between engines. */
  oracle: Oracle;
  /** Start partway down the tree, from the node panel's "Start chat here". */
  startAt?: string | null;
  /**
   * The customer the bot is talking to, as the browser holds it. Omitted, an
   * automation cannot run and a leaf that wants one hands off to a human.
   */
  user?: UserRecord | null;
}

export async function route(input: RouteInput): Promise<TurnResult> {
  const changed: Changed = { user: null };
  const trace = await runTurn(input, changed);
  return { trace, user: changed.user };
}

async function runTurn(input: RouteInput, changed: Changed): Promise<Trace> {
  const { config, history, message, oracle, startAt, user = null } = input;
  const ran: Ran = { engine: oracle.engine };

  // Debug mode never talks to an engine, so it runs before the key is read.
  if (config.model === DEBUG_MODEL) {
    return routeByNumber(config, message, startAt, user, changed, ran);
  }

  const started = Date.now();
  const state = buildState(history, message, config.historyTurns);

  const steps: Step[] = [];
  const path: string[] = [];
  const violations: string[] = [];
  let sent: string | null = null;
  let escalationNoul: number | null = null;
  let frustration: number | null = null;
  let model = oracle.model;
  let inTokens = 0;
  let outTokens = 0;
  let calls = 0;
  let asked = 0;

  const finish = (
    extra: Pick<Trace, "reply" | "escalated" | "clarified" | "reason"> & {
      automation?: AutomationTrace | null;
    },
  ): Trace => ({
    ...ran,
    violations,
    sent,
    automation: null,
    ...extra,
    steps,
    path,
    startedAt: startAt ?? null,
    escalationNoul,
    frustration,
    calls,
    asked,
    model,
    usage: inTokens ? { input_tokens: inTokens, output_tokens: outTokens } : null,
    // Arithmetic only. The rate comes off the Oracle, so this stays true for
    // whatever engine is behind it and the walk still cannot tell which.
    costUsd:
      oracle.rate && inTokens
        ? (inTokens * oracle.rate.input + outTokens * oracle.rate.output) / 1_000_000
        : null,
    latencyMs: Date.now() - started,
  });

  const escalate = (reason: string) =>
    finish({ reply: config.escalationReply, escalated: true, clarified: false, reason });

  /**
   * Nothing fits. Ask the customer to say more, up to the configured number of
   * tries, and hand off once those are used up.
   */
  const clarify = (reason: string) => {
    const used = clarificationsSoFar(history);
    if (used >= config.maxClarifications) {
      return escalate(`nothing fits after ${used} clarification(s): ${reason}`);
    }
    return finish({
      reply: config.clarifyReply,
      escalated: false,
      clarified: true,
      reason: `${reason} (clarification ${used + 1} of ${config.maxClarifications})`,
    });
  };

  /**
   * The leaf has been chosen. Run its automation, fill its canned reply, and
   * hand off instead if either could not be done honestly.
   */
  const answerAt = (leaf: BotNode, where: string): Trace => {
    const answer = answerLeaf(leaf, user, config.automations);
    changed.user = answer.record;
    if (answer.escalate) {
      return finish({
        reply: config.escalationReply,
        escalated: true,
        clarified: false,
        reason: `${where}: ${answer.reason}`,
        automation: answer.automation,
      });
    }
    return finish({
      reply: answer.reply,
      escalated: false,
      clarified: false,
      reason: `${where} · ${answer.reason}`,
      automation: answer.automation,
    });
  };

  // Where this turn starts. "Start chat here" drops the customer into one node,
  // so its parents are skipped and the first Choice is over its children only.
  let start: BotNode | null = null;
  if (startAt) {
    const hit = find([config.root], startAt);
    if (!hit) return escalate(`unknown start node "${startAt}"`);
    if (hit.node.escalate) return escalate(`node "${hit.node.name}" is marked escalate`);
    if (hit.node.children.length === 0) {
      if (!hit.node.response.trim()) {
        return escalate(`node "${hit.node.name}" is a leaf with no response`);
      }
      return answerAt(hit.node, `started at leaf ${hit.node.name}`);
    }
    path.push(hit.node.id);
    start = hit.node;
  }

  const questionFor = (level: Level): Question => ({
    kind: "choice",
    instructions: config.prompts.classify.replaceAll("{path}", describePath(level.trail)),
    criteria: criteriaOf(level.options, config.prompts.other),
  });

  /** One round trip. Everything handed over is answered by it. */
  const spend = async (questions: Record<string, Question>): Promise<Round> => {
    const round = await oracle.ask(questions, state);
    calls += 1;
    asked += Object.keys(questions).length;
    model = round.model;
    violations.push(...round.violations);
    if (sent === null) sent = round.sent;
    if (round.usage) {
      inTokens += round.usage.input_tokens;
      outTokens += round.usage.output_tokens;
    }
    return round;
  };

  const planned = planLevels(config, start, MAX_FANOUT);
  if (planned.length === 0) return escalate("no level has two or more options to choose between");

  /**
   * What goes in the first call: every planned level, so one turn is one round
   * trip. The two signals ride along in it for both engines — they do not
   * depend on the walk, so making one engine pay a separate trip for them
   * would be a difference that is not about routing.
   */
  const upfront = planned;

  const questions: Record<string, Question> = {
    [WANTS_HUMAN]: { kind: "noul", instructions: config.prompts.escalation },
    [FRUSTRATION]: {
      kind: "score",
      instructions: config.prompts.frustration,
      levels: FRUSTRATION_LEVELS,
    },
  };
  for (const level of upfront) questions[level.key] = questionFor(level);

  const first = await spend(questions);

  const answers = new Map(
    upfront.map((level) => [level.key, asChoice(first.answers[level.key], level.key)]),
  );

  escalationNoul = asNoul(first.answers[WANTS_HUMAN]);
  const rubric = asScore(first.answers[FRUSTRATION]);
  frustration = rubric === null ? null : normalise(rubric, FRUSTRATION_LEVELS.length);

  // Both signals are read before the walk. Neither depends on where the message
  // lands, so there is no reason to route first and ask later.
  if (escalationNoul !== null && escalationNoul >= config.thresholds.escalation) {
    return escalate(`customer wants a human (noul ${escalationNoul.toFixed(2)})`);
  }
  if (frustration !== null && frustration >= config.thresholds.frustration) {
    return escalate(`customer is frustrated (score ${frustration.toFixed(2)})`);
  }

  /**
   * A level the first call did not cover: the rare tree deeper or wider than
   * MAX_FANOUT, and one extra round trip when it happens.
   */
  const askLate = async (level: Level) => {
    const late = await spend({ [level.key]: questionFor(level) });
    return asChoice(late.answers[level.key], level.key);
  };

  // The walk. Every answer is already in hand, so this is plain code over data
  // unless the fan-out cap bit and a level has to be bought late.
  let level = levelOf(start, config.root.children, start ? [start.name] : [], 0);
  const trail: string[] = start ? [start.name] : [];

  for (let depth = 0; depth < config.maxDepth; depth += 1) {
    if (level.options.length < 2) return escalate(`level ${depth + 1} has fewer than 2 options`);

    const answer = answers.get(level.key) ?? (await askLate(level));

    steps.push({
      options: level.options.map((n) => n.name),
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: { ...answer.probabilities },
    });

    // Nothing on this level fits. Ask for more rather than guessing.
    if (answer.choice === OTHER) {
      return clarify(`no option fits at ${trail.join(" > ") || "the top level"}`);
    }

    const picked = level.options.find((n) => n.name === answer.choice);
    if (!picked) return escalate(`unknown node "${answer.choice}"`);

    path.push(picked.id);
    trail.push(picked.name);

    if (answer.confidence < config.thresholds.node) {
      return escalate(`low confidence at ${trail.join(" > ")} (${answer.confidence.toFixed(2)})`);
    }
    if (picked.escalate) return escalate(`node "${picked.name}" is marked escalate`);

    // A leaf ends the walk. Its response is the answer.
    if (picked.children.length === 0) {
      if (!picked.response.trim()) {
        return escalate(`node "${picked.name}" is a leaf with no response`);
      }
      return answerAt(picked, `routed to ${trail.join(" > ")}`);
    }

    level = levelOf(picked, config.root.children, [...trail], depth + 1);
  }

  return escalate(`hit maxDepth (${config.maxDepth}) at ${trail.join(" > ") || "the top"}`);
}
