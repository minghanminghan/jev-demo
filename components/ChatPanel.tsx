import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { KIND_LABEL } from "@/lib/automations/types";
import { open as openAt, send as sendTurn } from "@/lib/chat";
import { factsFromRecord, render } from "@/lib/render";
import { ready as llmReady } from "@/lib/providers";
import {
  enginesIn,
  ENGINE_LABEL,
  type AutomationTrace,
  type BotConfig,
  type ChatTurn,
  type Engine,
  type EngineChoice,
  type LlmSettings,
  type Trace,
  type UserRecord,
} from "@/lib/types";

const SAMPLES = [
  "I can't log in",
  "How do I downgrade to a cheaper plan?",
  "I want to see my billing history",
  "Talk to agent",
];

/** The send button is 32px tall, so an empty input is too. */
const INPUT_MIN = 32;
const INPUT_MAX = 112;

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * A routing turn costs a fraction of a cent, so the usual two decimals would
 * print every run as $0.00. Six keeps a single turn readable; past a cent the
 * trailing digits are noise, so it tightens up.
 */
const money = (usd: number) => {
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 0.000001) return "<$0.000001";
  return `$${usd.toFixed(6)}`;
};

/** One engine's conversation. Each lane is wholly its own. */
interface Lane {
  turns: ChatTurn[];
  /** Debug mode walks one level per message, so the position carries forward. */
  cursor: string | null;
  error: string | null;
  /**
   * This lane's copy of the customer record.
   *
   * Each engine gets its own, because a mutating automation writes the record
   * and two engines sharing one would step on each other: whichever answered
   * first would decide what the second one read. Forking it keeps each
   * conversation a clean run of the same starting account.
   */
  user: UserRecord;
}

function freshLanes(user: UserRecord, startAt: string | null): Record<Engine, Lane> {
  const lane = (): Lane => ({ turns: [], cursor: startAt, error: null, user });
  return { jev: lane(), llm: lane() };
}

/**
 * The customer-facing side of the bot, dressed like a real support widget.
 *
 * It runs one engine, or both side by side on the same message. The routing
 * detail is still here, folded away behind a small "why this answer" link, so
 * the conversation reads the way a customer would see it.
 *
 * **What makes the two columns a fair test.** Both lanes are handed the same
 * tree, the same criteria, the same instruction text, the same thresholds, the
 * same state, the same timeout and the same retry budget;
 * the walk, the gates and the automations are literally the same code, because
 * `lib/route-engine.ts` never learns which engine answered (see
 * `lib/oracle.ts`). The LLM is asked for a strict schema, which is the
 * strongest structured output a provider sells. The two calls go out at the
 * same moment rather than one after the other, so neither is measured on a
 * warmer network than the other.
 *
 * What is *not* equalised, and is reported instead of hidden: an LLM's
 * confidence is a number it writes about itself, where jev's is a property of
 * the answer; and an LLM can return something its question did not offer,
 * which is counted under "off-contract" rather than retried away.
 */
