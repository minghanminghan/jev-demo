import type { BotConfig, BotNode } from "./types";

/** Every node in the tree, depth first. */
export function flatten(nodes: BotNode[], depth = 0): { node: BotNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

/** The node with this id, plus its parent and the ancestors above it. */
export function find(
  nodes: BotNode[],
  id: string,
  parent: BotNode | null = null,
  trail: BotNode[] = [],
): { node: BotNode; parent: BotNode | null; trail: BotNode[] } | null {
  for (const node of nodes) {
    if (node.id === id) return { node, parent, trail };
    const hit = find(node.children, id, node, [...trail, node]);
    if (hit) return hit;
  }
  return null;
}

/** Replace one node in place, returning a fresh tree. */
export function update(nodes: BotNode[], id: string, patch: Partial<BotNode>): BotNode[] {
  return nodes.map((node) =>
    node.id === id ? { ...node, ...patch } : { ...node, children: update(node.children, id, patch) },
  );
}

/** Drop one node and everything under it. */
export function remove(nodes: BotNode[], id: string): BotNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => ({ ...node, children: remove(node.children, id) }));
}

/** Add a child under `parentId`, or at the top when that is null. */
export function insert(nodes: BotNode[], parentId: string | null, child: BotNode): BotNode[] {
  if (parentId === null) return [...nodes, child];
  return nodes.map((node) =>
    node.id === parentId
      ? { ...node, children: [...node.children, child] }
      : { ...node, children: insert(node.children, parentId, child) },
  );
}

/** Ids only have to be unique inside the file, so this is plenty. */
export function newId(): string {
  return `n_${Math.random().toString(36).slice(2, 9)}`;
}

/** A fresh node starts empty. Only the name is filled in, so it is addressable. */
export function blankNode(index: number): BotNode {
  return {
    id: newId(),
    name: `node_${index + 1}`,
    label: "",
    response: "",
    escalate: false,
    children: [],
  };
}

/** Node names, top of the tree down to this node. */
export function pathNames(config: BotConfig, id: string): string[] {
  const hit = find([config.root], id);
  return hit ? [...hit.trail.map((n) => n.name), hit.node.name] : [];
}
