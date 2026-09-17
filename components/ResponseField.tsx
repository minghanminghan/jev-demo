import { useMemo, useRef, useState } from "react";

import AutoTextarea from "@/components/AutoTextarea";
import { slotsFor, type Slot } from "@/lib/automations/preview";
import type { Recipe } from "@/lib/automations/recipe";
import { render, slotsIn } from "@/lib/render";
import type { BotNode, UserRecord } from "@/lib/types";

/**
 * The text a node sends, in the left bar.
 *
 * A `{{slot}}` is a key out of the customer JSON, written exactly as the key
 * reads there — `{{account.emailOnFile}}`, not a nickname. So there is nothing
 * to learn and nothing to look up: the User info panel is the list of slots,
 * and this panel fills them in with the record the chat is actually using.
 *
 * A node's automation can shadow one of those keys with a tidier string, and
 * can add derived keys of its own. Both show up here with their live value and
 * which of the two they came from, so a template can be written without
 * sending a message to find out what a slot holds.
 *
 * Which automation a node runs is fixed in the config. This proof of concept
 * has no editor for it, so nothing here changes it.
 */

/** How many slots the picker lists before it asks you to narrow the search. */
const PICKER_LIMIT = 40;

export function ResponseField({
  label,
  hint,
  value,
  onChange,
  node,
  user,
  recipes,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  node: BotNode;
  /** The live test customer. Null only if it could not be read. */
  user: UserRecord | null;
  /** Recipes from the config, so a recipe's slots show up here too. */
  recipes: Recipe[];
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");

  const slots = useMemo(() => slotsFor(node, user, recipes), [node, user, recipes]);
  const byName = useMemo(() => new Map(slots.map((slot) => [slot.name, slot])), [slots]);

  const used = slotsIn(value);
  const facts = Object.fromEntries(slots.map((slot) => [slot.name, slot.value]));
  const { text, missing } = render(value, facts);

  /** Drop a slot in where the cursor is, rather than at the end. */
  const insert = (name: string) => {
    const token = `{{${name}}}`;
    const el = box.current;
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    onChange(value.slice(0, start) + token + value.slice(end));
    // After React has written the new value, so the caret lands after the slot.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const hits = query.trim()
    ? slots.filter((slot) => slot.name.toLowerCase().includes(query.trim().toLowerCase()))
    : slots;

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <button
          type="button"
          className="btn mb-[5px] py-0.5 text-[11px]"
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
          title="Insert a key from the customer JSON"
        >
          {picking ? "Done" : "{{ }} Insert data"}
        </button>
      </div>

      <AutoTextarea inputRef={box} value={value} onChange={onChange} />
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}

      {picking && (
        <div className="mt-2 rounded-lg border border-line bg-panel p-2">
          <input
            autoFocus
            className="field py-1 font-mono text-[12px]"
            placeholder="search keys, e.g. email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="mt-1.5 max-h-56 space-y-px overflow-y-auto">
            {hits.slice(0, PICKER_LIMIT).map((slot) => (
              <li key={slot.name}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-baseline gap-2 rounded px-1.5 py-1 text-left hover:bg-panel2"
                  onClick={() => insert(slot.name)}
                  title={`Insert {{${slot.name}}}`}
                >
                  <span className="shrink-0 font-mono text-[11px]">{slot.name}</span>
                  <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-muted">
                    {slot.empty ? "empty" : slot.value}
                  </span>
                  {slot.source === "automation" && <Dot />}
                </button>
              </li>
            ))}
            {hits.length === 0 && (
              <li className="px-1.5 py-1 text-[11px] text-muted">no key matches that</li>
            )}
            {hits.length > PICKER_LIMIT && (
              <li className="px-1.5 py-1 text-[11px] text-muted">
                {hits.length - PICKER_LIMIT} more — keep typing
              </li>
            )}
          </ul>
          <p className="mt-1.5 flex items-center gap-1.5 border-t border-line pt-1.5 text-[11px] text-muted">
            <Dot /> from this node&apos;s automation. The rest is the raw record.
          </p>
        </div>
      )}

      {used.length > 0 && (
        <ul className="mt-2 space-y-px">
          {used.map((name) => {
            const slot = byName.get(name);
            const bad = !slot || slot.empty;
            return (
              <li key={name} className="flex items-baseline gap-2 text-[11px]">
                <span
                  className="shrink-0 font-mono"
                  style={bad ? { color: "var(--bad)" } : undefined}
                >
                  {name}
                </span>
                <span className="min-w-0 flex-1 truncate text-right font-mono text-muted">
                  {!slot ? "no such key" : slot.empty ? "empty" : slot.value}
                </span>
                {slot?.source === "automation" && <Dot />}
              </li>
            );
          })}
        </ul>
      )}

      {missing.length > 0 && (
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--bad)" }}>
          No value for {missing.map((name) => `{{${name}}}`).join(", ")}, so this reply is
          never sent — the bot hands off to a human instead.
        </p>
      )}

      {used.length > 0 && missing.length === 0 && (
        <div className="mt-1.5 rounded-lg border border-line bg-panel p-2 text-[12px] leading-snug">
          {text}
        </div>
      )}
    </div>
  );
}

/** Marks a slot that came from the automation rather than the raw record. */
function Dot() {
  return (
    <span
      aria-hidden
      className="mb-px h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: "var(--accent)" }}
    />
  );
}

export type { Slot };
