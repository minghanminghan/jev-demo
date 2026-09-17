import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import BendEdge from "@/components/BendEdge";
import BotNodeCard from "@/components/BotNodeCard";
import { buildGraph, NODE_HEIGHT, NODE_WIDTH, type NodeData } from "@/lib/graph";
import type { BotConfig, Trace } from "@/lib/types";

const nodeTypes = { botNode: BotNodeCard };
const edgeTypes = { bend: BendEdge };

/**
 * Gap in screen pixels between the tree and each side of the canvas when it
 * first opens. The canvas sits between two panels, so this is the space left
 * against the node panel on one side and the chat on the other.
 */
const OPENING_PAD = 40;

/**
 * The zoom the tree opens at when there is room for it at that size. The tree
 * is never opened larger than this — a canvas wider than it needs gets the
 * spare room as margin rather than a blown-up diagram.
 */
const OPENING_ZOOM = 0.85;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;

export default function FlowCanvas({
  config,
  trace,
  startAt,
  selectedId,
  onSelect,
}: {
  config: BotConfig;
  trace: Trace | null;
  /** Node the chat was opened at, highlighted before the first message. */
  startAt: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { nodes, edges } = useMemo(
    () => buildGraph(config, trace, startAt),
    [config, trace, startAt],
  );

  const [canvas, setCanvas] = useState<ReactFlowInstance<Node<NodeData>> | null>(null);

  /**
   * How wide the tree is in canvas units. The root sits at x 0, so the right
   * edge of the widest column is the whole width.
   */
  const treeWidth = useMemo(
    () => nodes.reduce((widest, node) => Math.max(widest, node.position.x + NODE_WIDTH), 0),
    [nodes],
  );

  // Measured to work out the opening zoom. React Flow fills this box.
  const box = useRef<HTMLDivElement>(null);

  /**
   * Place the opening view: the tree anchored top left, and pulled in only as
   * far as it has to be for its widest column to clear the far side.
   *
   * A fixed zoom cannot do this. The canvas is whatever is left between the
   * two panels, so at 0.85 the right-hand column of a four-deep tree sat under
   * the chat on a laptop — the whole tree has to be measured against the room
   * actually on offer.
   *
   * This runs once, when the canvas starts up. Toggling a panel afterwards
   * does not refit: the view stays where it was put rather than jumping while
   * someone is reading it.
   */
  const openAt = useCallback(
    (instance: ReactFlowInstance<Node<NodeData>>) => {
      const room = (box.current?.clientWidth ?? 0) - OPENING_PAD * 2;
      // No width to measure yet, or no tree: leave React Flow on its default.
      if (room <= 0 || treeWidth <= 0) return;
      const zoom = Math.min(OPENING_ZOOM, Math.max(MIN_ZOOM, room / treeWidth));
      instance.setViewport({ x: OPENING_PAD, y: OPENING_PAD, zoom }, { duration: 0 });
    },
    [treeWidth],
  );

  // Slide to whichever node the conversation is on, so the highlight is never
  // parked off screen behind a panel. The zoom is left alone.
  const currentNode = nodes.find((node) => node.data.current) ?? null;
  const currentId = currentNode?.id ?? null;
  useEffect(() => {
    if (!canvas || !currentNode) return;
    canvas.setCenter(
      currentNode.position.x + NODE_WIDTH / 2,
      currentNode.position.y + NODE_HEIGHT / 2,
      { zoom: canvas.getZoom(), duration: 450 },
    );
    // Only a move counts. Rebuilding the same graph should not yank the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, currentId]);

  // Selection is applied at render time, so clicking a node never rebuilds it.
  //
  // Annotated, not inferred: spreading `selected` in turns it from optional
  // into required, and React Flow then reads its node type off this array and
  // hands `onInit` an instance that no longer matches `Node<NodeData>`.
  const shown: Node<NodeData>[] = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedId })),
    [nodes, selectedId],
  );

  return (
    <div ref={box} className="h-full w-full">
      <ReactFlow
        nodes={shown}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => {
          setCanvas(instance);
          openAt(instance);
        }}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        // The cascade layout owns every position. Nodes cannot be dragged.
        nodesDraggable={false}
        nodesConnectable={false}
        // Trackpad rules: two fingers scroll the canvas, pinch zooms. Nothing
        // else changes the zoom, so the diagram never jumps while you scroll.
        panOnScroll
        panOnScrollSpeed={1}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        preventScrolling
        // The root sits at 0,0, so this opens on the top left of the tree with a
        // little margin, rather than centring on the middle of a tall diagram.
        // `openAt` above replaces the zoom as soon as the canvas can be
        // measured; this is what the first frame is drawn at.
        defaultViewport={{ x: OPENING_PAD, y: OPENING_PAD, zoom: OPENING_ZOOM }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--dots)" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          // Bottom left, and clickable: dragging the viewport box moves the canvas.
          position="bottom-left"
          pannable
          zoomable
          ariaLabel="Node map"
          maskColor="transparent"
          style={{ width: 190, height: 130 }}
          nodeStrokeWidth={0}
          nodeBorderRadius={4}
          nodeColor={(node) => ((node.data as NodeData).hit ? "var(--accent)" : "var(--edge)")}
        />
      </ReactFlow>
    </div>
  );
}
