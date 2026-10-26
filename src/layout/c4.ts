import type { ElkNode, ElkExtendedEdge } from "elkjs";
import type { VisualFamilyResolver } from "../family-resolver.ts";
import type { C4Content, C4Position } from "../c4.ts";
import {
  assertKnownFields,
  assertVisualJson,
  canonicalVisualJson,
  visualRecord,
  VisualModelError,
  type VisualModel,
  type VisualModelHead,
} from "../model.ts";
import { assertVisualModel, editModel, type ModelEdit } from "../operations.ts";
import { C4_CARD, c4Scene, c4PositionEdit } from "../render/c4.ts";
import { boxesOverlap, type DiagramEdgeRoute } from "../render/diagram-routing.ts";
import {
  C4_RELATIONSHIP_LABEL,
  c4RouteGeometryMatches,
  c4RoutingFingerprint,
  c4RoutingMatches,
  type C4Routing,
} from "../render/c4-routing.ts";

export interface C4LayoutOptions {
  direction?: "RIGHT" | "DOWN";
  /** Gap between cards; 40–240. */
  spacing?: number;
  /** Gap between layers, with space reserved for protocol labels; 80–500. */
  layerSpacing?: number;
}
export interface C4LayoutContext {
  registry?: VisualFamilyResolver;
  signal?: AbortSignal;
  /** Host owns worker lifetime, timeouts and cancellation of actual computation. */
  engine?: { layout(graph: ElkNode): Promise<ElkNode> };
}
export interface C4LayoutProposal {
  algorithm: "elk-layered";
  base: VisualModelHead;
  viewId: string;
  positions: C4Position[];
  patch: ModelEdit;
  routing: C4Routing;
  bounds: { width: number; height: number };
  nodeCount: number;
  edgeCount: number;
}
export type C4LayoutRunner = (
  model: VisualModel,
  viewId: string,
  options: C4LayoutOptions,
  signal: AbortSignal,
) => Promise<C4LayoutProposal>;
const fail = () =>
  new VisualModelError(
    "unavailable",
    "C4 layout returned invalid geometry; saved architecture is unchanged",
  );
const number = (value: unknown, max = 200000) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max)
    throw fail();
  return Math.round(value * 1000) / 1000;
};

/** Check a host proposal before previewing or applying it. Only the selected diagram's positions may change. */
export function c4LayoutCandidate(
  model: VisualModel,
  proposal: C4LayoutProposal,
  registry?: VisualFamilyResolver,
): VisualModel {
  assertVisualModel(model, registry);
  assertVisualJson(proposal);
  if (
    !visualRecord(proposal) ||
    !visualRecord(proposal.base) ||
    model.renderer !== "c4" ||
    proposal.algorithm !== "elk-layered" ||
    proposal.base.id !== model.id ||
    proposal.base.renderer !== "c4" ||
    proposal.base.generation !== model.generation ||
    proposal.base.revision !== model.revision
  )
    throw new VisualModelError(
      "conflict",
      "The architecture changed since this layout was requested; preview again",
    );
  if (typeof proposal.viewId !== "string" || !Array.isArray(proposal.positions)) throw fail();
  const scene = c4Scene(model.content as unknown as C4Content, proposal.viewId);
  const expectedIds = new Set(scene.elements.map((e) => e.element.id));
  if (
    proposal.positions.length !== expectedIds.size ||
    new Set(proposal.positions.map((p) => p?.elementId)).size !== expectedIds.size ||
    proposal.positions.some((p) => !p || !expectedIds.has(p.elementId))
  )
    throw fail();
  const patch = c4PositionEdit(model, proposal.viewId, proposal.positions);
  if (canonicalVisualJson(patch) !== canonicalVisualJson(proposal.patch))
    throw new VisualModelError(
      "invalid",
      "A C4 layout may only update the requested diagram's positions",
    );
  const candidate = editModel(model, patch, {}, registry).model;
  if (!c4RoutingMatches(candidate, proposal.viewId, proposal.routing)) throw fail();
  if (!visualRecord(proposal.bounds)) throw fail();
  number(proposal.bounds.width);
  number(proposal.bounds.height);
  if (proposal.nodeCount !== expectedIds.size || proposal.edgeCount !== scene.relationships.length)
    throw fail();
  return candidate;
}