export default function ChatPanel({
  config,
  user,
  initialMessage,
  startAt,
  startAtName,
  startAtMessage,
  startAtLeaf,
  debug,
  onNewChat,
  apiKey,
  llm,
  choice,
  onChoice,
  onTrace,
  onRecord,
}: {
  /** The bot, as the browser holds it. Sent with each message, so an edit
   *  answers the very next one. */
  config: BotConfig;
  /** The customer both lanes start from. Sent for the same reason. */
  user: UserRecord;
  initialMessage: string;
  /** Node id the chat begins at, from "Start chat here". Null = the top. */
  startAt: string | null;
  startAtName: string | null;
  /** The start node's response, shown so the customer has something to answer. */
  startAtMessage: string;
  /**
   * The start node is a leaf, so there is nothing to ask about. Its answer is
   * the whole first turn, and it arrives on the way in.
   */
  startAtLeaf: boolean;
  /**
   * Model is "debug": a number picks a child and no engine is called. It only
   * changes where the next message is matched, never what the chat looks like.
   */
  debug: boolean;
  /**
   * Start over from the top. The parent drops the start node, the tree's
   * selection and the trace, then remounts this panel, so the history goes
   * with them.
   */
  onNewChat: () => void;
  /** Typed into Settings. Sent with each request; may be empty. */
  apiKey: string;
  /** Typed into Settings. The other side of the comparison. */
  llm: LlmSettings;
  /** Which engines are running. Two at most, and always jev against the LLM. */
  choice: EngineChoice;
  onChoice: (choice: EngineChoice) => void;
  onTrace: (trace: Trace | null) => void;
  /** A mutating automation changed the customer. This is the new record. */
  onRecord: (user: UserRecord) => void;
}) {
  const engines = enginesIn(choice);
  const comparing = engines.length > 1;

  const [lanes, setLanes] = useState<Record<Engine, Lane>>(() => freshLanes(user, startAt));
  const [busy, setBusy] = useState<Engine[]>([]);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  /*
    Still the panel on screen. The parent remounts this component on New chat,
    on a new start node and on an engine change, so a slow reply can land after
    the conversation that asked for it is gone. `setLanes` on a dead component
    is a no-op, but `onTrace` and `onRecord` write to the parent, which is very
    much alive — they would light the canvas with a discarded path and save a
    discarded record. So both are guarded by this.
  */
  const live = useRef(true);
  useEffect(() => () => {
    live.current = false;
  }, []);

  // The box starts exactly as tall as the send button and grows line by line.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, INPUT_MIN), INPUT_MAX)}px`;
  }, [draft]);

  /**
   * Opening at a leaf. There is no message to classify, so the turn is that
   * leaf's automation and its canned reply, and it arrives before the customer
   * has typed anything. No engine call, so both lanes show the same thing.
   *
   * The ref is the guard: this panel is remounted on every "Start chat here",
   * and an effect that ran twice would run the automation twice.
   */
  const entered = useRef(false);
  useEffect(() => {
    if (!startAt || !startAtLeaf || entered.current) return;
    entered.current = true;

    // Run each lane's leaf out here rather than inside the state updater.
    // `openAt` runs the node's automation, and React is free to call an updater
    // more than once. Nothing has been sent yet, so every lane is still holding
    // the untouched record and the prop is the right starting account for all
    // of them.
    const at = Date.now();
    const opened = enginesIn(choice).map((engine) => {
      try {
        const { trace, user: changed } = openAt(config, startAt, user, engine);
        return { engine, trace, changed, error: null as string | null };
      } catch (caught) {
        return {
          engine,
          trace: null,
          changed: null,
          error: caught instanceof Error ? caught.message : "could not open that node",
        };
      }
    });

    setLanes((current) => {
      const next = { ...current };
      for (const one of opened) {
        next[one.engine] = one.trace
          ? {
              ...current[one.engine],
              error: null,
              turns: [{ role: "bot", text: one.trace.reply, at, trace: one.trace }],
              user: one.changed ?? current[one.engine].user,
            }
          : { ...current[one.engine], error: one.error };
      }
      return next;
    });

    // The canvas follows the first lane, and the record stays in its lane;
    // handing it back is the single-engine case only, see send().
    const lead = opened[0]?.trace;
    if (lead) onTrace(lead);
  }, [startAt, startAtLeaf, choice, config, user, onTrace]);

  /**
   * The opening line with the record's facts in it, filled right here because
   * nothing has to happen for it: no automation, no call.
   *
   * A slot with no fact behind it leaves the whole line as written. The bot
   * would hand off rather than send a sentence with a hole in it, and in the
   * builder the literal `{{slot}}` is the useful thing to see.
   */
  const template = startAt ? startAtMessage : initialMessage;
  const filled = render(template, factsFromRecord(user));
  const opening = filled.missing.length > 0 ? template : filled.text;

  const ready = engines.every((engine) => engine === "jev" || llmReady(llm));
  const working = busy.length > 0;

  async function send(message: string) {
    if (!message.trim() || working || !ready) return;
    setDraft("");
    const at = Date.now();

    // Snapshot each lane before the turn: the history a lane sends is its own,
    // and it must not include the message being answered.
    const before = engines.map((engine) => ({ engine, lane: lanes[engine] }));

    setBusy(engines);
    setLanes((current) => {
      const next = { ...current };
      for (const { engine } of before) {
        next[engine] = {
          ...current[engine],
          error: null,
          turns: [...current[engine].turns, { role: "customer", text: message, at }],
        };
      }
      return next;
    });

    /*
      Both engines go out together, and each one lands on its own. Running them
      one after the other would measure the second on a network the first had
      just warmed up; waiting for both before drawing either would hide the
      thing the comparison is for, which is that one side answered first. So
      every lane writes its own reply and drops its own busy flag the moment it
      resolves, and a slow lane never holds a fast one back.

      The composer still waits for the last lane (see `working`). Sending again
      while one side was mid-turn would give the lanes different histories, and
      then they would no longer be answering the same conversation.
    */
    const lead = engines[0];
    await Promise.all(
      before.map(async ({ engine, lane }) => {
        try {
          const { trace, user: changed } = await sendTurn({
            message,
            history: lane.turns,
            engine,
            apiKey,
            llm,
            startAt: debug ? lane.cursor : startAt,
            config,
            user: lane.user,
          });
          const replyAt = Date.now();
          setLanes((current) => ({
            ...current,
            [engine]: {
              ...current[engine],
              error: null,
              turns: [
                ...current[engine].turns,
                { role: "bot", text: trace.reply, at: replyAt, trace },
              ],
              user: changed ?? current[engine].user,
              cursor: debug ? (trace.path.at(-1) ?? null) : current[engine].cursor,
            },
          }));

          // The canvas highlights one path, so it follows the first lane — jev
          // when both are running.
          if (live.current && engine === lead) onTrace(trace);

          /*
            Handing the changed record back to the rest of the app only makes
            sense with one engine running. With two, there are two records that
            have each moved differently, and picking one to be "the" account
            would quietly make the other lane's automation a no-op. So in
            compare mode the change stays in its lane, where the trace read-out
            still shows every field that moved.
          */
          if (live.current && !comparing && changed) onRecord(changed);
        } catch (caught) {
          const failed = caught instanceof Error ? caught.message : "request failed";
          setLanes((current) => ({
            ...current,
            [engine]: { ...current[engine], error: failed },
          }));
        } finally {
          setBusy((current) => current.filter((one) => one !== engine));
        }
      }),
    );

    input.current?.focus();
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-background px-4 py-3">
        <Avatar />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">Support</p>
        {/* Never disabled. It is the way out of a chat, so it has to work from
            any state the chat can be in — including a turn still in flight, or
            a lane stuck on an error. The parent remounts this panel, so an
            in-flight reply lands on a component that is already gone and
            writes nothing. Pressing it on an empty chat at the root is a
            no-op, and that is cheaper than a button that looks broken. */}
        <button type="button" className="btn" onClick={onNewChat}>
          New chat
        </button>
      </header>

      {/* Changing the engine starts a new comparison, because a conversation
          half-answered by one engine is not a measurement. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-background px-4 py-2">
        <Switch
          label="engine"
          value={choice}
          options={[
            ["jev", "jev"],
            ["llm", "llm"],
            ["both", "both"],
          ]}
          onChange={(next) => onChoice(next as EngineChoice)}
        />
      </div>

      {!ready && (
        <p className="shrink-0 border-b border-line bg-[var(--warn-bg)] px-4 py-2 text-[11px] text-[var(--warn)]">
          No LLM picked yet. Choose a provider and a model under Settings › LLM.
        </p>
      )}

      {comparing && <Scoreboard lanes={lanes} engines={engines} />}

      <div className="flex min-h-0 flex-1">
        {engines.map((engine) => (
          <LaneView
            key={engine}
            engine={engine}
            lane={lanes[engine]}
            labelled={comparing}
            busy={busy.includes(engine)}
            startAt={startAt}
            startAtName={startAtName}
            startAtLeaf={startAtLeaf}
            opening={opening}
            onNewChat={onNewChat}
            onSample={send}
            samplesOn={engine === engines[0]}
          />
        ))}
      </div>

      <form
        className="shrink-0 border-t border-line bg-background p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-line p-1.5 pl-3 focus-within:border-linestrong">
          <textarea
            ref={input}
            rows={1}
            style={{ height: INPUT_MIN, maxHeight: INPUT_MAX }}
            className="flex-1 resize-none overflow-y-auto bg-transparent py-[7px] text-[13px] leading-[18px] outline-none placeholder:text-muted"
            placeholder={comparing ? "Message both…" : "Message support…"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            // Enter sends, Shift+Enter makes a new line, like every chat app.
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(draft);
              }
            }}
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={working || !ready || !draft.trim()}
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-neutralfill text-onneutral transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 19V6M6 12l6-6 6 6" />
            </svg>
          </button>
        </div>
        {comparing && (
          <p className="mt-2 px-1 text-[10px] leading-relaxed text-muted">
            Same tree, criteria and thresholds on both sides; the walk and the
            automations are shared code. The LLM gets a strict schema. Each lane keeps its own
            copy of the account, so neither engine&apos;s writes reach the other — and in this
            mode nothing is written back to User info.
          </p>
        )}
      </form>
    </div>
  );
}

/**
 * The numbers, side by side, for the last turn each lane answered.
 *
 * Round trips are the quantity the fan-out argument is about, so they come
 * first. Everything here is measured, and the ratio is stated rather
 * than described: no engine is called the winner, because a reader looking at
 * two numbers does not need to be told which is smaller.
 */
function Scoreboard({
  lanes,
  engines,
}: {
  lanes: Record<Engine, Lane>;
  engines: Engine[];
}) {
  const last = engines.map((engine) => ({
    engine,
    trace: [...lanes[engine].turns].reverse().find((turn) => turn.trace?.calls)?.trace ?? null,
  }));
  if (last.some((one) => one.trace === null)) return null;

  const ratio = (pick: (trace: Trace) => number) => {
    const [a, b] = last.map((one) => pick(one.trace as Trace));
    if (!a || !b) return null;
    const big = Math.max(a, b);
    const small = Math.min(a, b);
    return small === 0 ? null : `${(big / small).toFixed(1)}×`;
  };

  return (
    <div className="shrink-0 border-b border-line bg-background px-4 py-2 font-mono text-[10px] text-muted">
      <div className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-x-3 gap-y-1">
        <span />
        {last.map((one) => (
          <span key={one.engine} className="text-foreground">
            {ENGINE_LABEL[one.engine]}
          </span>
        ))}
        <span />

        <Row
          name="round trips"
          values={last.map((one) => String((one.trace as Trace).calls))}
          ratio={ratio((trace) => trace.calls)}
        />
        <Row
          name="latency"
          values={last.map((one) => `${(one.trace as Trace).latencyMs} ms`)}
          ratio={ratio((trace) => trace.latencyMs)}
        />
        <Row
          name="tokens"
          values={last.map((one) => {
            const usage = (one.trace as Trace).usage;
            return usage ? String(usage.input_tokens + usage.output_tokens) : "—";
          })}
          ratio={ratio((trace) =>
            trace.usage ? trace.usage.input_tokens + trace.usage.output_tokens : 0,
          )}
        />
        <Row
          name="cost"
          values={last.map((one) => {
            const cost = (one.trace as Trace).costUsd;
            return cost === null ? "—" : money(cost);
          })}
          ratio={ratio((trace) => trace.costUsd ?? 0)}
        />
        <Row
          name="off-contract"
          values={last.map((one) => String((one.trace as Trace).violations.length))}
          ratio={null}
        />
        <Row
          name="landed on"
          values={last.map(
            (one) => (one.trace as Trace).steps.map((step) => step.choice).join(" › ") || "—",
          )}
          ratio={null}
        />
      </div>
    </div>
  );
}

function Row({
  name,
  values,
  ratio,
}: {
  name: string;
  values: string[];
  ratio: string | null;
}) {
  return (
    <>
      <span className="whitespace-nowrap text-muted/70">{name}</span>
      {values.map((value, index) => (
        <span key={index} className="truncate text-foreground" title={value}>
          {value}
        </span>
      ))}
      <span className="whitespace-nowrap text-right">{ratio ?? ""}</span>
    </>
  );
}

/** One engine's column: its own greeting, its own history, its own errors. */
function LaneView({
  engine,
  lane,
  labelled,
  busy,
  startAt,
  startAtName,
  startAtLeaf,
  opening,
  onNewChat,
  onSample,
  samplesOn,
}: {
  engine: Engine;
  lane: Lane;
  /** Two lanes are on screen, so each needs saying which it is. */
  labelled: boolean;
  busy: boolean;
  startAt: string | null;
  startAtName: string | null;
  startAtLeaf: boolean;
  opening: string;
  onNewChat: () => void;
  onSample: (message: string) => void;
  /** Only the first lane draws the sample buttons; they send to both anyway. */
  samplesOn: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [lane.turns, busy]);

  return (
    <div className={`flex min-w-0 flex-1 flex-col ${labelled ? "border-r border-line last:border-r-0" : ""}`}>
      {labelled && (
        <div className="shrink-0 border-b border-line bg-panel2 px-3 py-1.5 font-mono text-[10px] text-muted">
          {ENGINE_LABEL[engine]}
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {startAtName && (
          // Started partway down the tree, so say where we are.
          <p className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted">
            <span>
              Starting inside <span className="font-mono">{startAtName}</span>
            </span>
            <button
              type="button"
              className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground"
              onClick={onNewChat}
            >
              start from the top
            </button>
          </p>
        )}

        {/* The opening line, for a greeting or a node with children. A leaf
            has no opening line: its answer is the first turn. */}
        {!startAtLeaf && (
          <div className="flex gap-2.5">
            <Avatar />
            <Bubble side="bot">{opening || (startAt ? `You are in ${startAtName}.` : "")}</Bubble>
          </div>
        )}

        {lane.turns.length === 0 && !startAt && samplesOn && (
          <div className="flex flex-wrap gap-1.5 pl-10">
            {SAMPLES.map((sample) => (
              <button
                key={sample}
                type="button"
                className="cursor-pointer rounded-full border border-line bg-background px-3 py-1.5 text-left text-[12px] text-muted transition-colors hover:border-linestrong hover:text-foreground"
                onClick={() => onSample(sample)}
              >
                {sample}
              </button>
            ))}
          </div>
        )}

        {lane.turns.map((turn, index) =>
          turn.role === "customer" ? (
            <div key={index} className="flex flex-col items-end gap-1">
              <Bubble side="customer">{turn.text}</Bubble>
              <span className="pr-1 text-[10px] text-muted">{clock(turn.at)}</span>
            </div>
          ) : (
            <div key={index} className="flex gap-2.5">
              <Avatar />
              <div className="min-w-0 flex-1">
                <Bubble side="bot">{turn.text}</Bubble>
                {turn.trace ? (
                  <TraceLink trace={turn.trace} at={turn.at} />
                ) : (
                  <div className="mt-1 pl-1 text-[10px] text-muted">{clock(turn.at)}</div>
                )}
              </div>
            </div>
          ),
        )}

        {busy && (
          <div className="flex gap-2.5">
            <Avatar />
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-line bg-background px-3.5 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="blip inline-block h-1.5 w-1.5 rounded-full bg-muted"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {lane.error && (
          <p className="rounded-xl border border-line bg-[var(--bad-bg)] px-3.5 py-2.5 text-[12px] text-[var(--bad)]">
            {lane.error}
          </p>
        )}
      </div>
    </div>
  );
}

/** A small segmented control. Two of them drive the whole comparison. */
function Switch({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] text-muted">{label}</span>
      <div className="flex overflow-hidden rounded-md border border-line">
        {options.map(([key, text]) => (
          <button
            key={key}
            type="button"
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            className={`cursor-pointer px-2 py-[3px] font-mono text-[10px] transition-colors ${
              value === key
                ? "bg-neutralfill text-onneutral"
                : "text-muted hover:bg-panel2 hover:text-foreground"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neutralfill text-[13px] font-bold text-onneutral">
      j
    </span>
  );
}

/**
 * How wide a bot reply is allowed to get. The trace read-out uses the same
 * width, so it sits under the bubble rather than beside it and the two line up
 * on both edges.
 */
const BOT_WIDTH = "max-w-[92%]";

function Bubble({ side, children }: { side: "bot" | "customer"; children: React.ReactNode }) {
  return (
    <div
      className={
        side === "customer"
          ? "max-w-[82%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-neutralfill px-3.5 py-2.5 text-[13px] leading-relaxed text-onneutral"
          : `${BOT_WIDTH} whitespace-pre-wrap rounded-2xl rounded-bl-md border border-line bg-background px-3.5 py-2.5 text-[13px] leading-relaxed`
      }
    >
      {children}
    </div>
  );
}

/**
 * The routing decision, folded away until asked for.
 *
 * It opens downwards, in the bubble's own column and at the bubble's own
 * width. Reading a reply and then reading why it was sent is one straight line
 * down the page, not a jump sideways.
 */
function TraceLink({ trace, at }: { trace: Trace; at: number }) {
  const [open, setOpen] = useState(false);
  const [showSent, setShowSent] = useState(false);
  const path = trace.steps.map((s) => s.choice).join(" › ") || "no path";

  return (
    <div className={`mt-1 min-w-0 space-y-1.5 ${BOT_WIDTH}`}>
      <div className="flex items-center gap-2 pl-1">
        <span className="shrink-0 whitespace-nowrap text-[10px] text-muted">{clock(at)}</span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="shrink-0 cursor-pointer whitespace-nowrap text-[10px] text-muted underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          {open ? "hide detail" : "show detail"}
        </button>
      </div>
      {open && (
        <div className="min-w-0 space-y-2 rounded-xl border border-line bg-background p-2.5 font-mono text-[10px] text-muted">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded px-1.5 py-0.5"
              style={{
                background: trace.escalated
                  ? "var(--warn-bg)"
                  : trace.clarified
                    ? "var(--panel-2)"
                    : "var(--good-bg)",
                color: trace.escalated
                  ? "var(--warn)"
                  : trace.clarified
                    ? "var(--muted)"
                    : "var(--good)",
              }}
            >
              {trace.escalated ? "escalated" : trace.clarified ? "clarifying" : "routed"}
            </span>
            <span className="text-foreground">
              {ENGINE_LABEL[trace.engine]}
            </span>
            <span>{path}</span>
            <span>· {trace.latencyMs} ms</span>
          </div>
          <div>reason: {trace.reason}</div>

          {/*
            Answers that did not honour their own question, already repaired.
            jev cannot produce one: a Choice returns a member of the set it was
            given. They are shown rather than retried away, because a second
            call to get a cleaner answer would spend the very thing being
            measured.
          */}
          {trace.violations.length > 0 && (
            <div className="rounded-lg border border-[var(--bad)]/40 bg-[var(--bad-bg)] p-2 text-[var(--bad)]">
              <div className="mb-0.5">off-contract {trace.violations.length}</div>
              <div className="space-y-0.5 border-l border-[var(--bad)]/40 pl-1.5">
                {trace.violations.map((violation, index) => (
                  <div key={index} className="break-words">
                    {violation}
                  </div>
                ))}
              </div>
            </div>
          )}

          {trace.automation && <Action automation={trace.automation} />}
          {trace.steps.map((step, index) => (
            <Bars key={index} title={`level ${index + 1}`} probs={step.probabilities} />
          ))}
          {trace.escalationNoul !== null && (
            <div>escalation noul: {trace.escalationNoul.toFixed(3)}</div>
          )}
          {trace.frustration !== null && <div>frustration: {trace.frustration.toFixed(3)}</div>}
          {trace.calls > 0 && (
            <div>
              {trace.asked} questions in {trace.calls} call{trace.calls === 1 ? "" : "s"}
            </div>
          )}
          <div>
            {trace.model}
            {trace.usage && ` · ${trace.usage.input_tokens}+${trace.usage.output_tokens} tokens`}
          </div>
          {trace.costUsd !== null && <div>cost: {money(trace.costUsd)}</div>}

          {/* The payload itself. A comparison nobody can audit is a claim, so
              both engines print what they sent and the two can be read against
              each other. */}
          {trace.sent && (
            <div>
              <button
                type="button"
                onClick={() => setShowSent(!showSent)}
                className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                {showSent ? "hide request" : "show request"}
              </button>
              {showSent && (
                <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel2 p-2">
                  {trace.sent}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Long change lists are a scroll, not a read. Show the head and count the rest. */
const CHANGES_SHOWN = 8;

const TONE: Record<AutomationTrace["outcome"], { background: string; color: string }> = {
  read: { background: "var(--panel-2)", color: "var(--muted)" },
  done: { background: "var(--good-bg)", color: "var(--good)" },
  blocked: { background: "var(--warn-bg)", color: "var(--warn)" },
  failed: { background: "var(--bad-bg)", color: "var(--bad)" },
};

/**
 * What the leaf did before it answered: the automation, what it looked up, and
 * the fields it moved.
 *
 * The changes are measured, not declared — the difference between the record
 * that came in and the one that went back. So this is the place to point at
 * when someone asks whether the bot really did the thing it says it did.
 */
function Action({ automation }: { automation: AutomationTrace }) {
  const facts = Object.entries(automation.facts);
  const shown = automation.changes.slice(0, CHANGES_SHOWN);
  const hidden = automation.changes.length - shown.length;

  return (
    <div className="space-y-1.5 rounded-lg border border-line p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded px-1.5 py-0.5" style={TONE[automation.outcome]}>
          {automation.outcome}
        </span>
        <span className="text-foreground">{automation.id}</span>
        <span>· {KIND_LABEL[automation.kind]}</span>
      </div>
      <div>{automation.title}</div>

      {automation.reason && <div className="break-words">why: {automation.reason}</div>}

      {facts.length > 0 && (
        <Rows title={`looked up ${facts.length}`}>
          {facts.map(([name, value]) => (
            <div key={name} className="break-words">
              <span className="text-foreground">{name}</span> = {value}
            </div>
          ))}
        </Rows>
      )}

      {automation.changes.length > 0 ? (
        <Rows title={`changed ${automation.changes.length}`}>
          {shown.map((change) => (
            <div key={change.path} className="break-words">
              <span className="text-foreground">{change.path}</span> {change.from || "—"} →{" "}
              {change.to || "—"}
            </div>
          ))}
          {hidden > 0 && <div>+{hidden} more</div>}
        </Rows>
      ) : (
        automation.kind === "mutating" && <div>changed nothing</div>
      )}
    </div>
  );
}

function Rows({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-muted/70">{title}</div>
      <div className="space-y-0.5 border-l border-line pl-1.5">{children}</div>
    </div>
  );
}

function Bars({ title, probs }: { title: string; probs: Record<string, number> }) {
  const ranked = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div className="mb-0.5">{title}</div>
      {ranked.map(([label, value]) => (
        <div key={label} className="flex items-center gap-1.5">
          <span className="w-24 truncate">{label}</span>
          <span className="h-1 flex-1 rounded bg-panel2">
            <span
              className="block h-1 rounded bg-[var(--line-strong)]"
              style={{ width: `${Math.max(value * 100, 1)}%` }}
            />
          </span>
          <span className="w-8 text-right">{value.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
