import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import {
  diagramRoutePath,
  type DiagramEdgeRoute,
  type DiagramBox,
} from "../render/diagram-routing.ts";

export type RoutedEdgeData = {
  route?: DiagramEdgeRoute;
  labelBox?: DiagramBox;
  managedLabels: boolean;
  text: string;
  font: string;
  select(): void;
};
export type RoutedFlowEdge = Edge<RoutedEdgeData>;

export default function RoutedEdge(props: EdgeProps<RoutedFlowEdge>) {
  const { data, id, sourceX, sourceY, targetX, targetY, markerEnd, style } = props;
  const points = data?.route?.points;
  const first = points?.[0],
    last = points?.at(-1);
  // React Flow anchors on the outer edge of a small handle, whereas ELK uses
  // the node boundary. Permit only that bounded along-segment offset, never
  // a moved/reshaped node or a perpendicular mismatch.
  const attached = (
    end: { x: number; y: number } | undefined,
    next: { x: number; y: number } | undefined,
    x: number,
    y: number,
  ) => {
    if (!end || !next || Math.hypot(end.x - x, end.y - y) > 8) return false;
    return Math.abs(end.x - next.x) < 0.01 ? Math.abs(end.x - x) < 1 : Math.abs(end.y - y) < 1;
  };
  const current =
    attached(first, points?.[1], sourceX, sourceY) &&
    attached(last, points?.at(-2), targetX, targetY);
  const [fallback, labelX, labelY] = getSmoothStepPath(props);
  const path = current
    ? diagramRoutePath([
        { x: sourceX, y: sourceY },
        ...points!.slice(1, -1),
        { x: targetX, y: targetY },
      ])
    : fallback;
  const box = current ? data?.labelBox : undefined;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        data-bvm-route={current ? "elk" : "fallback"}
        label={data?.managedLabels ? undefined : props.label}
        labelX={labelX}
        labelY={labelY}
        labelStyle={props.labelStyle}
        labelBgStyle={props.labelBgStyle}
      />
      {box && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="bvm-route-label nodrag nopan"
            title={data!.text}
            aria-label={`Relationship: ${data!.text}`}
            data-edge-label={id}
            style={{
              transform: `translate(${box.x}px, ${box.y}px)`,
              width: box.width,
              height: box.height,
              font: data?.font,
            }}
            onClick={(event) => {
              event.stopPropagation();
              data?.select();
            }}
          >
            {data!.text}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
