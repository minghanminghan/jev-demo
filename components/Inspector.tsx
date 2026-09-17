import { useState } from "react";

import AutoTextarea from "@/components/AutoTextarea";
import ConfirmModal from "@/components/ConfirmModal";
import { ResponseField } from "@/components/ResponseField";
import { blankNode, find, flatten, insert, remove, update } from "@/lib/tree";
import type { BotConfig, BotNode, UserRecord } from "@/lib/types";

/**
 * The form for whichever node is selected.
 *
 * A node is a node at every level, so this one form covers the whole tree. The
 * initial message is the root: the top-level nodes are its children, and new
 * top-level nodes are added from there.
 *
 * What a node does is editable here: the text it sends, with `{{keys}}` out of
 * the customer JSON. The live test customer comes in so the text can be shown
 * filled in, rather than as names you have to send a message to resolve.
 *
 * Which automation a node runs first is fixed in the config. Writing your own
 * is out of scope for this proof of concept, so there is no editor for it.
 */
export default function Inspector({
  config,
  user,
  selectedId,
  onChange,
  onSelect,
  onStartChatHere,
}: {
  config: BotConfig;
  /** The test customer the chat is using, for slot values and guard verdicts. */
  user: UserRecord | null;
  selectedId: string | null;
  onChange: (next: BotConfig) => void;
  onSelect: (id: string | null) => void;
  /** Opens a fresh chat that begins at this node, ignoring its parents. */
  onStartChatHere: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<BotNode | null>(null);

  const root = config.root;
  const recipes = config.automations ?? [];
  const tree = [root];
  const hit = selectedId ? find(tree, selectedId) : null;

  const patch = (id: string, changes: Partial<BotNode>) =>
    onChange({ ...config, root: update(tree, id, changes)[0] });

  const addChild = (parentId: string) => {
    const siblings = find(tree, parentId)?.node.children ?? [];
    const child = blankNode(siblings.length);
    onChange({ ...config, root: insert(tree, parentId, child)[0] });
    onSelect(child.id);
  };

  const drop = (node: BotNode) => {
    onChange({
      ...config,
      root: { ...root, children: remove(root.children, node.id) },
    });
    setConfirmDelete(null);
    onSelect(null);
  };

  if (!hit) {
    return (
      <Shell title="Nodes">
        <Outline config={config} selectedId={selectedId} onSelect={onSelect} />
      </Shell>
    );
  }

  const { node, trail } = hit;
  const leaf = node.children.length === 0;

  // The root is the opening line. It has no label and no parent, so it gets a
  // shorter form: the greeting, its children, and nothing to delete.
  if (node.id === root.id) {
    return (
      <Shell
        title={node.name || "untitled node"}
        crumbs={[]}
        onSelect={onSelect}
      >
        <Field label="Name">
          <input
            className="field font-mono"
            value={node.name}
            onChange={(event) => patch(node.id, { name: event.target.value })}
          />
        </Field>
        <ResponseField
          label="Message"
          hint="The bot's opening line, before the customer says anything."
          value={node.response}
          onChange={(response) => patch(node.id, { response })}
          node={node}
          user={user}
          recipes={recipes}
        />
        <Children
          nodes={node.children}
          onAdd={() => addChild(node.id)}
          onSelect={onSelect}
          warnSingle={false}
        />
        <div className="border-t border-line pt-4">
          <button
            type="button"
            className="btn w-full"
            title="Clear the chat and begin at the greeting"
            onClick={() => onStartChatHere(node.id)}
          >
            Start chat here
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      title={node.name || "untitled node"}
      crumbs={trail.slice(1)}
      root={root}
      onSelect={onSelect}
    >
      <Field label="Name">
        <input
          className="field font-mono"
          value={node.name}
          onChange={(event) => patch(node.id, { name: event.target.value })}
        />
      </Field>

      <Field label="Label for jev">
        <AutoTextarea
          value={node.label}
          onChange={(label) => patch(node.id, { label })}
        />
      </Field>

      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          className="cursor-pointer accent-[var(--neutral-fill)]"
          checked={node.escalate}
          onChange={(e) => patch(node.id, { escalate: e.target.checked })}
        />
        Escalate to human agent
      </label>

      {!node.escalate && (
        <ResponseField
          label="Response"
          hint={
            leaf
              ? "Sent word for word when the bot routes here."
              : "Shown as the opening line when a chat starts here."
          }
          value={node.response}
          onChange={(response) => patch(node.id, { response })}
          node={node}
          user={user}
          recipes={recipes}
        />
      )}

      {!node.escalate && (
        <Children
          nodes={node.children}
          onAdd={() => addChild(node.id)}
          onSelect={onSelect}
          warnSingle
        />
      )}

      <div className="space-y-2 border-t border-line pt-4">
        <button
          type="button"
          className="btn w-full"
          title={
            leaf
              ? "Clear the chat and answer from this node, running whatever it does"
              : "Clear the chat and begin here"
          }
          onClick={() => onStartChatHere(node.id)}
        >
          Start chat here
        </button>
        <button
          type="button"
          className="btn btn-danger-outline w-full"
          onClick={() => setConfirmDelete(node)}
        >
          Delete node
        </button>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title={`Delete "${confirmDelete.name}"?`}
          body={
            confirmDelete.children.length > 0
              ? `This also deletes ${flatten(confirmDelete.children).length} node(s) below it.`
              : ""
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => drop(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </Shell>
  );
}

/** The child list plus its add button. Used by the root and by every node. */
function Children({
  nodes,
  onAdd,
  onSelect,
  warnSingle,
}: {
  nodes: BotNode[];
  onAdd: () => void;
  onSelect: (id: string) => void;
  warnSingle: boolean;
}) {
  return (
    <div className="space-y-2 border-t border-line pt-4">
      <div className="flex items-center justify-between">
        <span className="label mb-0">Children</span>
        <button type="button" className="btn" onClick={onAdd}>
          + Add
        </button>
      </div>
      {warnSingle && nodes.length === 1 && (
        <p className="text-[12px] text-[var(--warn)]">
          One child is not a choice. Use none, or two or more.
        </p>
      )}
      <ul className="space-y-0.5">
        {nodes.map((child) => (
          <li key={child.id}>
            <button
              type="button"
              className="w-full cursor-pointer truncate rounded-md px-2 py-1.5 text-left font-mono text-[12px] hover:bg-panel2"
              onClick={() => onSelect(child.id)}
            >
              {child.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Shell({
  title,
  crumbs,
  root,
  onSelect,
  children,
}: {
  title: string;
  crumbs?: BotNode[];
  /** The root node, for its crumb. Null when the root itself is on screen. */
  root?: BotNode | null;
  onSelect?: (id: string | null) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line px-4 py-3">
        {crumbs && onSelect && (
          <nav className="mb-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
            <button
              type="button"
              className="cursor-pointer hover:text-foreground hover:underline"
              onClick={() => onSelect(null)}
            >
              All nodes
            </button>
            {root && (
              <span className="flex items-center gap-1">
                <span aria-hidden>›</span>
                <button
                  type="button"
                  className="cursor-pointer font-mono hover:text-foreground hover:underline"
                  onClick={() => onSelect(root.id)}
                >
                  {root.name}
                </button>
              </span>
            )}
            {crumbs.map((crumb) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <span aria-hidden>›</span>
                <button
                  type="button"
                  className="cursor-pointer font-mono hover:text-foreground hover:underline"
                  onClick={() => onSelect(crumb.id)}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
        )}
        <h2 className="truncate font-mono text-[13px] font-semibold">
          {title}
        </h2>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {children}
      </div>
    </div>
  );
}

/**
 * The whole tree as an indented list. The root row is the opening line, so the
 * panel matches the canvas: everything hangs off it.
 */
function Outline({
  config,
  selectedId,
  onSelect,
}: {
  config: BotConfig;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const rows = flatten([config.root]).map(({ node, depth }) => ({
    id: node.id,
    name: node.name,
    depth,
    escalate: node.escalate,
  }));

  return (
    <ul className="space-y-0.5">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            style={{ paddingLeft: 8 + row.depth * 14 }}
            className={`flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 text-left font-mono text-[12px] hover:bg-panel2 ${
              row.id === selectedId ? "bg-panel2" : ""
            }`}
            onClick={() => onSelect(row.id)}
          >
            <span className="truncate">{row.name}</span>
            {row.escalate && (
              <span
                className="shrink-0 rounded px-1 py-px text-[9px] font-semibold"
                style={{
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                }}
              >
                hand-off
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
