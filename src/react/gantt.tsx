import { resolveVisualProjection } from "../projections.ts";
import Gantt from "./GanttView.tsx";
import { ModelViewFrame } from "./ModelViewFrame.tsx";
import type { VisualModelViewProps } from "./types.ts";
export type GanttModelViewProps = VisualModelViewProps;

/** A native schedule consumer never resolves React Flow, Vega or vis-timeline. */
export function GanttModelView(props: GanttModelViewProps) {
  const projection = resolveVisualProjection(props.model, props.projection, props.registry);
  return (
    <ModelViewFrame
      {...props}
      adapter={props.model.renderer === "gantt" && projection === "gantt" ? Gantt : null}
    />
  );
}
