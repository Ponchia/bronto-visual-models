import { getViewportForBounds, type Rect, type Viewport } from "@xyflow/react";

/** A camera choice only: source positions and renderer topology never change. */
export function diagramCamera(
  bounds: Rect,
  width: number,
  height: number,
  mode: "overview" | "readable",
): Viewport {
  const fitted = getViewportForBounds(
    bounds,
    Math.max(width, 1),
    Math.max(height, 1),
    0.05,
    1,
    0.15,
  );
  if (mode === "overview") return fitted;
  // Reading starts at a 1:1 local scale. A wide model stays navigable instead
  // of reducing every label to fit. Fit diagram remains an explicit alternative.
  return {
    zoom: 1,
    x: bounds.width + 48 <= width ? (width - bounds.width) / 2 - bounds.x : 24 - bounds.x,
    y: 24 - bounds.y,
  };
}
