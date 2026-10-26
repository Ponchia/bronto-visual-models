import type { C4Content } from "../c4.ts";
import { sha256Hex } from "../hash.ts";
import { assertVisualJson, canonicalVisualJson, type VisualModel } from "../model.ts";
import { C4_CARD, c4Scene, type C4Scene } from "./c4.ts";
import {
  type DiagramBox,
  type DiagramEdgeRoute,
  type DiagramPoint,
  validDiagramBox,
  placeDiagramLabels,
} from "./diagram-routing.ts";

/** The renderer reserves these bounded boxes; complete text remains in the inspector. */
export const C4_RELATIONSHIP_LABEL = { width: 190, height: 66 } as const;
/** Optional, derived geometry for exactly one C4 diagram. Never stored with the architecture. */
export interface C4Routing {
  modelId: string;
  generation: string;
  viewId: string;
  fingerprint: string;
  edges: DiagramEdgeRoute[];
  omitted: string[];
}
export function c4RoutingFingerprint(model: VisualModel, viewId: string): string {
  return sha256Hex(
    canonicalVisualJson({
      id: model.id,
      generation: model.generation,
      renderer: model.renderer,
      rendererVersion: model.rendererVersion,
      viewId,
      content: model.content,
      incarnations: model.elementIncarnations ?? {},
    }),
  );
}
const finite = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 2_000_000;
/** Route ends must actually meet the referenced cards, not just carry plausible IDs. */
export function c4RouteOnBorder(point: DiagramPoint, box: DiagramBox): boolean {
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.05;
  return (
    point.x >= box.x - 0.05 &&
    point.x <= box.x + box.width + 0.05 &&
    point.y >= box.y - 0.05 &&
    point.y <= box.y + box.height + 0.05 &&
    (close(point.x, box.x) ||
      close(point.x, box.x + box.width) ||
      close(point.y, box.y) ||
      close(point.y, box.y + box.height))
  );
}
/** Geometry-only validator reused by the worker translation; no whole-model hashing per edge. */
export function c4RouteGeometryMatches(
  route: DiagramEdgeRoute,
  source: DiagramBox,
  target: DiagramBox,
): boolean {
  if (
    !route ||
    !Array.isArray(route.points) ||
    route.points.length < 2 ||
    route.points.length > 128
  )
    return false;
  for (let i = 0; i < route.points.length; i++) {
    const p = route.points[i],
      before = route.points[i - 1];
    if (
      !p ||
      !finite(p.x) ||
      !finite(p.y) ||
      (before && Math.abs(before.x - p.x) > 0.01 && Math.abs(before.y - p.y) > 0.01)
    )
      return false;
  }
  if (!c4RouteOnBorder(route.points[0]!, source) || !c4RouteOnBorder(route.points.at(-1)!, target))
    return false;
  return (
    !route.label ||
    (validDiagramBox(route.label) && route.label.width <= 1000 && route.label.height <= 500)
  );
}
/** Validate before rendering any coordinates from a host/worker-owned cache. */
export function c4RoutingMatches(model: VisualModel, viewId: string, routing?: C4Routing): boolean {
  if (!routing || model.renderer !== "c4") return false;
  try {
    assertVisualJson(routing);
    const scene = c4Scene(model.content as unknown as C4Content, viewId);
    if (
      routing.modelId !== model.id ||
      routing.generation !== model.generation ||
      routing.viewId !== viewId ||
      routing.fingerprint !== c4RoutingFingerprint(model, viewId) ||
      !Array.isArray(routing.edges) ||
      routing.edges.length > scene.relationships.length ||
      !Array.isArray(routing.omitted) ||
      routing.omitted.length > scene.relationships.length
    )
      return false;
    const nodes = new Map(
      scene.elements.map((e) => [e.element.id, { x: e.x, y: e.y, ...C4_CARD }]),
    );
    const edges = new Map(scene.relationships.map((r) => [r.id, r]));
    const seen = new Set<string>();
    for (const route of routing.edges) {
      const edge = route && edges.get(route.id);
      if (
        !edge ||
        seen.has(route.id) ||
        !Array.isArray(route.points) ||
        route.points.length < 2 ||
        route.points.length > 128
      )
        return false;
      seen.add(route.id);
      if (!c4RouteGeometryMatches(route, nodes.get(edge.source)!, nodes.get(edge.target)!))
        return false;
    }
    for (const id of routing.omitted) {
      if (!edges.has(id) || seen.has(id)) return false;
      seen.add(id);
    }
    return seen.size === edges.size;
  } catch {
    return false;
  }
}
/** Reuse pure geometry placement, not a graph model or a conversion of C4 semantics. */
export function c4RoutingLabels(scene: C4Scene, routing: C4Routing) {
  const nodes = scene.elements.map((e) => ({
    id: e.element.id,
    label: "",
    x: e.x,
    y: e.y,
    ...C4_CARD,
  }));
  const boundary = scene.boundary;
  return placeDiagramLabels(
    {
      nodes: [
        ...nodes,
        ...(boundary
          ? [
              {
                id: ":c4-boundary",
                label: "",
                group: true,
                x: boundary.x,
                y: boundary.y,
                width: boundary.width,
                height: 44,
              },
            ]
          : []),
      ],
      edges: [],
    },
    routing.edges,
    new Map(scene.relationships.map((r) => [r.id, C4_RELATIONSHIP_LABEL])),
  );
}
