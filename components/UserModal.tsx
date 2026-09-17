import { useCallback, useEffect, useRef, useState } from "react";

import type { UserRecord } from "@/lib/types";

/**
 * The test customer, on screen.
 *
 * Two jobs. It tells whoever is trying the demo what the bot knows about the
 * person it is talking to, so a reply like "your card expired" reads as a fact
 * rather than a guess. And it lets that record be edited, so the same tree can
 * be driven down a different branch without touching the nodes.
 *
 * - The JSON tab takes effect as you type, as soon as the text parses. Bad
 *   JSON is left alone and reported, so half-typed text costs nothing.
 * - "Reset user" fills the form from data/user.default.json, which is never
 *   written.
 * - "Cancel", the backdrop and Escape all close it.
 *
 * There is no Apply and no save, and nothing here ever writes a file: the
 * record lives in this browser and rides along with the next message.
 *
 * A mutating automation changes that same record. Whatever it touched arrives
 * in `moved`, whether it happened while this was open or while it was shut:
 * those sections open themselves and those fields turn green. So a bot action
 * is something you watch happen, or something waiting for you when you look.
 *
 * Keys are printed exactly as the JSON spells them, because a key here is a
 * slot name in a reply: `emailOnFile` under `account` is `{{account.emailOnFile}}`
 * in the left bar, and clicking the row copies it in that form. Prettifying
 * them into "Email on file" only hid the one thing a builder came here for.
 */
