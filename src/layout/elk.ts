import type { ElkNode, ElkPort, ELK } from "elkjs";
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
import {
  GRAPH_ENTITY_SIZE,
  GRAPH_GROUP_PADDING,
  type GraphContent,
  type GraphNode,
} from "../semantic.ts";
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
 * Bundled ELK is lazy and in-process. Use a host-owned worker runner for larger interactive diagrams.
 * Cancellation discards a late result; it cannot preempt a synchronous in-process computation.
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
  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
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
          // Bounded measurement hint; labels themselves remain exclusively in the host.
          labels: [{ text: "", width: Math.min(160, edge.label.length * 7 + 12), height: 18 }],
        };
      }),
  };
  for (const node of sorted) {
    const parent = node.parentId ? nodes.get(node.parentId)! : root;
    (parent.children ??= []).push(nodes.get(node.id)!);
  }
  let owned: { layout(graph: ElkNode): Promise<ElkNode>; terminateWorker(): void } | undefined;
  let arranged: ElkNode;
  try {
    if (!supplied) {
      const module = await import("elkjs/lib/elk.bundled.js");
      // The upstream CommonJS entry exports this constructor at runtime.
      const Constructor = module.default as unknown as { new (): ELK };
      signal?.throwIfAborted();
      owned = new Constructor();
    }
    arranged = await (supplied ?? owned!).layout(root);
  } catch (error) {
    signal?.throwIfAborted();
    // Upstream errors may include serialized input. Do not leak model data or loader details.
    throw new VisualModelError(
      "unavailable",
      "Diagram layout could not complete; install the optional elkjs peer or check the host runner",
    );
  }
  // The bundled default does not own a real Worker. Calling terminateWorker on
  // ELK's in-process shim throws; a supplied worker's lifecycle belongs to its host.
  signal?.throwIfAborted();
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
  editModel(source, patch, {}, registry);
  signal?.throwIfAborted();
  const summary = modelSummary(source);
  return {
    algorithm: "elk-layered",
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
