import type { RendererTokens } from "@ponchia/ui/renderer";
import type { GraphContent, VisualTarget } from "../index.ts";

/**
 * The renderer's ID for a record. Renderer IDs are namespaced because the
 * canonical node and edge collections may reuse an ID.
 */
export const runtimeElementId = (collection: string | undefined, id: string) =>
  `${collection === "nodes" ? "node" : "edge"}:${id}`;

/** The record a renderer ID names, or null for an ID this renderer did not mint. */
export function canonicalElementId(
  runtimeId: string,
): { collection: "nodes" | "edges"; id: string } | null {
  if (runtimeId.startsWith("node:")) return { collection: "nodes", id: runtimeId.slice(5) };
  if (runtimeId.startsWith("edge:")) return { collection: "edges", id: runtimeId.slice(5) };
  return null;
}

/** The graph the layout places: the whole model, or one node and its neighbours. */
export function networkData(content: GraphContent, focus: string) {
  const neighbors = new Set(focus ? [focus] : content.nodes.map((node) => node.id));
  if (focus)
    for (const edge of content.edges) {
      if (edge.source === focus) neighbors.add(edge.target);
      if (edge.target === focus) neighbors.add(edge.source);
    }
  const nodes = content.nodes.filter((node) => neighbors.has(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = content.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return {
    nodes: nodes.map((node, index) => ({
      id: runtimeElementId("nodes", node.id),
      data: {
        id: node.id,
        label: node.label,
        degree: degree.get(node.id) ?? 0,
        group: !!node.group,
      },
      // A deterministic initial circle avoids random geometry and exact-zero overlaps.
      style: {
        x: Math.cos((index * Math.PI * 2) / Math.max(1, nodes.length)) * 240,
        y: Math.sin((index * Math.PI * 2) / Math.max(1, nodes.length)) * 240,
      },
    })),
    edges: edges.map((edge) => ({
      id: runtimeElementId("edges", edge.id),
      source: runtimeElementId("nodes", edge.source),
      target: runtimeElementId("nodes", edge.target),
      data: { id: edge.id, label: edge.label },
    })),
  };
}

/**
 * Find emphasises matches instead of removing everything else: a filtered graph
 * is a different graph, so every keystroke would re-run the layout and move the
 * camera the reader chose. Null when nothing is sought.
 */
export function networkMatches(content: GraphContent, query: string): ReadonlySet<string> | null {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return null;
  return new Set(
    content.nodes
      .filter((node) => `${node.label} ${node.id}`.toLocaleLowerCase().includes(needle))
      .map((node) => node.id),
  );
}

interface RuntimeEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

/** The colours a network draws in, for the page's current look. */
export interface NetworkPalette {
  /** A node's fill, and the selected relationship. */
  node: string;
  /** The selected node's ring. */
  ring: string;
  /** Every other relationship. */
  edge: string;
}

/*
  The node blue is the categorical palette's first slot, the one the graph
  matrix and timeline lanes read. The relationships are this view's content,
  so they draw in --edge, the page's relationship line: a graphical object
  that holds 3:1 against the panel (WCAG 1.4.11) in either theme, as canvas
  connections and diagram edges do. The selected node takes an ink ring, as a
  selected timeline item does: a tint of the node blue would vanish on a light
  panel.
*/
export function networkPalette(tokens: RendererTokens): NetworkPalette {
  return {
    node: tokens.categorical[0] ?? tokens.info,
    ring: tokens.text,
    edge: tokens.edge,
  };
}

/**
 * One frame of renderer-local emphasis: label size for the current zoom, the
 * selection ring and the selected relationship's label, and Find's dimming. Every field is written each frame because
 * G6 keeps a datum's last style until it is replaced.
 */
export function networkStyles(
  nodes: readonly { id: string }[],
  edges: readonly RuntimeEdge[],
  selected: string,
  matches: ReadonlySet<string> | null,
  zoom: number,
  palette: NetworkPalette,
) {
  const size = 13 / Math.max(0.08, zoom);
  const found = (runtimeId: string) =>
    !matches || matches.has(canonicalElementId(runtimeId)?.id ?? "");
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      style: {
        labelFontSize: size,
        labelLineHeight: (size * 16) / 13,
        labelMaxWidth: size * 10,
        stroke: node.id === selected ? palette.ring : palette.node,
        lineWidth: node.id === selected ? 3 : 0,
        fillOpacity: found(node.id) ? 1 : 0.2,
        labelFillOpacity: found(node.id) ? 1 : 0.35,
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      style: {
        stroke: edge.id === selected ? palette.node : palette.edge,
        lineWidth: edge.id === selected ? 3 : 1.5,
        strokeOpacity: found(edge.source) && found(edge.target) ? 1 : 0.12,
        // Only the selected relationship is labelled: at a readable size a
        // label on every line would bury the nodes it connects.
        labelText: edge.id === selected ? edge.label : "",
        labelFontSize: size,
      },
    })),
  };
}

/**
 * What the pointer is over, as a native tooltip: the whole name of a node,
 * whose drawn label may be shortened or hidden, or a relationship's ends and
 * label. Empty for anything else.
 */
export function networkHoverTitle(content: GraphContent, runtimeId: string): string {
  const element = canonicalElementId(runtimeId);
  const label = (node: string) => content.nodes.find((item) => item.id === node)?.label ?? node;
  if (element?.collection === "nodes")
    return content.nodes.some((node) => node.id === element.id) ? label(element.id) : "";
  const edge =
    element?.collection === "edges"
      ? content.edges.find((item) => item.id === element.id)
      : undefined;
  return edge ? `${label(edge.source)} → ${label(edge.target)}: ${edge.label}` : "";
}

/** Selection, then Find's matches, then one-hop context outrank degree for native label adaptation. */
export function networkPriority(
  content: GraphContent,
  selected: VisualTarget | null,
  matches: ReadonlySet<string> | null = null,
): Map<string, number> {
  const ranks = new Map(content.nodes.map((node) => [node.id, 0]));
  const focused = new Set<string>();
  if (selected?.collection === "nodes") focused.add(selected.elementId);
  else if (selected?.collection === "edges") {
    const edge = content.edges.find((edge) => edge.id === selected.elementId);
    if (edge) {
      focused.add(edge.source);
      focused.add(edge.target);
    }
  }
  for (const edge of content.edges) {
    ranks.set(edge.source, (ranks.get(edge.source) ?? 0) + 1);
    ranks.set(edge.target, (ranks.get(edge.target) ?? 0) + 1);
    if (focused.has(edge.source)) ranks.set(edge.target, (ranks.get(edge.target) ?? 0) + 1000);
    if (focused.has(edge.target)) ranks.set(edge.source, (ranks.get(edge.source) ?? 0) + 1000);
  }
  for (const id of matches ?? []) ranks.set(id, (ranks.get(id) ?? 0) + 100_000);
  for (const id of focused) ranks.set(id, 1_000_000);
  return ranks;
}
