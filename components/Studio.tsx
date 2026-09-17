import { lazy, Suspense, useEffect, useState } from "react";

import ChatPanel from "@/components/ChatPanel";
import ConfirmModal from "@/components/ConfirmModal";
import Inspector from "@/components/Inspector";
import SettingsModal from "@/components/SettingsModal";
import ThemeToggle from "@/components/ThemeToggle";
import UserModal from "@/components/UserModal";
import { changesBetween } from "@/lib/render";
import { find } from "@/lib/tree";
import {
  blankLlmSettings,
  DEBUG_MODEL,
  type BotConfig,
  type EngineChoice,
  type LlmSettings,
  type Trace,
  type UserRecord,
} from "@/lib/types";
import { problemsIn } from "@/lib/validate";

/**
 * Keys an older build kept in localStorage. Nothing writes them now, so they
 * are cleared once on load rather than left sitting in the browser — one of
 * them held an API key, and another held the customer's email.
 */
const STALE_STORES = ["jev-api-key", "jev-config", "jev-user"];

/**
 * Open width of each side panel, not counting its 20px toggle strip.
 *
 * The node panel has two widths. Showing the whole tree as a list needs very
 * little room; editing one node needs a lot more, because the response field
 * carries its slots, their live values and the automation read-out underneath.
 * So it widens when a node is selected and narrows again when nothing is.
 */
const INSPECTOR_WIDTH = 260;
const INSPECTOR_FOCUS_WIDTH = 440;
const CHAT_WIDTH = 500;

/**
 * The chat gets wider when two engines are in it. Two conversations in 500px
 * is 250px each, which is not enough for a reply and its read-out, so the
 * panel takes the room from the canvas while a comparison is running.
 */
const CHAT_COMPARE_WIDTH = 760;

// React Flow and its layout code are the biggest thing in the bundle, and the
// canvas is not needed to paint the panels either side of it. Split it out so
// the first paint does not wait on it.
const FlowCanvas = lazy(() => import("@/components/FlowCanvas"));

/**
 * Three columns: the node inspector on the left, the canvas in the middle, and
 * the chat on the right. Settings are a modal, so they do not take a column.
 *
 * The bot lives in this tab, in memory. There is no save button and nowhere
 * else it lives: every edit is the live bot at once, and the chat reads it
 * straight off this state. Nothing is persisted, so a reload is a clean start.
 *
 * Theme is the one exception, and it lives in ThemeToggle.
 *
 * The two `*.default.json` files are read on every load. They are the bot and
 * the customer you begin with, and what the Reset buttons put back. They are
 * never written.
 */
