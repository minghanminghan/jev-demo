import { useEffect, useRef, useState } from "react";

import AutoTextarea from "@/components/AutoTextarea";
import { providerById, PROVIDERS } from "@/lib/providers";
import type { BotConfig, LlmSettings } from "@/lib/types";

/** The parts of the config that are not nodes. */
type Settings = Pick<
  BotConfig,
  | "model"
  | "thresholds"
  | "prompts"
  | "escalationReply"
  | "clarifyReply"
  | "maxClarifications"
  | "historyTurns"
  | "maxDepth"
>;

function pick(config: BotConfig): Settings {
  const {
    model,
    thresholds,
    prompts,
    escalationReply,
    clarifyReply,
    maxClarifications,
    historyTurns,
    maxDepth,
  } = config;
  return {
    model,
    thresholds,
    prompts,
    escalationReply,
    clarifyReply,
    maxClarifications,
    historyTurns,
    maxDepth,
  };
}

/**
 * Settings live in a modal, edited on a draft copy.
 *
 * - "Apply" pushes the draft into the working config and leaves the modal open.
 * - "Reset" fills the form from the shipped settings, settings only: the
 *   nodes are left exactly as they are, and so is the API key.
 * - "Cancel", the backdrop and Escape all close and throw the draft away.
 *
 * Apply is the whole of it. There is no save: the working config *is* the bot,
 * so the next message uses these the moment you press it.
 *
 * Both API keys are the exception: neither enters the config. They stay in the
 * browser and ride along with each chat request.
 */
