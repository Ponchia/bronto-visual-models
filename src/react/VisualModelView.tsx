import { lazy } from "react";
import { resolveVisualProjection, visualAdapterId } from "../projections.ts";
import { ModelViewFrame } from "./ModelViewFrame.tsx";
import type { VisualModelViewProps } from "./types.ts";

const C4 = lazy(() => import("./C4View.tsx"));
const Chart = lazy(() => import("./ChartView.tsx"));
const Graph = lazy(() => import("./GraphView.tsx"));
const Matrix = lazy(() => import("./MatrixView.tsx"));
const Gantt = lazy(() => import("./GanttView.tsx"));
const Timeline = lazy(() => import("./TimelineView.tsx"));

/** The full optional renderer catalog; the native Gantt entry need not import it. */
export function VisualModelView(props: VisualModelViewProps) {
  const projection = resolveVisualProjection(props.model, props.projection, props.registry);
  const builtin =
    props.model.renderer === "c4" && projection === "c4"
      ? C4
      : props.model.renderer === "diagram"
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
            : props.model.renderer === "vega-lite" && projection === "vega-lite"
              ? Chart
              : null;
  const id = visualAdapterId(props.model, projection, props.registry);
  // Only adapters declared by the model family may be displayed. Host code is
  // trusted, but saved model content never names a dynamically loaded module.
  const adapter = (id && props.viewAdapters?.get(id)) || builtin;
  return <ModelViewFrame {...props} adapter={adapter} />;
}
