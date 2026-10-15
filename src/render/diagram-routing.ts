import { sha256Hex } from "../hash.ts";
import { assertVisualJson, canonicalVisualJson, type VisualModel } from "../model.ts";
import { GRAPH_ENTITY_SIZE, GRAPH_GROUP_TITLE_BAND, type GraphContent } from "../semantic.ts";

export interface DiagramPoint {
  x: number;
  y: number;
}
export interface DiagramBox extends DiagramPoint {
  width: number;
  height: number;
}
export interface DiagramEdgeRoute {
  id: string;
  points: DiagramPoint[];
  /** Optional engine label box in root coordinates. Actual font measurements can supersede it. */
  label?: DiagramBox;
}
/** A derived cache, never a field in a stored model or a receipt. */
export interface DiagramRouting {
  modelId: string;
  generation: string;
  fingerprint: string;
  edges: DiagramEdgeRoute[];
  ports: Array<{ nodeId: string; portId: string; offset: number }>;
  omitted: string[];
}

/** Labels, hierarchy, sizes, topology, ports and element lifetimes all invalidate route geometry. */
export function diagramRoutingFingerprint(model: VisualModel): string {
  return sha256Hex(
    canonicalVisualJson({
      id: model.id,
      generation: model.generation,
      renderer: model.renderer,
      content: model.content,
      incarnations: model.elementIncarnations ?? {},
    }),
  );
}
const finite = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 2_000_000;
export function validDiagramBox(box: DiagramBox): boolean {
  return (
    !!box &&
    finite(box.x) &&
    finite(box.y) &&
    finite(box.width) &&
    finite(box.height) &&
    box.width > 0 &&
    box.height > 0
  );
}

/** Untrusted host cache is bounded and checked before producing any path or CSS coordinate. */
export function diagramRoutingMatches(
  model: VisualModel,
  routing: DiagramRouting | undefined,
): boolean {
  if (!routing || model.renderer !== "diagram") return false;
  try {
    assertVisualJson(routing);
    const content = model.content as unknown as GraphContent;
    if (
      routing.modelId !== model.id ||
      routing.generation !== model.generation ||
      routing.fingerprint !== diagramRoutingFingerprint(model) ||
      !Array.isArray(routing.edges) ||
      routing.edges.length > content.edges.length ||
      !Array.isArray(routing.ports) ||
      routing.ports.length > content.nodes.length * 16 ||
      !Array.isArray(routing.omitted) ||
      routing.omitted.length > content.edges.length
    )
      return false;
    const ids = new Set(content.edges.map((e) => e.id)),
      seen = new Set<string>();
    for (const route of routing.edges) {
      if (
        !route ||
        !ids.has(route.id) ||
        seen.has(route.id) ||
        !Array.isArray(route.points) ||
        route.points.length < 2 ||
        route.points.length > 128
      )
        return false;
      seen.add(route.id);
      for (let i = 0; i < route.points.length; i++) {
        const p = route.points[i];
        if (!p || !finite(p.x) || !finite(p.y)) return false;
        const before = route.points[i - 1];
        if (before && Math.abs(before.x - p.x) > 0.01 && Math.abs(before.y - p.y) > 0.01)
          return false;
      }
      if (
        route.label &&
        (!validDiagramBox(route.label) || route.label.width > 1000 || route.label.height > 500)
      )
        return false;
    }
    for (const id of routing.omitted) {
      if (!ids.has(id) || seen.has(id)) return false;
      seen.add(id);
    }
    if (seen.size !== ids.size) return false;
    const portKeys = new Set<string>();
    for (const port of routing.ports) {
      const node = content.nodes.find((n) => n.id === port.nodeId);
      const allowed = node?.ports?.length
        ? node.ports.map((p) => p.id)
        : ["top", "right", "bottom", "left"];
      const key = `${port.nodeId}\0${port.portId}`;
      if (
        !node ||
        !allowed.includes(port.portId) ||
        portKeys.has(key) ||
        !finite(port.offset) ||
        port.offset < 0 ||
        port.offset > 1
      )
        return false;
      portKeys.add(key);
    }
    return true;
  } catch {
    return false;
  }
}