export default function SettingsModal({
  config,
  defaults,
  apiKey,
  onApiKey,
  llm,
  onLlm,
  onApply,
  onClose,
}: {
  config: BotConfig;
  /** The shipped config, for "Reset settings". */
  defaults: BotConfig;
  apiKey: string;
  onApiKey: (key: string) => void;
  /** The LLM the comparison runs against. Empty until someone fills it in. */
  llm: LlmSettings;
  onLlm: (settings: LlmSettings) => void;
  onApply: (settings: Settings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Settings>(() => pick(config));
  const [keyDraft, setKeyDraft] = useState(apiKey);
  const [llmDraft, setLlmDraft] = useState<LlmSettings>(llm);
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * What the last press did, shown in the footer for a moment.
   *
   * Applying leaves the modal open and changes nothing on screen, so without
   * this a press looks like nothing happened. The count goes up on every
   * press, so pressing twice plays the nudge twice rather than sitting there
   * looking stale.
   */
  const [done, setDone] = useState<{ text: string; run: number } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const clearDone = useRef<number | undefined>(undefined);

  /** Say what just happened, and take it back down after a moment. */
  const note = (text: string) => {
    setDone((last) => ({ text, run: (last?.run ?? 0) + 1 }));
    window.clearTimeout(clearDone.current);
    clearDone.current = window.setTimeout(() => setDone(null), 2000);
  };

  // A press right before closing must not set state on a gone component.
  useEffect(() => () => window.clearTimeout(clearDone.current), []);

  const applyAll = () => {
    onApply(draft);
    onApiKey(keyDraft);
    onLlm(llmDraft);
    note("Applied. ");
  };

  const setLlm = <K extends keyof LlmSettings>(key: K, value: LlmSettings[K]) =>
    setLlmDraft({ ...llmDraft, [key]: value });

  const provider = providerById(llmDraft.providerId);
  const openaiShaped = provider?.sdk === "openai-compatible";
  /** No default of its own, so the user really does have to supply one. */
  const needsUrl = openaiShaped && provider?.api === null;

  /**
   * Put the settings back to the shipped ones. Only the settings: the tree
   * comes from the same file but is not touched, which is what makes this
   * different from Reset in the header.
   */
  const reset = () => {
    setProblem(null);
    const original = pick(defaults);
    setDraft(original);
    onApply(original);
    note("Reset. ");
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setThreshold = (key: keyof Settings["thresholds"], value: number) =>
    setDraft({ ...draft, thresholds: { ...draft.thresholds, [key]: value } });

  const setPrompt = (key: keyof Settings["prompts"], value: string) =>
    setDraft({ ...draft, prompts: { ...draft.prompts, [key]: value } });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-[2px]"
      // Only a click on the backdrop itself counts, not one that bubbled up
      // from inside the panel.
      onMouseDown={(event) => {
        if (!dialog.current?.contains(event.target as globalThis.Node)) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-line bg-background shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[14px] font-semibold">Settings</h2>
            <p className="text-[11px] text-muted">Apply and the next message uses these.</p>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </header>

        {problem && (
          <p className="shrink-0 border-b border-line bg-[var(--bad-bg)] px-5 py-2 text-[12px] text-[var(--bad)]">
            · {problem}
          </p>
        )}

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <section className="space-y-3">
            <span className="label mb-0">jev</span>
            <div>
              <span className="label">API key</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="apikey_…"
                className="field font-mono"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
            </div>
            <div>
              <span className="label">Model</span>
              <input
                className="field font-mono"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              />
            </div>
          </section>

          {/*
            The other side of the comparison: a provider, a model, a key.

            The list is data/providers.json, snapshotted from models.dev by
            scripts/snapshot-providers.mjs. Two things it buys, beyond less
            typing:

              - Every provider with a first-party AI SDK package already knows
                its own URL, so there is nothing to look up. Base URL is an
                override for a self-hosted box, tucked away below.
              - Only models that report structured output are listed. A model
                that cannot be held to a schema cannot answer the question, and
                offering one would turn "this model lost" into a claim about
                LLMs when it is a fact about the pick.
          */}
          <section className="space-y-3 border-t border-line pt-5">
            <span className="label mb-0">LLM Provider</span>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="label">Provider</span>
                <select
                  className="field cursor-pointer"
                  value={llmDraft.providerId}
                  onChange={(e) => {
                    const next = providerById(e.target.value);
                    // Move to that provider's first model rather than keeping a
                    // model id it has never heard of.
                    setLlmDraft({
                      ...llmDraft,
                      providerId: e.target.value,
                      modelId: next?.models[0]?.id ?? "",
                      baseUrl: "",
                    });
                  }}
                >
                  <option value="">Pick one…</option>
                  {PROVIDERS.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="label">Model</span>
                {provider && provider.models.length > 0 ? (
                  <select
                    className="field cursor-pointer"
                    value={llmDraft.modelId}
                    onChange={(e) => setLlm("modelId", e.target.value)}
                  >
                    {provider.models.map((one) => (
                      <option key={one.id} value={one.id}>
                        {one.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  // `custom`, and any provider whose list came back empty:
                  // nobody can know what is loaded on someone's own box.
                  <input
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="model id"
                    className="field font-mono"
                    value={llmDraft.modelId}
                    onChange={(e) => setLlm("modelId", e.target.value)}
                    disabled={!provider}
                  />
                )}
              </div>
            </div>

            <div>
              <span className="label">API key</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-…"
                className="field font-mono"
                value={llmDraft.apiKey}
                onChange={(e) => setLlm("apiKey", e.target.value)}
              />
            </div>

            {/* Everything nobody should have to fill in. Open when the picked
                provider genuinely needs a URL, shut otherwise. */}
            <details open={needsUrl}>
              <summary className="cursor-pointer text-[11px] text-muted hover:text-foreground">
                Advanced
              </summary>
              <div className="mt-3 space-y-3">
                <div>
                  <span className="label">
                    Base URL {needsUrl ? "" : <span className="text-muted">(override)</span>}
                  </span>
                  <input
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      provider?.api ?? (needsUrl ? "http://localhost:11434/v1" : "the provider's own")
                    }
                    className="field font-mono"
                    value={llmDraft.baseUrl}
                    onChange={(e) => setLlm("baseUrl", e.target.value)}
                  />
                </div>

                {/* Native packages enforce whatever their provider's best
                    mechanism is, so there is nothing to opt into there. */}
                {openaiShaped && (
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      className="cursor-pointer accent-[var(--neutral-fill)]"
                      checked={llmDraft.strictSchema}
                      onChange={(e) => setLlm("strictSchema", e.target.checked)}
                    />
                    <span className="text-[13px]">Strict JSON schema</span>
                  </label>
                )}
              </div>
            </details>
          </section>

          <section className="space-y-3 border-t border-line pt-5">
            <span className="label mb-0">Confidence gates</span>
            <Slider
              label="Node confidence floor"
              value={draft.thresholds.node}
              onChange={(v) => setThreshold("node", v)}
            />
            <Slider
              label="Escalation trigger"
              value={draft.thresholds.escalation}
              onChange={(v) => setThreshold("escalation", v)}
            />
            <Slider
              label="Frustration trigger"
              value={draft.thresholds.frustration}
              onChange={(v) => setThreshold("frustration", v)}
            />
          </section>

          <section className="space-y-3 border-t border-line pt-5">
            <NumberField
              label="Clarifications before escalating"
              value={draft.maxClarifications}
              max={5}
              onChange={(v) => setDraft({ ...draft, maxClarifications: v })}
            />
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Previous turns sent"
                value={draft.historyTurns}
                max={20}
                onChange={(v) => setDraft({ ...draft, historyTurns: v })}
              />
              <NumberField
                label="Max search depth"
                value={draft.maxDepth}
                max={12}
                onChange={(v) => setDraft({ ...draft, maxDepth: v })}
              />
            </div>
          </section>
          
          <section className="space-y-3 border-t border-line pt-5">
            <span className="label mb-0">Replies</span>
            <Area
              label="Escalation"
              value={draft.escalationReply}
              onChange={(v) => setDraft({ ...draft, escalationReply: v })}
            />
            <Area
              label="Clarify"
              value={draft.clarifyReply}
              onChange={(v) => setDraft({ ...draft, clarifyReply: v })}
            />
          </section>

          <section className="space-y-3 border-t border-line pt-5">
            {/* Both engines are handed this text verbatim. That is the point:
                a comparison where one side got a reworded question would not
                be measuring the engines. */}
            <span className="label mb-0">Question text — both engines</span>
            <Area
              label="Choice"
              value={draft.prompts.classify}
              onChange={(v) => setPrompt("classify", v)}
            />
            <Area
              label="Noul"
              value={draft.prompts.escalation}
              onChange={(v) => setPrompt("escalation", v)}
            />
            <Area
              label="Score"
              value={draft.prompts.frustration}
              onChange={(v) => setPrompt("frustration", v)}
            />
            <Area
              label="None of these fit"
              value={draft.prompts.other}
              onChange={(v) => setPrompt("other", v)}
            />
          </section>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-5 py-3">
          <button type="button" className="btn" onClick={reset}>
            Reset settings
          </button>
          <div className="flex min-w-0 items-center gap-3">
            {done && (
              <p
                key={done.run}
                role="status"
                className="nudge truncate text-[12px] text-[var(--good)]"
              >
                {done.text}
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary shrink-0"
              onClick={applyAll}
            >
              Apply
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[13px]">{label}</span>
        <span className="font-mono text-[12px] text-muted">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        className="mt-1.5 w-full cursor-pointer accent-[var(--neutral-fill)]"
        // Clearing the box is how you retype, and an empty input reads as NaN.
        // Storing that one poisons every comparison it is used in, so only a
        // real number is kept and the field falls back to the last good one.
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        className="field"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <AutoTextarea value={value} onChange={onChange} />
    </div>
  );
}
