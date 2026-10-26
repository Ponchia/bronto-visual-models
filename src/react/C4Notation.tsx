import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { C4_KIND_LABELS, type C4Element } from "../c4.ts";

export type C4FlowNode = Node<{ element: C4Element; boundary?: boolean }>;
export type C4FlowEdge = Edge<{
  label: string;
  technology?: string;
  lane: number;
  active: boolean;
  select(): void;
}>;
const sides = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};
function Symbol({ element }: { element: C4Element }) {
  const path =
    element.kind === "person" ? (
      <>
        <circle cx="12" cy="6" r="4" />
        <path d="M4 23v-5a8 8 0 0 1 16 0v5" />
      </>
    ) : element.shape === "database" ? (
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0" />
      </>
    ) : element.shape === "queue" ? (
      <>
        <rect x="2" y="4" width="20" height="16" rx="3" />
        <path d="M8 8v8M12 8v8M16 8v8" />
      </>
    ) : element.kind === "component" ? (
      <>
        <rect x="6" y="3" width="16" height="18" rx="2" />
        <path d="M2 7h8v4H2zM2 14h8v4H2z" />
      </>
    ) : (
      <>
        <rect x="2" y="3" width="20" height="15" rx="2" />
        <path d="M8 22h8M12 18v4" />
      </>
    );
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 26"
      width="26"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      {path}
    </svg>
  );
}
export const C4Node = memo(function C4Node({ data }: NodeProps<C4FlowNode>) {
  const e = data.element;
  if (data.boundary)
    return (
      <div className="bvm-c4-boundary">
        <strong>{e.label}</strong>
        <span>{C4_KIND_LABELS[e.kind]} boundary</span>
      </div>
    );
  return (
    <div className={`bvm-c4-card${e.external ? " bvm-c4-external" : ""}`}>
      <div className="bvm-c4-card-kind">
        <Symbol element={e} />
        <span>
          {C4_KIND_LABELS[e.kind]}
          {e.external ? " · External" : ""}
        </span>
      </div>
      <strong className="bvm-c4-card-name" title={e.label}>
        {e.label}
      </strong>
      {e.technology && (
        <span className="bvm-c4-technology" title={e.technology}>
          {e.technology}
        </span>
      )}
      <p title={e.description}>{e.description}</p>
      {Object.entries(sides).flatMap(([id, position]) =>
        (["source", "target"] as const).map((type) => (
          <Handle
            key={`${id}-${type}`}
            id={id}
            type={type}
            position={position}
            isConnectable={false}
          />
        )),
      )}
    </div>
  );
});
export function C4Edge(props: EdgeProps<C4FlowEdge>) {
  const { data, sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props;
  if (!data) return null;
  let [path, x, y] = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 14,
    offset: 32,
  });
  if (data.lane) {
    const length = Math.max(1, Math.hypot(tx - sx, ty - sy));
    const cx = (sx + tx) / 2 - ((ty - sy) / length) * data.lane;
    const cy = (sy + ty) / 2 + ((tx - sx) / length) * data.lane;
    path = `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`;
    x = (sx + 2 * cx + tx) / 4;
    y = (sy + 2 * cy + ty) / 4;
  }
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className="bvm-c4-edge-label nodrag nopan"
          disabled={!data.active}
          aria-pressed={!!props.selected}
          aria-label={`Relationship: ${data.label}${data.technology ? ` (${data.technology})` : ""}`}
          title={[data.label, data.technology].filter(Boolean).join(" · ")}
          style={{ transform: `translate(-50%, -50%) translate(${x}px,${y}px)` }}
          onClick={data.select}
        >
          <span>{data.label}</span>
          {data.technology && <small>{data.technology}</small>}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
