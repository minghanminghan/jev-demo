import type { Recipe } from "./automations/recipe";

/**
 * The extra option handed to jev at every level: "none of these fit". It is
 * not a node, so the name is one nothing else can collide with.
 */
export const OTHER = "__other__";

/**
 * Set the model to this and the bot stops calling jev. The customer picks a
 * child by typing its number instead, which is how you walk a tree by hand.
 */
export const DEBUG_MODEL = "debug";

/**
 * The rubric for the frustration Score. Ordered low to high, and written as
 * situations rather than adjectives, which is what jev reads best.
 *
 * It rides along in the same call as the routing questions, so it costs no
 * extra round trip.
 */
export const FRUSTRATION_LEVELS = [
  "Calm. A plain question or a first report, with no complaint about the service itself.",
  "Mildly annoyed. Some impatience, or a mention that this has taken a while.",
  "Clearly upset. Repeated failures, a complaint about the support they have had, or strong wording.",
  "Angry or threatening to leave. Demands a manager, a refund, or says they will cancel or go public.",
] as const;

/**
 * Where the SDK sends its calls. Not `api.typesafe.ai` directly: that host
 * sends no CORS header, so the browser would refuse the request. This path is
 * proxied straight through to it — by Vite in dev (see vite.config.ts), and by
 * one rewrite rule on whatever serves the built files.
 */
export const JEV_PROXY_PATH = "/api/jev";

/**
 * Where the LLM side of the comparison sends its calls, for the same reason:
 * the browser cannot be trusted to have a CORS header waiting for it at an
 * arbitrary provider. The pass-through reads the real endpoint off a header,
 * so one rule covers every provider the user might type in.
 *
 * Keep it the same as the path in vite.config.ts.
 */
export const LLM_PROXY_PATH = "/api/llm";

/**
 * The header the pass-through reads the real endpoint off.
 *
 * It carries the **whole** URL the provider's own SDK built, not a base to
 * append a path to. That is what lets the form skip the base URL entirely:
 * each SDK keeps its own default, and `lib/providers.ts` moves whatever it
 * produced into this header on the way out.
 */
export const LLM_TARGET_HEADER = "x-llm-url";

/** Choice questions are cheap, but not free. Cap how many ride in one call. */
export const MAX_FANOUT = 24;

/**
 * Who answered the routing questions.
 *
 * Both engines do the identical job: pick one label per level out of a closed
 * set, and read the two side signals. Neither writes a word of the reply.
 */
export type Engine = "jev" | "llm";

/** Human words for a screen. */
export const ENGINE_LABEL: Record<Engine, string> = {
  jev: "jev",
  llm: "llm",
};

/**
 * What the chat panel is running.
 *
 * Two engines at most, and never two of a kind: a comparison is always jev
 * against the LLM, because jev against jev measures nothing and the point of
 * the second column is the other engine.
 */
export type EngineChoice = Engine | "both";

export function enginesIn(choice: EngineChoice): Engine[] {
  return choice === "both" ? ["jev", "llm"] : [choice];
}

/**
 * The LLM endpoint the comparison calls, as picked in Settings.
 *
 * Deliberately close to nothing: a provider, a model, a key. The provider list
 * and the models under it come from `data/providers.json`, and every provider
 * with a first-party AI SDK package already knows its own URL — so `baseUrl`
 * is an override for a self-hosted box or a gateway, not something to look up.
 *
 * The key is held in this tab like the jev one, and never written to the
 * config file.
 */
export interface LlmSettings {
  /** A provider id from `data/providers.json`. */
  providerId: string;
  /** A model id from that provider's list, or typed in on `custom`. */
  modelId: string;
  apiKey: string;
  /** Optional. Empty means "use whatever the provider already knows". */
  baseUrl: string;
  /**
   * Ask for a strict `json_schema` response format.
   *
   * On by default, and it is the fair setting: strict schemas are the
   * strongest structured output a provider offers, so the LLM is measured at
   * its best rather than at JSON-in-a-prompt. Turn it off only for an endpoint
   * that rejects the parameter.
   *
   * Only reaches the OpenAI-compatible path. The native packages enforce
   * whatever their provider's best mechanism is, with nothing to opt into.
   */
  strictSchema: boolean;
}

export function blankLlmSettings(): LlmSettings {
  return { providerId: "", modelId: "", apiKey: "", baseUrl: "", strictSchema: true };
}

