import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import { NODE_HEIGHT, NODE_WIDTH, type NodeData } from "@/lib/graph";

/**
 * One box on the canvas. It doubles as the test read-out.
 *
 * Pink is the only colour in play, and it says one thing: this is where the
 * message went. Solid pink with a ring is where the conversation stands now,
 * solid pink is the path behind it, faint pink is where the next message could
 * go, and a pink hand-off badge marks a node that leaves the bot.
 */
export default function BotNodeCard({ data, selected }: NodeProps<Node<NodeData>>) {
  const { depth, hit, current, next, probability, escalate, leaf } = data;
  const isRoot = depth === 0;

  const border = hit
    ? "var(--accent)"
    : next
      ? "color-mix(in srgb, var(--accent) 45%, var(--line))"
      : escalate
        ? "color-mix(in srgb, var(--accent) 55%, var(--line))"
        : selected
          ? "var(--line-strong)"
          : "var(--line)";

  const background = hit
    ? "var(--accent-soft)"
    : next
      ? "color-mix(in srgb, var(--accent-soft) 45%, var(--panel))"
      : "var(--panel)";

  const ring = current
    ? [
        "0 0 0 3px var(--background)",
        "0 0 0 6px color-mix(in srgb, var(--accent) 55%, transparent)",
        "0 8px 22px -6px color-mix(in srgb, var(--accent) 45%, transparent)",
      ].join(", ")
    : selected
      ? "0 0 0 3px color-mix(in srgb, var(--line-strong) 28%, transparent)"
      : undefined;

  return (
    <div
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        borderColor: border,
        borderWidth: current ? 2 : 1,
        zIndex: current ? 1 : undefined,
        background,
        boxShadow: ring,
      }}
      className="flex cursor-pointer items-center rounded-xl border px-3 py-2"
    >
      {!isRoot && <Handle type="target" position={Position.Left} />}
      {!leaf && <Handle type="source" position={Position.Right} />}

      <div className="flex w-full items-center justify-between gap-2">
        <span
          className={`truncate text-[15px] ${isRoot ? "font-semibold" : "font-mono font-semibold"}`}
          style={current ? { color: "var(--accent)" } : undefined}
        >
          {data.title}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {current && (
            <span
              className="rounded px-1 py-px text-[9px] font-semibold"
              style={{ background: "var(--accent)", color: "var(--on-accent)" }}
            >
              here
            </span>
          )}
          {escalate && (
            <span
              className="rounded px-1 py-px text-[9px] font-semibold"
              style={{ background: "var(--accent)", color: "var(--on-accent)" }}
            >
              hand-off
            </span>
          )}
          {probability !== null && (
            <span
              className="rounded px-1 py-px font-mono text-[10px]"
              style={{
                background: hit ? "var(--accent)" : "var(--panel-2)",
                color: hit ? "var(--on-accent)" : "var(--muted)",
              }}
            >
              {probability.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
