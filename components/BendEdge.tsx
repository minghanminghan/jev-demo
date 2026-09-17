import { BaseEdge, type EdgeProps } from "@xyflow/react";

/** How far past the parent the vertical trunk sits, before it drops to a child. */
const TRUNK_OFFSET = 44;
/** Corner radius on the two bends. */
const RADIUS = 10;

/**
 * A line with two rounded right angles: it leaves the parent, runs a little
 * way out, drops or rises to the child's row, then runs straight into it. When
 * parent and child already share a row it is one straight line, no bend.
 */
export default function BendEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
}: EdgeProps) {
  const drop = targetY - sourceY;

  let path: string;
  if (Math.abs(drop) < 0.5) {
    path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
  } else {
    const trunk = sourceX + TRUNK_OFFSET;
    const down = Math.sign(drop);
    // Keep the two corners from overlapping on a short drop or a tight column.
    const r = Math.min(RADIUS, Math.abs(drop) / 2, TRUNK_OFFSET, Math.abs(targetX - trunk));
    path = [
      `M ${sourceX},${sourceY}`,
      `L ${trunk - r},${sourceY}`,
      `Q ${trunk},${sourceY} ${trunk},${sourceY + r * down}`,
      `L ${trunk},${targetY - r * down}`,
      `Q ${trunk},${targetY} ${trunk + r},${targetY}`,
      `L ${targetX},${targetY}`,
    ].join(" ");
  }

  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}
