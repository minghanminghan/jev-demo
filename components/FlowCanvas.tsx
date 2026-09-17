import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";

import BendEdge from "@/components/BendEdge";
import BotNodeCard from "@/components/BotNodeCard";
import { buildGraph, NODE_HEIGHT, NODE_WIDTH, type NodeData } from "@/lib/graph";
import type { BotConfig, Trace } from "@/lib/types";

const nodeTypes = { botNode: BotNodeCard };
const edgeTypes = { bend: BendEdge };

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
  const shown = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedId })),
    [nodes, selectedId],
  );

  return (
    <ReactFlow
      nodes={shown}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onInit={setCanvas}
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
      defaultViewport={{ x: 40, y: 40, zoom: 0.85 }}
      minZoom={0.2}
      maxZoom={2}
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
  );
}