/** The whole chatbot, as stored in data/chatbot.json. */
export interface BotConfig {
  /** jev model id. "jev-latest" unless you pin one. */
  model: string;
  /** Confidence gates. Below the floor, the bot escalates instead of guessing. */
  thresholds: {
    /** Minimum confidence on any Choice question, at any level of the tree. */
    node: number;
    /** Noul value at or above which the bot hands off to a human. */
    escalation: number;
    /** Normalised frustration score (0-1) at or above which the bot hands off. */
    frustration: number;
  };
  /** Instructions text for the jev questions. */
  prompts: {
    /** Instructions for every Choice question. {path} is replaced with the
     *  branch walked so far. */
    classify: string;
    /** Instructions for the escalation Noul. */
    escalation: string;
    /** Instructions for the frustration Score. The rubric is FRUSTRATION_LEVELS. */
    frustration: string;
    /** Criteria for the "none of these fit" option added to every Choice. */
    other: string;
  };
  /** Reply sent whenever the bot escalates. */
  escalationReply: string;
  /** Reply sent when no branch fits and the bot asks the customer to say more. */
  clarifyReply: string;
  /** How many times the bot may ask for more detail before it escalates. */
  maxClarifications: number;
  /** How many past turns are pasted into the state jev reads. */
  historyTurns: number;
  /** Safety stop, so a very deep tree cannot loop forever. */
  maxDepth: number;
  /**
   * The shipped automations, as JSON recipes.
   *
   * They live in the config because the config is the one thing every turn is
   * handed: there is no registry anywhere else, so a recipe reaches the engine
   * the same way the tree does. The typed ones in `lib/automations/` are
   * always there and always win on a name clash.
   */
  automations?: Recipe[];
  /**
   * The tree. The root node stands in for the bot's opening line: its
   * `response` is the greeting, and routing starts at its children. Every
   * level below it works the same way, all the way down.
   */
  root: BotNode;
}

/**
 * One node in the routing tree. A node is a node at every level: the top level
 * and the tenth level use the same shape and the same rules.
 *
 * - has children  → jev asks another Choice among them
 * - no children   → the bot sends `response` and stops
 * - escalate      → escalate to human agent, whatever the children say
 */
export interface BotNode {
  id: string;
  /** The label jev returns. Keep it snake_case. */
  name: string;
  /** The Choice criteria text handed to jev. This is the classifier. */
  label: string;
  /**
   * Canned answer. On a leaf it is the reply the bot sends. On a node with
   * children it is the opening line shown when a chat starts there.
   */
  response: string;
  /** true = always escalate to human agent, skip any children. */
  escalate: boolean;
  /**
   * Registry id of the automation this leaf runs before it answers, from
   * `lib/automations`. Read-only ones look at the customer record and fill the
   * `{{slots}}` in `response`; mutating ones do something and write it back.
   *
   * Leaves only. A node with children routes, it does not act.
   */
  automation?: string;
  children: BotNode[];
}

/**
 * What a leaf's automation did.
 *
 * `read` is a read-only one, which only ever looked. The other three are
 * mutating: `done` wrote the record, `blocked` refused and said why, `failed`
 * threw and the conversation went to a human.
 */
export type AutomationOutcome = "read" | "done" | "blocked" | "failed";

/** One field of the customer record an automation changed. */
export interface RecordChange {
  /** Dotted path, as `lib/render.ts` flattens the record. */
  path: string;
  /** Display strings. Empty means the field was not there. */
  from: string;
  to: string;
}

/**
 * The automation half of a trace: everything the leaf did before it answered.
 *
 * This is what the chat's **show detail** read-out prints, and the reason a
 * demo can be argued with. `facts` is what the automation looked up, and
 * `changes` is the real difference between the record that came in and the one
 * that went back — measured, not declared.
 */
export interface AutomationTrace {
  id: string;
  /** The registry's one-line description of what this does. */
  title: string;
  kind: "readOnly" | "mutating";
  outcome: AutomationOutcome;
  /** The guard's words on `blocked`, the error on `failed`, else null. */
  reason: string | null;
  /**
   * The facts it read, by slot name. Only its own: the record is available to
   * any reply as a dotted path, and nobody needs 200 of those in a read-out.
   */
  facts: Record<string, string>;
  /** Empty unless a mutating automation ran and something actually moved. */
  changes: RecordChange[];
}