/** Pure layout proposal through a host runner; topology/text/other diagram layouts are never rewritten. */
export async function layoutC4(
  model: VisualModel,
  viewId: string,
  options: C4LayoutOptions = {},
  context: C4LayoutContext = {},
): Promise<C4LayoutProposal> {
  const { signal, engine, registry } = { ...context };
  signal?.throwIfAborted();
  assertVisualModel(model, registry);
  if (model.renderer !== "c4")
    throw new VisualModelError("invalid", "This layout adapter accepts C4 architecture only");
  if (model.role !== "model")
    throw new VisualModelError("forbidden", "Fork an immutable architecture before arranging it");
  assertVisualJson(options);
  if (!visualRecord(options))
    throw new VisualModelError("invalid", "C4 layout options must be an object");
  assertKnownFields(options, ["direction", "spacing", "layerSpacing"]);
  const direction = options.direction ?? "RIGHT",
    spacing = options.spacing ?? 72,
    layerSpacing = options.layerSpacing ?? 140;
  if (
    (direction !== "RIGHT" && direction !== "DOWN") ||
    typeof spacing !== "number" ||
    !Number.isFinite(spacing) ||
    spacing < 40 ||
    spacing > 240 ||
    typeof layerSpacing !== "number" ||
    !Number.isFinite(layerSpacing) ||
    layerSpacing < 80 ||
    layerSpacing > 500
  )
    throw new VisualModelError(
      "invalid",
      "C4 layout needs RIGHT/DOWN and bounded positive spacing",
    );
  const source = structuredClone(model);
  const scene = c4Scene(source.content as unknown as C4Content, viewId);
  if (!scene.elements.length)
    throw new VisualModelError("invalid", "There are no C4 elements to arrange in this diagram");
  if (!engine)
    throw new VisualModelError(
      "unavailable",
      "Provide a host-owned layout engine or use the optional /layout/c4-elk entry",
    );
  const elements = [...scene.elements].sort((a, b) => (a.element.id < b.element.id ? -1 : 1));
  const names = new Map(elements.map((e, i) => [e.element.id, `n${i}`]));
  const byEngine = new Map(elements.map((e) => [names.get(e.element.id)!, e.element]));
  const edges = [...scene.relationships].sort((a, b) => (a.id < b.id ? -1 : 1));
  const group = scene.boundary
    ? {
        id: "scope",
        children: [] as ElkNode[],
        layoutOptions: { "elk.padding": "[top=72,left=32,bottom=32,right=32]" },
      }
    : undefined;
  const root: ElkNode = {
    id: "root",
    children: group ? [group] : [],
    edges: edges.map((edge, i) => ({
      id: `e${i}`,
      sources: [names.get(edge.source)!],
      targets: [names.get(edge.target)!],
      labels: [
        {
          text: "relationship",
          ...C4_RELATIONSHIP_LABEL,
          layoutOptions: { "elk.edgeLabels.placement": "CENTER" },
        },
      ],
    })),
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.json.edgeCoords": "ROOT",
      "elk.json.shapeCoords": "PARENT",
      "elk.spacing.nodeNode": String(spacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
      "elk.layered.nodePlacement.strategy": group ? "BRANDES_KOEPF" : "NETWORK_SIMPLEX",
      "elk.layered.mergeEdges": "false",
      "elk.randomSeed": "1",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
    },
  };
  for (const { element } of elements) {
    const parent = group && element.parentId === scene.view.scope ? group : root;
    parent.children!.push({ id: names.get(element.id)!, ...C4_CARD });
  }
  let arranged: ElkNode;
  try {
    arranged = await engine.layout(root);
  } catch {
    signal?.throwIfAborted();
    throw new VisualModelError(
      "unavailable",
      "C4 layout could not complete; check the host runner",
    );
  }
  signal?.throwIfAborted();
  try {
    assertVisualJson(arranged);
  } catch {
    throw fail();
  }
  if (!visualRecord(arranged) || arranged.id !== "root") throw fail();
  const seen = new Set<string>(),
    positions = new Map<string, C4Position>(),
    engineEdges: ElkExtendedEdge[] = [];
  const collect = (node: ElkNode, parent: string, x: number, y: number) => {
    if (!Array.isArray(node.children) || node.children.length > elements.length + 1) throw fail();
    if (node.edges !== undefined) {
      if (
        !Array.isArray(node.edges) ||
        node.edges.length > edges.length ||
        engineEdges.length + node.edges.length > edges.length
      )
        throw fail();
      engineEdges.push(...node.edges);
    }
    for (const child of node.children) {
      if (!visualRecord(child) || seen.has(child.id)) throw fail();
      seen.add(child.id);
      const cx = number(child.x, 100000) + x,
        cy = number(child.y, 100000) + y;
      number(cx, 100000);
      number(cy, 100000);
      if (child.id === "scope") {
        if (!group || parent !== "root") throw fail();
        number(child.width);
        number(child.height);
        collect(child, "scope", cx, cy);
        continue;
      }
      const element = byEngine.get(child.id);
      if (
        !element ||
        parent !== (group && element.parentId === scene.view.scope ? "scope" : "root") ||
        child.width !== C4_CARD.width ||
        child.height !== C4_CARD.height ||
        (child.children !== undefined && (!Array.isArray(child.children) || child.children.length))
      )
        throw fail();
      positions.set(element.id, { elementId: element.id, x: cx, y: cy });
      if (child.edges !== undefined && (!Array.isArray(child.edges) || child.edges.length))
        throw fail();
    }
  };
  collect(arranged, "root", 0, 0);
  if (positions.size !== elements.length || (!!group && !seen.has("scope"))) throw fail();
  const ordered = scene.elements.map((e) => positions.get(e.element.id)!);
  const patch = c4PositionEdit(source, viewId, ordered);
  const candidate = editModel(source, patch, {}, registry).model;
  const candidateScene = c4Scene(candidate.content as unknown as C4Content, viewId);
  const boxes = candidateScene.elements.map((e) => ({ x: e.x, y: e.y, ...C4_CARD }));
  if (boxes.some((box, i) => boxes.slice(i + 1).some((other) => boxesOverlap(box, other))))
    throw fail();
  if (
    candidateScene.boundary &&
    candidateScene.elements.some(
      (e) =>
        e.element.parentId !== scene.view.scope &&
        boxesOverlap({ x: e.x, y: e.y, ...C4_CARD }, candidateScene.boundary!),
    )
  )
    throw fail();
  const routing: C4Routing = {
    modelId: source.id,
    generation: source.generation,
    viewId,
    fingerprint: c4RoutingFingerprint(candidate, viewId),
    edges: [],
    omitted: [],
  };
  const routes = new Map<string, DiagramEdgeRoute>();
  const sceneBoxes = new Map(
    candidateScene.elements.map((e) => [e.element.id, { x: e.x, y: e.y, ...C4_CARD }]),
  );
  const seenEdges = new Set<string>();
  for (const edge of engineEdges) {
    if (!visualRecord(edge)) continue;
    const match = /^e(\d+)$/.exec(edge.id),
      original = match ? edges[Number(match[1])] : undefined;
    if (original && seenEdges.has(original.id)) {
      routes.delete(original.id);
      continue;
    }
    if (original) seenEdges.add(original.id);
    if (
      !original ||
      !Array.isArray(edge.sources) ||
      !Array.isArray(edge.targets) ||
      edge.sources.length !== 1 ||
      edge.targets.length !== 1 ||
      edge.sources[0] !== names.get(original.source) ||
      edge.targets[0] !== names.get(original.target) ||
      !Array.isArray(edge.sections) ||
      edge.sections.length !== 1
    )
      continue;
    const section = edge.sections[0];
    if (
      !visualRecord(section) ||
      (section.bendPoints !== undefined && !Array.isArray(section.bendPoints))
    )
      continue;
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    if (points.some((p) => !visualRecord(p))) continue;
    const route: DiagramEdgeRoute = {
      id: original.id,
      points: points.map((p) => ({ x: p.x, y: p.y })),
    };
    if (
      c4RouteGeometryMatches(
        route,
        sceneBoxes.get(original.source)!,
        sceneBoxes.get(original.target)!,
      )
    )
      routes.set(original.id, route);
  }
  routing.edges = edges.flatMap((e) => (routes.has(e.id) ? [routes.get(e.id)!] : []));
  routing.omitted = edges.filter((e) => !routes.has(e.id)).map((e) => e.id);
  const proposal: C4LayoutProposal = {
    algorithm: "elk-layered",
    base: {
      id: source.id,
      generation: source.generation,
      revision: source.revision,
      renderer: source.renderer,
    },
    viewId,
    positions: ordered,
    patch,
    routing,
    bounds: { width: number(arranged.width), height: number(arranged.height) },
    nodeCount: elements.length,
    edgeCount: edges.length,
  };
  c4LayoutCandidate(source, proposal, registry);
  signal?.throwIfAborted();
  return proposal;
}