export default function Studio({
  defaultConfig,
  defaultUser,
}: {
  defaultConfig: BotConfig;
  defaultUser: UserRecord;
}) {
  const [config, setConfig] = useState<BotConfig>(defaultConfig);
  const [user, setUser] = useState<UserRecord>(defaultUser);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  /**
   * Record paths the bot has changed since the user info modal was last
   * looked at. It is the modal's marks and the header button's badge, so a
   * change made while the modal was shut is not a change anyone has to go
   * hunting for.
   *
   * Only the bot fills this. Your own edits and resets are not news.
   */
  const [unseen, setUnseen] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [showChat, setShowChat] = useState(true);
  // Set by "Start chat here": the chat begins at this node instead of the top.
  const [startAt, setStartAt] = useState<string | null>(null);
  // Bumped on every "Start chat here", so pressing it twice still clears the
  // chat even when the start node has not changed.
  const [chatRun, setChatRun] = useState(0);
  // Both keys live in this tab only. Neither is stored and neither is written
  // to the config file, so closing the tab is the end of them.
  const [apiKey, storeKey] = useState("");
  const [llm, setLlm] = useState<LlmSettings>(blankLlmSettings);
  /**
   * What the chat is running.
   *
   * It lives up here rather than in the panel because changing it has to start
   * a new conversation: half a chat answered by one engine and half by another
   * is not a comparison. `chatRun` below is what remounts it.
   */
  const [choice, setChoice] = useState<EngineChoice>("jev");

  // One-time tidy-up for a browser that used the older, caching build.
  useEffect(() => {
    try {
      for (const key of STALE_STORES) localStorage.removeItem(key);
    } catch {
      /* storage refused: there is nothing stale to clear either */
    }
  }, []);

  // The checks that used to run on save now run on every edit, so a mistake
  // shows up while you are still looking at the node that caused it.
  const problems = problemsIn(config);

  // A developer toggle. In debug mode a message is read as the number of the
  // child to walk into, and jev is never called. Nothing on screen changes.
  const debug = config.model === DEBUG_MODEL;
  const startNode = startAt
    ? (find([config.root], startAt)?.node ?? null)
    : null;

  /**
   * Picking a node always shows its form. If the node panel is collapsed, a
   * click on the canvas opens it, so the selection is never invisible.
   */
  function select(id: string | null) {
    setSelectedId(id);
    if (id) setShowInspector(true);
  }

  /**
   * Clicking empty canvas drops the node, which is also a click away from the
   * panel, so the panel goes with it. The alternative — leaving it open on the
   * list — parks a column of tree next to a canvas you just asked to see.
   *
   * This is only the canvas. `All nodes` inside the panel is navigation within
   * it, so that one stays open and lands on the list.
   */
  function selectFromCanvas(id: string | null) {
    select(id);
    if (!id) setShowInspector(false);
  }

  /**
   * Hiding the node panel drops the selection, so it always comes back at its
   * narrow list width rather than reopening on the form of a node you stopped
   * looking at. Clicking a node opens the panel again and widens it.
   */
  function toggleInspector() {
    if (showInspector) setSelectedId(null);
    setShowInspector(!showInspector);
  }

  /**
   * Reset nodes puts the tree back to the shipped one, so a node deleted by
   * mistake really comes back.
   *
   * Only the tree goes back. Settings, such as the model and the thresholds,
   * and the test user record are both kept: this is for undoing edits to the
   * nodes and nothing else. That is why the button sits under the node panel
   * rather than in the header.
   */
  function reset() {
    setConfirmReset(false);
    setSelectedId(null);
    setConfig({ ...config, root: defaultConfig.root });
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-background px-4 py-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-neutralfill text-[13px] font-bold text-onneutral">
          j
        </span>
        <h1 className="text-[14px] font-semibold">jev demo</h1>
        <a
          href="https://github.com/minghanminghan/jev-demo"
          target="_blank"
          rel="noreferrer noopener"
          title="Source on GitHub"
          aria-label="Source on GitHub"
          className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-panel2 hover:text-foreground"
        >
          <svg
            viewBox="0 0 16 16"
            width="15"
            height="15"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.07-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
        <div className="flex-1" />
        <ThemeToggle />
        <button
          type="button"
          className={`btn ${unseen.length > 0 ? "btn-changed" : ""}`}
          onClick={() => setUserOpen(true)}
          title={
            unseen.length > 0
              ? `The bot changed ${unseen.length} field${unseen.length === 1 ? "" : "s"} since you last looked`
              : undefined
          }
        >
          User info
          {unseen.length > 0 && (
            // Keyed on the count, so a count that goes up remounts and the
            // nudge plays again. A second change is as worth noticing as the
            // first one.
            <span
              key={unseen.length}
              className="nudge rounded px-1.5 py-0.5 font-mono text-[10px]"
              style={{ background: "var(--good)", color: "var(--background)" }}
            >
              {unseen.length}
            </span>
          )}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setSettingsOpen(true)}
        >
          Settings
        </button>
      </header>

      {problems.length > 0 && (
        <ul className="shrink-0 border-b border-line bg-[var(--bad-bg)] px-4 py-2 text-[12px] text-[var(--bad)]">
          {problems.map((problem) => (
            <li key={problem}>· {problem}</li>
          ))}
        </ul>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex shrink-0 border-r border-line bg-panel">
          <Slider
            width={selectedId ? INSPECTOR_FOCUS_WIDTH : INSPECTOR_WIDTH}
            open={showInspector}
          >
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <Inspector
                  config={config}
                  user={user}
                  selectedId={selectedId}
                  onChange={setConfig}
                  onSelect={select}
                  onStartChatHere={(id) => {
                    // The root is the greeting, which is just the normal
                    // start.
                    setStartAt(id === config.root.id ? null : id);
                    setChatRun((run) => run + 1);
                    setTrace(null);
                    setShowChat(true);
                  }}
                />
              </div>
              {/*
                Reset lives under the panel it undoes. It used to sit in the
                header next to Settings and User info, where it read as a
                reset of everything.
              */}
              <div className="shrink-0 border-t border-line p-3">
                <button
                  type="button"
                  className="btn w-full"
                  title="Put the tree back to the shipped one"
                  onClick={() => setConfirmReset(true)}
                >
                  Reset nodes
                </button>
              </div>
            </div>
          </Slider>
          <PanelToggle
            side="left"
            open={showInspector}
            onClick={toggleInspector}
          />
        </aside>

        <main className="min-w-0 flex-1">
          <Suspense fallback={<div className="h-full bg-background" />}>
            <FlowCanvas
              config={config}
              trace={trace}
              // `startNode` and not `startAt`: the node can be deleted, or taken
              // away by Reset nodes, while the chat still points at it. Falling
              // back to the top beats routing from an id that is no longer there.
              startAt={startNode ? startAt : null}
              selectedId={selectedId}
              onSelect={selectFromCanvas}
            />
          </Suspense>
        </main>

        <aside className="flex shrink-0 border-l border-line bg-panel">
          <PanelToggle
            side="right"
            open={showChat}
            onClick={() => setShowChat(!showChat)}
          />
          <Slider width={choice === "both" ? CHAT_COMPARE_WIDTH : CHAT_WIDTH} open={showChat}>
            <ChatPanel
              // Remounting on a new start node is the reset: fresh history,
              // nothing carried over from the last conversation. The engine is
              // in the key for the same reason — a chat whose first half was
              // answered by a different engine is not a run of anything.
              key={`${startAt ?? "top"}-${chatRun}-${choice}`}
              config={config}
              user={user}
              initialMessage={config.root.response}
              startAt={startAt}
              startAtName={startNode?.name ?? null}
              startAtMessage={startNode?.response ?? ""}
              // A leaf has no children to ask about, so it answers on the way
              // in rather than waiting for a message.
              startAtLeaf={startNode !== null && startNode.children.length === 0}
              debug={debug}
              llm={llm}
              choice={choice}
              onChoice={setChoice}
              // A new chat is a clean slate: back to the greeting at the root,
              // nothing selected in the tree, no trace on the canvas. The key
              // below changes with it, so the history goes too.
              onNewChat={() => {
                setStartAt(null);
                setSelectedId(null);
                setTrace(null);
                setChatRun((run) => run + 1);
              }}
              apiKey={apiKey}
              onTrace={setTrace}
              // A mutating automation changed the customer. The turn hands the
              // new record back, so nothing here has to guess what moved.
              onRecord={(next) => {
                const paths = changesBetween(user, next)
                  .map((change) => change.path)
                  // `foo.length` is the flattener's, not the record's. It has
                  // no row in the modal, so counting it would promise a mark
                  // that cannot appear. The trace still shows it.
                  .filter((path) => !path.endsWith(".length"));
                setUnseen((current) => [...new Set([...current, ...paths])]);
                setUser(next);
              }}
            />
          </Slider>
        </aside>
      </div>

      {settingsOpen && (
        <SettingsModal
          config={config}
          defaults={defaultConfig}
          apiKey={apiKey}
          onApiKey={storeKey}
          llm={llm}
          onLlm={setLlm}
          onApply={(settings) => setConfig({ ...config, ...settings })}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {userOpen && (
        <UserModal
          user={user}
          defaults={defaultUser}
          moved={unseen}
          onApply={(next) => {
            // Taking the record over by hand consumes the bot's news with it,
            // so a mark can never outlive the change it was pointing at.
            setUnseen([]);
            setUser(next);
          }}
          onClose={() => {
            // Shutting it is the act of having looked. The marks and the
            // badge go with it.
            setUnseen([]);
            setUserOpen(false);
          }}
        />
      )}

      {confirmReset && (
        <ConfirmModal
          title="Reset nodes?"
          body="Your edits to the nodes will be lost. Settings and the test user are kept."
          confirmLabel="Reset nodes"
          onConfirm={reset}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}

/**
 * A side panel that slides open and shut.
 *
 * The panel body is held at its full width inside a box whose width animates,
 * so the contents slide out of view rather than reflowing on the way. It stays
 * mounted either way, so a collapsed chat keeps its history.
 *
 * A change of `width` animates at the same speed, which is what the node panel
 * widening on a selection rides on.
 */
function Slider({
  width,
  open,
  children,
}: {
  width: number;
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden transition-[width] duration-[var(--slide)] ease-in-out motion-reduce:transition-none"
      style={{ width: open ? width : 0 }}
      aria-hidden={!open}
    >
      <div className="h-full" style={{ width }}>
        {children}
      </div>
    </div>
  );
}

/** The thin strip that shows or hides a side panel. It always points inward. */
function PanelToggle({
  side,
  open,
  onClick,
}: {
  side: "left" | "right";
  open: boolean;
  onClick: () => void;
}) {
  const collapse = side === "left" ? "‹" : "›";
  const expand = side === "left" ? "›" : "‹";
  return (
    <button
      type="button"
      onClick={onClick}
      title={open ? "Hide panel" : "Show panel"}
      aria-label={`${open ? "Hide" : "Show"} ${side === "left" ? "node" : "chat"} panel`}
      className={`h-full w-5 shrink-0 cursor-pointer text-[11px] text-muted hover:bg-panel2 hover:text-foreground ${
        side === "left" ? "border-l" : "border-r"
      } border-line`}
    >
      {open ? collapse : expand}
    </button>
  );
}
