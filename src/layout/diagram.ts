import { elkDiagramRouting } from "./elk-routing.ts";
import type { DiagramRouting } from "../render/diagram-routing.ts";
import type { ElkNode, ElkPort } from "elkjs";
import type { VisualFamilyResolver } from "../family-resolver.ts";
import {
  assertKnownFields,
  assertVisualJson,
  modelSummary,
  type VisualModel,
  type VisualModelHead,
  type VisualItemPatch,
  VisualModelError,
  visualRecord,
} from "../model.ts";
import { assertVisualModel, editModel, type ModelEdit } from "../operations.ts";
import { GRAPH_ENTITY_SIZE, GRAPH_GROUP_PADDING, type GraphContent } from "../semantic.ts";
import { graphEdgeHandles, graphPorts } from "../render/graph-ports.ts";

export interface DiagramLayoutOptions {
  direction?: "RIGHT" | "DOWN";
  /** Gap between nodes in a layer; pixels, 24–240. */
  spacing?: number;
  /** Gap between successive layers; pixels, 40–400. */
  layerSpacing?: number;
}
export interface DiagramLayoutContext {
  registry?: VisualFamilyResolver;
  signal?: AbortSignal;
  /** Trusted host-owned ELK runner, e.g. an instance backed by a Web Worker. */
  engine?: { layout(graph: ElkNode): Promise<ElkNode> };
}
export interface DiagramLayoutProposal {
  algorithm: "elk-layered";
  base: VisualModelHead;
  patch: ModelEdit;
  nodeCount: number;
  edgeCount: number;
  /** Envelope of the computed layout, not a stored viewport. */
  bounds: { width: number; height: number };
  /** Derived routing cache for the proposed content; never persisted by the patch. */
  routing: DiagramRouting;
}
const SIDES = { top: "NORTH", right: "EAST", bottom: "SOUTH", left: "WEST" } as const;
const fail = () =>
  new VisualModelError(
    "unavailable",
    "Layout returned invalid geometry; saved content is unchanged",
  );
const number = (value: unknown, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw fail();
  return Math.round(value * 1000) / 1000;
};

/**
 * Explicit, asynchronous layout proposal. No saved source, receipt, viewport or edge route is changed.
 * The eventual commit rechecks the complete source revision because topology affects all positions.
 * This entry imports no ELK runtime and requires a host-owned engine.
 * Cancellation discards a late result; worker lifecycle belongs to the host.
 */