/** One Choice question jev answered on the way down the tree. */
export interface Step {
  /** Node names offered at this level. */
  options: string[];
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

/** What one message comes back as. See `Trace` users in components/. */
export interface Trace {
  /** Which engine answered. Both produce this same shape, on purpose. */
  engine: Engine;
  /**
   * Answers that broke their own question's contract, in plain words.
   *
   * jev cannot fill this: a Choice returns a member of the set it was given,
   * so there is nothing to break. An LLM can return a label nobody offered,
   * a confidence outside 0-1, or probabilities that do not sum. They are
   * counted and repaired rather than retried away, because hiding them would
   * be the thumb on the scale.
   */
  violations: string[];
  /**
   * The first round trip's payload, as text, so the read-out can show what was
   * actually asked. A comparison nobody can audit is a claim, not a
   * measurement. Null on a turn that made no call.
   */
  sent: string | null;
  reply: string;
  escalated: boolean;
  /** True when the bot asked the customer to say more instead of answering. */
  clarified: boolean;
  reason: string;
  /** One entry per level walked, top first. */
  steps: Step[];
  /** Node ids on the chosen path, so the canvas can light them up. */
  path: string[];
  /** Set when the turn started partway down the tree, from "Start chat here". */
  startedAt: string | null;
  /** The leaf's automation, when it had one. Null on every other turn. */
  automation: AutomationTrace | null;
  escalationNoul: number | null;
  /** Frustration Score, normalised to 0-1. Null in debug mode. */
  frustration: number | null;
  /** jev round trips this turn. Fan-out makes this 1 for almost every tree. */
  calls: number;
  /** Questions asked across those calls, routing plus the two signals. */
  asked: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number } | null;
  /**
   * What this turn cost, in US dollars, from the engine's own rate.
   *
   * Null when nothing was spent (debug mode, or opening at a leaf) or when the
   * engine has no published price, so an unknown price never reads as free.
   */
  costUsd: number | null;
  latencyMs: number;
}

export interface ChatTurn {
  role: "customer" | "bot";
  text: string;
  at: number;
  trace?: Trace;
}

/**
 * The one test customer the demo signs you in as, as stored in data/user.json.
 *
 * Every field exists so that some leaf of the shipped tree has something real
 * to act on: the card is expired so `update_card` has a card to fix, the backup
 * codes are gone so `live_agent` under `login_access` is the honest answer,
 * sync is stalled so `troubleshoot_common` has a symptom.
 */
export interface UserRecord {
  id: string;
  /** Shown in the demo header, so a tester knows whose data the bot sees. */
  signedInAs: string;
  account: {
    name: string;
    emailOnFile: string;
    emailVerified: boolean;
    org: string;
    role: string;
    seatsUsed: number;
    createdAt: string;
    mfa: { enabled: boolean; method: string | null; backupCodesLeft: number };
    sso: { enabled: boolean; provider: string | null };
    notifications: Record<string, boolean>;
    lastSignInAt: string;
    lastSignInIp: string;
    failedSignIns: number;
    /** True, on purpose: the `login_access` branch has a real problem to solve. */
    lockedOut: boolean;
    lockedReason: string | null;
    lockExpiresAt: string | null;
    lastOtp: {
      sentAt: string;
      to: string;
      delivered: boolean;
      bounceReason: string | null;
    } | null;
    lastPasswordReset: {
      requestedAt: string;
      completed: boolean;
      linkExpiresAt: string;
    } | null;
    deletionRequest: { requestedAt: string; effectiveAt: string } | null;
    dataExport: { requestedAt: string; readyAt: string; url: string } | null;
  };
  subscription: {
    plan: string;
    planTier: number;
    status: string;
    billingPeriod: string;
    seats: number;
    pricePerSeat: number;
    currency: string;
    monthlyTotal: number;
    autoRenew: boolean;
    renewsOn: string;
    startedOn: string;
    contract: {
      type: string;
      annualCommitment: boolean;
      endsOn: string | null;
    };
    availablePlans: {
      name: string;
      tier: number;
      pricePerSeat: number;
      seatCap: number | null;
    }[];
    paymentMethod: {
      type: string;
      brand: string;
      last4: string;
      expires: string;
      expired: boolean;
    };
    invoices: {
      id: string;
      date: string;
      amount: number;
      status: string;
      failureReason?: string;
      attempts?: number;
      nextRetryAt?: string;
      retryable?: boolean;
      paidAt?: string;
      note?: string;
    }[];
    billingDetails: { companyName: string; taxId: string; country: string };
    /** A live double-charge dispute, so the `live_agent` money branch is earned. */
    openDispute: {
      id: string;
      about: string;
      reason: string;
      amount: number;
      openedAt: string;
      status: string;
    } | null;
    refunds: { id: string; amount: number; issuedAt: string }[];
  };
  technical: {
    browser: string;
    sdk: string;
    /** Just the number, so a recipe can compare it with `sdkLatest`. */
    sdkVersion: string;
    sdkLatest: string;
    apiKeyPrefix: string;
    region: string;
    lastError: {
      at: string;
      code: string;
      message: string;
      requestId: string;
    } | null;
    openTickets: {
      id: string;
      title: string;
      status: string;
      openedAt: string;
    }[];
    knownIncident: {
      id: string;
      title: string;
      status: string;
      startedAt: string;
      affectsThisUser: boolean;
    } | null;
    syncStatus: string;
    storageUsedGb: number;
    storageLimitGb: number;
  };
  history: {
    priorChats: number;
    lastChatAt: string;
    lastChatTopic: string;
    everEscalated: boolean;
    lastEscalationAt: string | null;
    satisfactionLastRating: number | null;
  };
}
