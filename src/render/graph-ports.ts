import type { GraphContent, GraphEdge, GraphNode } from "../semantic.ts";

export type GraphPortSide = "top" | "right" | "bottom" | "left";
export interface GraphPortPlacement {
  id: string;
  label?: string;
  side: GraphPortSide;
  /** Fraction along its side. Several ports never share the same attachment point. */
  offset: number;
}
const SIDES: readonly GraphPortSide[] = ["top", "right", "bottom", "left"];

/** Render-only implicit ports. Nothing is inserted into authored content. */
export function graphPorts(node: Pick<GraphNode, "ports">): GraphPortPlacement[] {
  const ports = node.ports?.length ? node.ports : SIDES.map((side) => ({ id: side, side }));
  const seen = new Map<GraphPortSide, number>();
  const totals = new Map<GraphPortSide, number>();
  for (const port of ports) totals.set(port.side, (totals.get(port.side) ?? 0) + 1);
  return ports.map((port) => {
    const ordinal = (seen.get(port.side) ?? 0) + 1;
    seen.set(port.side, ordinal);
    return { ...port, offset: ordinal / ((totals.get(port.side) ?? 0) + 1) };
  });
}

/** Shared by the renderer and layout adapter; explicit port IDs always win. */
export function graphEdgeHandles(
  graph: GraphContent,
  edge: GraphEdge,
  direction: "RIGHT" | "DOWN" = graph.direction ?? "RIGHT",
): { source: string; target: string } {
  const find = (end: "source" | "target") => {
    const node = graph.nodes.find((item) => item.id === edge[end]);
    if (!node) throw new Error("An edge endpoint is absent from the graph");
    const ports = graphPorts(node);
    const explicit = edge[`${end}Port`];
    if (explicit) return explicit;
    const side =
      direction === "DOWN"
        ? end === "source"
          ? "bottom"
          : "top"
        : end === "source"
          ? "right"
          : "left";
    return (ports.find((port) => port.side === side) ?? ports[0])!.id;
  };
  return { source: find("source"), target: find("target") };
}