export async function layoutDiagram(
  model: VisualModel,
  options: DiagramLayoutOptions = {},
  context: DiagramLayoutContext = {},
): Promise<DiagramLayoutProposal> {
  assertVisualModel(model, context.registry);
  if (model.renderer !== "diagram" || model.modelType !== "graph")
    throw new VisualModelError("invalid", "This layout adapter accepts diagram models only");
  if (model.role !== "model")
    throw new VisualModelError(
      "forbidden",
      "Fork an immutable template or snapshot before arranging it",
    );
  assertVisualJson(options);
  if (options === null || typeof options !== "object" || Array.isArray(options))
    throw new VisualModelError("invalid", "Layout options must be an object");
  assertKnownFields(options as Record<string, unknown>, ["direction", "spacing", "layerSpacing"]);
  const source = structuredClone(model);
  const content = source.content as unknown as GraphContent;
  const direction = options.direction ?? content.direction ?? "RIGHT";
  const spacing = options.spacing ?? 48,
    layerSpacing = options.layerSpacing ?? 88;
  if (
    !["RIGHT", "DOWN"].includes(direction) ||
    !Number.isFinite(spacing) ||
    spacing < 24 ||
    spacing > 240 ||
    !Number.isFinite(layerSpacing) ||
    layerSpacing < 40 ||
    layerSpacing > 400
  )
    throw new VisualModelError("invalid", "Layout needs RIGHT/DOWN and bounded positive spacing");
  if (!content.nodes.length) throw new VisualModelError("invalid", "There are no nodes to arrange");
  const { engine: supplied, signal, registry } = { ...context };
  signal?.throwIfAborted();
  // Engine IDs are opaque and collision-free: no model text, source code, links or datasets leave this boundary.
  const sorted = [...content.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const names = new Map(sorted.map((node, index) => [node.id, `n${index}`]));
  const owners = new Map(sorted.map((node) => [names.get(node.id)!, node]));
  const ports = new Map<string, Map<string, string>>();
  const nodes = new Map<string, ElkNode>();
  for (const node of sorted) {
    const id = names.get(node.id)!;
    const width = node.width ?? GRAPH_ENTITY_SIZE.width;
    const height = node.height ?? GRAPH_ENTITY_SIZE.height;
    const placements = graphPorts(node);
    ports.set(node.id, new Map(placements.map((port, index) => [port.id, `${id}p${index}`])));
    const elkPorts: ElkPort[] = placements.map((port) => ({
      id: ports.get(node.id)!.get(port.id)!,
      width: 0,
      height: 0,
      layoutOptions: { "elk.port.side": SIDES[port.side] },
      x: port.side === "left" ? 0 : port.side === "right" ? width : width * port.offset,
      y: port.side === "top" ? 0 : port.side === "bottom" ? height : height * port.offset,
    }));
    nodes.set(node.id, {
      id,
      width,
      height,
      ports: elkPorts,
      layoutOptions: {
        "elk.portConstraints": node.group ? "FIXED_SIDE" : "FIXED_POS",
        ...(node.group
          ? {
              "elk.padding": `[top=${GRAPH_GROUP_PADDING.top},left=${GRAPH_GROUP_PADDING.side},bottom=${GRAPH_GROUP_PADDING.side},right=${GRAPH_GROUP_PADDING.side}]`,
            }
          : {}),
      },
    });
  }
  const endpointKey = (edge: GraphContent["edges"][number]) => {
    const ends = graphEdgeHandles(content, edge, direction);
    return JSON.stringify([edge.source, ends.source, edge.target, ends.target]);
  };
  const parallel = new Map<string, number>();
  for (const edge of content.edges)
    parallel.set(endpointKey(edge), (parallel.get(endpointKey(edge)) ?? 0) + 1);
  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.json.edgeCoords": "ROOT",
      "elk.json.shapeCoords": "PARENT",
      "elk.spacing.nodeNode": String(spacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
      // Network simplex made the measured flat DAGs far more compact, but
      // ELK 0.12.0 throws for some compound cross-boundary graphs with it.
      // Preserve the tested compound strategy instead of flattening their meaning.
      "elk.layered.nodePlacement.strategy": content.nodes.some(
        (node) => node.group || node.parentId,
      )
        ? "BRANDES_KOEPF"
        : "NETWORK_SIMPLEX",
      "elk.randomSeed": "1",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children: [],
    edges: [...content.edges]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((edge, index) => {
        const ends = graphEdgeHandles(content, edge, direction);
        return {
          id: `e${index}`,
          sources: [ports.get(edge.source)!.get(ends.source)!],
          targets: [ports.get(edge.target)!.get(ends.target)!],
          // Shared endpoints otherwise give coincident orthogonal routes, even with
          // mergeEdges=false. Reserve a small central lane only for parallel edges.
          // This can add a layer for that group; ordinary edges remain compact.
          // Actual text is still measured/placed by the host, never sent to ELK.
          ...((parallel.get(endpointKey(edge)) ?? 0) > 1
            ? {
                labels: [
                  {
                    text: "lane",
                    width: 1,
                    height: 12,
                    layoutOptions: { "elk.edgeLabels.placement": "CENTER" },
                  },
                ],
              }
            : {}),
        };
      }),
  };
  for (const node of sorted) {
    const parent = node.parentId ? nodes.get(node.parentId)! : root;
    (parent.children ??= []).push(nodes.get(node.id)!);
  }
  if (!supplied)
    throw new VisualModelError(
      "unavailable",
      "Provide a host-owned layout engine or use the optional /layout/elk entry",
    );
  let arranged: ElkNode;
  try {
    arranged = await supplied.layout(root);
  } catch {
    signal?.throwIfAborted();
    throw new VisualModelError(
      "unavailable",
      "Diagram layout could not complete; check the host runner",
    );
  }
  signal?.throwIfAborted();
  // Validate before traversing runner-owned objects so getters/non-JSON output
  // cannot execute while translating a proposed layout.
  try {
    assertVisualJson(arranged);
  } catch {
    throw fail();
  }
  const seen = new Set<string>();
  const updates = new Map<string, VisualItemPatch>();
  const collect = (children: ElkNode[], parentId?: string) => {
    if (!Array.isArray(children) || children.length > sorted.length) throw fail();
    for (const node of children) {
      if (!visualRecord(node)) throw fail();
      const original = owners.get(node.id);
      if (!original || seen.has(node.id) || original.parentId !== parentId) throw fail();
      seen.add(node.id);
      const x = number(node.x, -100000, 100000),
        y = number(node.y, -100000, 100000);
      const width = number(node.width, 40, 10000),
        height = number(node.height, 40, 10000);
      const update: VisualItemPatch = { id: original.id, x, y };
      if (original.group) {
        update.width = width;
        update.height = height;
      } else if (
        width !== (original.width ?? GRAPH_ENTITY_SIZE.width) ||
        height !== (original.height ?? GRAPH_ENTITY_SIZE.height)
      )
        throw fail();
      updates.set(original.id, update);
      if (node.children?.length) collect(node.children, original.id);
    }
  };
  if (!visualRecord(arranged) || arranged.id !== "root") throw fail();
  collect(arranged.children ?? []);
  if (seen.size !== sorted.length) throw fail();
  const patch: ModelEdit = {
    generation: source.generation,
    ifRevision: source.revision,
    content: { direction },
    items: [{ field: "nodes", set: content.nodes.map((node) => updates.get(node.id)!) }],
  };
  // Validate the translation through the actual mutation contract, including the host's narrower registry.
  const candidate = editModel(source, patch, {}, registry).model;
  const routing = elkDiagramRouting(
    candidate,
    arranged,
    new Map([...owners].map(([id, node]) => [id, node.id])),
    [...content.edges]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((edge) => edge.id),
  );
  signal?.throwIfAborted();
  const summary = modelSummary(source);
  return {
    algorithm: "elk-layered",
    routing,
    base: {
      id: summary.id,
      renderer: source.renderer,
      generation: summary.generation,
      revision: summary.revision,
    },
    patch,
    nodeCount: content.nodes.length,
    edgeCount: content.edges.length,
    bounds: {
      width: number(arranged.width, 0, 200000),
      height: number(arranged.height, 0, 200000),
    },
  };
}
