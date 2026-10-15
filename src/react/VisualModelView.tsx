import { lazy } from "react";
import { resolveVisualProjection } from "../projections.ts";
import { ModelViewFrame } from "./ModelViewFrame.tsx";
import type { VisualModelViewProps } from "./types.ts";

const Graph = lazy(() => import("./GraphView.tsx"));
const Matrix = lazy(() => import("./MatrixView.tsx"));
const Gantt = lazy(() => import("./GanttView.tsx"));
const Timeline = lazy(() => import("./TimelineView.tsx"));

/** The full optional renderer catalog; the native Gantt entry need not import it. */
export function VisualModelView(props: VisualModelViewProps) {
  const projection = resolveVisualProjection(props.model, props.projection, props.registry);
  const adapter =
    props.model.renderer === "diagram"
      ? projection === "matrix"
        ? Matrix
        : projection === "diagram" || projection === "network"
          ? Graph
          : null
      : props.model.renderer === "timeline" &&
          !props.model.content.datasource &&
          projection === "timeline"
        ? Timeline
        : props.model.renderer === "gantt" && projection === "gantt"
          ? Gantt
          : null;
  return <ModelViewFrame {...props} adapter={adapter} />;
}
