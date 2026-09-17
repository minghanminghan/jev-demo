import type { Edge, Node } from "@xyflow/react";

import { find, flatten } from "./tree";
import type { BotConfig, BotNode, Trace } from "./types";

/** Data carried on each canvas node. */
export type NodeData = {
  title: string;
  /** 0 for the root, 1 for the top level of the tree, and so on. */
  depth: number;
  /** Set when the last test message went through this node. */
  hit: boolean;
  /** The node the conversation is sitting on right now. */
  current: boolean;
  /** A child of the current node: somewhere the next message could go. */
  next: boolean;
  /** Probability from the last test message, when there is one. */
  probability: number | null;
  escalate: boolean;
  leaf: boolean;
};

export const NODE_WIDTH = 216;
export const NODE_HEIGHT = 40;

/** Gap between one column of nodes and the next. */
const COLUMN_GAP = 132;
/** Gap between two nodes stacked in the same column. */
const ROW_GAP = 12;

/**
 * A cascade layout, laid out by hand rather than by a solver.
 *
 * Every node sits in the column for its depth. A leaf takes the next free row;
 * a parent sits on the same row as its first child. So the root lands top left
 * and each branch steps down and to the right, which reads like an outline.
 */
function place(config: BotConfig) {
  const at = new Map<string, { x: number; y: number }>();
  let row = 0;

  const walk = (node: BotNode, depth: number): number => {
    const x = depth * (NODE_WIDTH + COLUMN_GAP);
    if (node.children.length === 0) {
      const y = row * (NODE_HEIGHT + ROW_GAP);
      row += 1;
      at.set(node.id, { x, y });
      return y;
    }
    const first = node.children.map((child) => walk(child, depth + 1))[0];
    at.set(node.id, { x, y: first });
    return first;
  };

  walk(config.root, 0);
  return at;
}

/** Build the canvas from the config. */
export function buildGraph(
  config: BotConfig,
  trace: Trace | null,
  startAt: string | null = null,
) {
  const tree = [config.root];
  const rootId = config.root.id;
  const hitIds = new Set(trace?.path ?? []);

  // Where the conversation stands: the last node on the path, and the children
  // it could move to next. Before the first message that is the node the chat
  // was opened at, if any.
  const currentId = trace?.path.at(-1) ?? (trace ? rootId : startAt);
  const currentNode = currentId ? find(tree, currentId) : null;
  const nextIds = new Set((currentNode?.node.children ?? []).map((n) => n.id));

  // A probability per node id, taken from the level it was offered at.
  const probabilityOf = new Map<string, number>();
  if (trace) {
    // The walk starts where the chat did, which is not always the top: the
    // first step holds the start node's children, and names are unique only
    // within a level, so reading it against the root level puts the numbers on
    // the wrong nodes or on none at all.
    const from = trace.startedAt ? find(tree, trace.startedAt) : null;
    let level = from?.node.children ?? config.root.children;
    for (const step of trace.steps) {
      for (const node of level) {
        const value = step.probabilities[node.name];
        if (value !== undefined) probabilityOf.set(node.id, value);
      }
      const picked = level.find((n) => n.name === step.choice);
      if (!picked) break;
      level = picked.children;
    }
  }

  const at = place(config);
  const nodes: Node<NodeData>[] = [];

  for (const { node, depth } of flatten(tree)) {
    nodes.push({
      id: node.id,
      type: "botNode",
      position: at.get(node.id) ?? { x: 0, y: 0 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: {
        title: node.name,
        depth,
        // Every path runs through the root, so a test lights it up as well.
        hit: hitIds.has(node.id) || (depth === 0 && trace !== null),
        current: node.id === currentId,
        next: nextIds.has(node.id),
        probability: probabilityOf.get(node.id) ?? null,
        escalate: node.escalate,
        leaf: node.children.length === 0,
      },
    });
  }

  const edges: Edge[] = [];
  const link = (source: string, target: string) => {
    const onPath =
      hitIds.has(target) && (source === rootId || hitIds.has(source));
    // An edge leaving the current node is a road not yet taken: same pink,
    // but thin and faint, so it reads as a hint and not as history.
    const ahead = !onPath && source === currentId && nextIds.has(target);
    edges.push({
      id: `${source}-${target}`,
      source,
      target,
      type: "bend",
      animated: onPath,
      data: { onPath, ahead },
      style: {
        stroke: onPath || ahead ? "var(--accent)" : "var(--edge)",
        strokeWidth: onPath ? 2 : 1,
        strokeOpacity: ahead ? 0.45 : 1,
      },
    });
  };
  for (const { node } of flatten(tree)) {
    for (const child of node.children) link(node.id, child.id);
  }

  return { nodes, edges };
}