export default function UserModal({
  user,
  defaults,
  moved,
  onApply,
  onClose,
}: {
  user: UserRecord;
  /** The shipped record, for "Reset user". */
  defaults: UserRecord;
  /**
   * Dotted paths the bot has changed since this was last looked at, as
   * `lib/render.ts` writes them. Held above this modal, so it survives being
   * shut.
   */
  moved: string[];
  onApply: (user: UserRecord) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<UserRecord>(user);
  // The JSON tab edits text, not an object, so half-typed JSON is allowed to
  // sit there. Every keystroke is parsed, and only a parse that works is
  // pushed out.
  const [tab, setTab] = useState<"overview" | "json">("overview");
  const [text, setText] = useState(() => JSON.stringify(user, null, 2));
  const [problem, setProblem] = useState<string | null>(null);
  // Your own clicks on the dropdowns. A section you have not touched follows
  // the record instead: see `opened` below.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  // The last path copied as a slot, so the row can confirm it. One at a time,
  // and it clears itself, because it is feedback rather than state.
  const [copied, setCopied] = useState<string | null>(null);
  const shown = useRef(user);
  const dialog = useRef<HTMLDivElement>(null);

  /** Put `{{path}}` on the clipboard, in the form a response wants it. */
  const copy = useCallback((path: string) => {
    void navigator.clipboard?.writeText(`{{${path}}}`);
    setCopied(path);
    window.setTimeout(() => setCopied((at) => (at === path ? null : at)), 1200);
  }, []);

  /** The record changed underneath this modal. Follow it, on both tabs. */
  useEffect(() => {
    if (shown.current === user) return;
    shown.current = user;
    setDraft(user);
    setText(JSON.stringify(user, null, 2));
    setProblem(null);
  }, [user]);

  const sections = Object.keys(draft).filter((key) => isSection(draft, key));

  /**
   * Which dropdowns are open, worked out rather than remembered.
   *
   * Your own click always wins. Left alone, every section starts shut, so the
   * modal opens as a short list of section names. A section still opens itself
   * if the bot changed something inside it — a mark is no use in a shut section.
   */
  const opened = (section: string): boolean =>
    toggled[section] ?? moved.some((path) => path.startsWith(`${section}.`));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Load the draft from an object, keeping both tabs showing the same thing. */
  const load = (next: UserRecord) => {
    setDraft(next);
    setText(JSON.stringify(next, null, 2));
    setProblem(null);
  };

  /**
   * The JSON tab, one keystroke at a time.
   *
   * The text is always kept, so you can type through a broken state. A parse
   * that works is pushed straight into the working record: there is no Apply
   * to press. `shown` is moved along with it, so the effect above does not
   * treat our own push as an outside change and reformat what you are typing.
   */
  const edit = (next: string) => {
    setText(next);
    let parsed: UserRecord;
    try {
      parsed = JSON.parse(next) as UserRecord;
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "invalid JSON");
      return;
    }
    setProblem(null);
    setDraft(parsed);
    shown.current = parsed;
    onApply(parsed);
  };

  const reset = () => {
    setProblem(null);
    load(defaults);
    shown.current = defaults;
    onApply(defaults);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (!dialog.current?.contains(event.target as globalThis.Node)) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Test user"
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-line bg-background shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[14px] font-semibold">Test user</h2>
            <p className="font-mono text-[11px] text-muted">{draft.signedInAs}</p>
            <p className="mt-0.5 text-[11px] text-muted">
              Click any field to copy it as a <span className="font-mono">{"{{slot}}"}</span>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-line">
              <Tab label="Overview" on={tab === "overview"} onClick={() => setTab("overview")} />
              <Tab label="JSON" on={tab === "json"} onClick={() => setTab("json")} />
            </div>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </header>

        {problem && (
          <p className="shrink-0 border-b border-line bg-[var(--bad-bg)] px-5 py-2 text-[12px] text-[var(--bad)]">
            · {problem}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === "overview" ? (
            <div className="space-y-2">
              {Object.entries(draft)
                // id and signedInAs are already in the header.
                .filter(([key]) => sections.includes(key))
                .map(([section, value]) => {
                  const touched = moved.filter((path) => path.startsWith(`${section}.`));
                  return (
                    <Section
                      key={section}
                      name={section}
                      open={opened(section)}
                      changed={touched.length}
                      onToggle={() =>
                        setToggled((current) => ({
                          ...current,
                          [section]: !opened(section),
                        }))
                      }
                    >
                      <Rows
                        value={value}
                        path={section}
                        depth={1}
                        moved={moved}
                        copied={copied}
                        onCopy={copy}
                      />
                    </Section>
                  );
                })}
            </div>
          ) : (
            <textarea
              spellCheck={false}
              className="field h-[52vh] resize-none font-mono text-[12px] leading-relaxed"
              value={text}
              onChange={(event) => edit(event.target.value)}
            />
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">
          <button type="button" className="btn" onClick={reset}>
            Reset user
          </button>
        </footer>
      </div>
    </div>
  );
}

/** One step of indent per level of the record. */
const INDENT = 18;

/**
 * Where every value starts, measured from the left edge of the list.
 *
 * The key column is this wide whatever its depth: a key keeps its indent and
 * gives up that much of its own width, so the values below it stay in one
 * straight line no matter how deep the key sits. Wide enough for the longest
 * key in the shipped record, at the depth it sits at.
 */
const VALUE_COLUMN = 196;

/**
 * The record, rendered straight from its own shape.
 *
 * Nothing here names a field, so an automation that adds one gets a row for
 * free and this file never goes stale.
 *
 * Everything is left justified and every key is pushed right by its own depth,
 * so the shape of the record is the shape on screen. A key whose value is
 * another object or a list is a heading: the value sits under it, one step in.
 */
function Rows({
  value,
  path,
  depth = 0,
  moved,
  copied,
  onCopy,
}: {
  value: unknown;
  /** Dotted path to this value, written the way `lib/render.ts` flattens it. */
  path: string;
  depth?: number;
  /** Paths the bot touched. Those rows are marked. */
  moved: string[];
  /** The path whose slot was just copied, so its row can say so. */
  copied: string | null;
  /** Copy `{{path}}`, ready to paste into a response in the left bar. */
  onCopy: (path: string) => void;
}) {
  const pad = { paddingLeft: depth * INDENT };

  if (Array.isArray(value)) {
    if (value.length === 0) return <Empty text="none" />;
    return (
      <div className="space-y-1">
        {value.map((item, index) => (
          <div key={index}>
            {/*
              A hairline between items, and nothing above the first one. It is
              a sibling of the rows rather than a border on them, so indenting
              it cannot push the value column out of line. It starts at the
              item's own indent and is pulled in from the right by the same
              amount, so it sits centred: as far off each edge as the item is
              deep.
            */}
            {index > 0 && (
              <div
                className="my-1.5 border-t border-line"
                style={{
                  marginLeft: (depth + 1) * INDENT,
                  marginRight: (depth + 1) * INDENT,
                }}
              />
            )}
            <Rows
              value={item}
              path={`${path}.${index}`}
              depth={depth + 1}
              moved={moved}
              copied={copied}
              onCopy={onCopy}
            />
          </div>
        ))}
      </div>
    );
  }

  if (value === null) return <Empty text="none" />;

  if (typeof value === "object") {
    return (
      <dl className="space-y-1">
        {Object.entries(value as Record<string, unknown>).map(([key, child]) => {
          const nested = child !== null && typeof child === "object";
          return nested ? (
            <div key={key} className="space-y-1">
              <dt className="font-mono text-[12px] text-muted" style={pad}>
                {key}
              </dt>
              <dd>
                <Rows
                  value={child}
                  path={`${path}.${key}`}
                  depth={depth + 1}
                  moved={moved}
                  copied={copied}
                  onCopy={onCopy}
                />
              </dd>
            </div>
          ) : (
            <div
              key={key}
              className="group flex cursor-pointer items-baseline rounded hover:bg-panel2"
              role="button"
              tabIndex={0}
              title={`Copy {{${path}.${key}}}`}
              onClick={() => onCopy(`${path}.${key}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onCopy(`${path}.${key}`);
              }}
            >
              <dt
                className="shrink-0 break-words pr-2 font-mono text-[12px] text-muted"
                style={{ ...pad, width: VALUE_COLUMN }}
              >
                {key}
                <span className="ml-1.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100">
                  {copied === `${path}.${key}` ? "copied" : "{{ }}"}
                </span>
              </dt>
              <dd
                className="min-w-0 flex-1 break-words font-mono text-[12px]"
                style={moved.includes(`${path}.${key}`) ? { color: "var(--good)" } : undefined}
              >
                {child === null ? <span className="text-muted">none</span> : String(child)}
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }

  return (
    <div className="break-words font-mono text-[12px]" style={{ paddingLeft: VALUE_COLUMN }}>
      {String(value)}
    </div>
  );
}

/**
 * One top-level key of the record, as a dropdown.
 *
 * The record is deep enough that all four sections at once is a wall. Closed,
 * the modal is a list of four things; open, it is the shape of that section
 * and nothing else.
 */
function Section({
  name,
  open,
  changed,
  onToggle,
  children,
}: {
  name: string;
  open: boolean;
  /** How many fields in here the last change touched. */
  changed: number;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 bg-panel px-3 py-2 text-left transition-colors hover:bg-panel2"
      >
        <span className="w-2 shrink-0 text-[10px] text-muted">{open ? "▾" : "▸"}</span>
        <span className="label mb-0 font-mono lowercase tracking-normal">{name}</span>
        {changed > 0 && (
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[10px]"
            style={{ background: "var(--good-bg)", color: "var(--good)" }}
          >
            {changed} changed
          </span>
        )}
      </button>
      {/*
        Slides open at the same speed as the side panels, from the same
        `--slide`. The row is sized in `fr` rather than pixels, so a section
        does not have to be measured to be animated, and it stays mounted
        either way: what is inside keeps its scroll and its state.
      */}
      <div
        className="grid overflow-hidden transition-[grid-template-rows] duration-[var(--slide)] ease-in-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        aria-hidden={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-line px-3 py-2.5">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** A top-level key worth a dropdown: an object or a list, not a bare string. */
function isSection(record: UserRecord, key: string): boolean {
  const value = (record as unknown as Record<string, unknown>)[key];
  return value !== null && typeof value === "object";
}

/** A list with nothing in it. It is a value, so it sits in the value column. */
function Empty({ text }: { text: string }) {
  return (
    <div className="font-mono text-[12px] text-muted" style={{ paddingLeft: VALUE_COLUMN }}>
      {text}
    </div>
  );
}

function Tab({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`cursor-pointer px-2.5 py-1 text-[12px] transition-colors ${
        on ? "bg-panel2 text-foreground" : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