/** Root-space node boxes; parents remain authored as relative positions in the document. */
export function diagramNodeBoxes(content: GraphContent): Map<string, DiagramBox> {
  const byId = new Map(content.nodes.map((node) => [node.id, node]));
  const boxes = new Map<string, DiagramBox>();
  const visit = (id: string, ancestors = new Set<string>()): DiagramBox => {
    const cached = boxes.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node || ancestors.has(id)) throw new Error("Invalid diagram hierarchy");
    const next = new Set(ancestors).add(id);
    const parent = node.parentId ? visit(node.parentId, next) : { x: 0, y: 0 };
    const box = {
      x: parent.x + node.x,
      y: parent.y + node.y,
      width: node.width ?? GRAPH_ENTITY_SIZE.width,
      height: node.height ?? GRAPH_ENTITY_SIZE.height,
    };
    boxes.set(id, box);
    return box;
  };
  for (const node of content.nodes) visit(node.id);
  return boxes;
}
export function boxesOverlap(a: DiagramBox, b: DiagramBox, padding = 0): boolean {
  return (
    a.x < b.x + b.width + padding &&
    a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding &&
    a.y + a.height + padding > b.y
  );
}

/** Bounded deterministic placement using host-measured text boxes; unresolved labels stay in the reading list. */
export function placeDiagramLabels(
  content: GraphContent,
  routes: readonly DiagramEdgeRoute[],
  sizes: ReadonlyMap<string, { width: number; height: number }>,
): { labels: Map<string, DiagramBox>; unplaced: string[] } {
  const boxes = diagramNodeBoxes(content);
  const occupied = content.nodes.map((node) => {
    const box = boxes.get(node.id)!;
    return node.group ? { ...box, height: Math.min(box.height, GRAPH_GROUP_TITLE_BAND) } : box;
  });
  const labels = new Map<string, DiagramBox>(),
    unplaced: string[] = [];
  for (const route of [...routes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const size = sizes.get(route.id);
    if (
      !size ||
      !Number.isFinite(size.width) ||
      !Number.isFinite(size.height) ||
      size.width < 1 ||
      size.width > 1000 ||
      size.height < 1 ||
      size.height > 200
    ) {
      unplaced.push(route.id);
      continue;
    }
    const candidates: DiagramPoint[] = [];
    if (route.label) {
      const anchor = {
        x: route.label.x + route.label.width / 2,
        y: route.label.y + route.label.height / 2,
      };
      const near = route.points.slice(1).some((b, i) => {
        const a = route.points[i]!;
        const x = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), anchor.x));
        const y = Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), anchor.y));
        return Math.hypot(anchor.x - x, anchor.y - y) < 50;
      });
      if (near) candidates.push(anchor);
    }
    const segments = route.points
      .slice(1)
      .map((end, i) => ({
        start: route.points[i]!,
        end,
        length: Math.abs(end.x - route.points[i]!.x) + Math.abs(end.y - route.points[i]!.y),
      }))
      .sort((a, b) => b.length - a.length)
      .slice(0, 8);
    for (const { start, end } of segments)
      for (const ratio of [0.5, 0.33, 0.67]) {
        const x = start.x + (end.x - start.x) * ratio,
          y = start.y + (end.y - start.y) * ratio;
        if (Math.abs(end.y - start.y) < 0.01) {
          candidates.push(
            { x, y: y - size.height / 2 - 5 },
            { x, y: y + size.height / 2 + 5 },
            { x, y },
          );
        } else candidates.push({ x: x + size.width / 2 + 6, y }, { x: x - size.width / 2 - 6, y });
      }
    const chosen = candidates
      .map((p) => ({ x: p.x - size.width / 2, y: p.y - size.height / 2, ...size }))
      .find((box) => !occupied.some((other) => boxesOverlap(box, other, 4)));
    if (chosen) {
      labels.set(route.id, chosen);
      occupied.push(chosen);
    } else unplaced.push(route.id);
  }
  return { labels, unplaced };
}

/** Rounded orthogonal polyline; geometry has already been validated before rendering. */
export function diagramRoutePath(points: readonly DiagramPoint[], radius = 5): string {
  if (points.length < 2) return "";
  const clean = points.filter((p, i) => !i || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
  if (clean.length < 2) return "";
  const n = (x: number) => String(Math.round(x * 1000) / 1000);
  let out = `M ${n(clean[0]!.x)} ${n(clean[0]!.y)}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const a = clean[i - 1]!,
      b = clean[i]!,
      c = clean[i + 1]!;
    const before = Math.hypot(b.x - a.x, b.y - a.y),
      after = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(Math.max(0, radius), before / 2, after / 2);
    const x1 = b.x + ((a.x - b.x) * r) / before,
      y1 = b.y + ((a.y - b.y) * r) / before;
    const x2 = b.x + ((c.x - b.x) * r) / after,
      y2 = b.y + ((c.y - b.y) * r) / after;
    out += ` L ${n(x1)} ${n(y1)} Q ${n(b.x)} ${n(b.y)} ${n(x2)} ${n(y2)}`;
  }
  return out + ` L ${n(clean.at(-1)!.x)} ${n(clean.at(-1)!.y)}`;
}
