import type { GraphContent, GraphNode } from "../semantic.ts";
import type { DiagramRouting } from "./diagram-routing.ts";
import { graphPorts } from "./graph-ports.ts";

/** Caller-scoped index over validated content; never retained globally or written into a model. */
export function graphInteractionIndex(content: GraphContent, routing?: DiagramRouting) {
  const nodes = new Map(content.nodes.map((node) => [node.id, node]));
  const edges = new Map(content.edges.map((edge) => [edge.id, edge]));
  const ports = new Map(content.nodes.map((node) => [node.id, graphPorts(node)]));
  const handles = new Map(
    content.edges.map((edge) => {
      const end = (key: "source" | "target") => {
        const all = ports.get(edge[key]);
        if (!all) throw new Error("An edge endpoint is absent from the graph");
        const explicit = edge[`${key}Port`];
        const side =
          content.direction === "DOWN"
            ? key === "source"
              ? "bottom"
              : "top"
            : key === "source"
              ? "right"
              : "left";
        return explicit ?? (all.find((port) => port.side === side) ?? all[0])!.id;
      };
      return [edge.id, { source: end("source"), target: end("target") }] as const;
    }),
  );
  const depth = new Map<string, number>();
  const visit = (node: GraphNode) => {
    if (depth.has(node.id)) return depth.get(node.id)!;
    const path: GraphNode[] = [],
      seen = new Set<string>();
    let current: GraphNode | undefined = node;
    while (current && !depth.has(current.id)) {
      if (seen.has(current.id)) throw new Error("Invalid graph hierarchy");
      path.push(current);
      seen.add(current.id);
      const parent: string | undefined = current.parentId;
      current = parent ? nodes.get(parent) : undefined;
      if (parent && !current) throw new Error("Invalid graph hierarchy");
    }
    let level = current ? depth.get(current.id)! + 1 : 0;
    while (path.length) depth.set(path.pop()!.id, level++);
    return depth.get(node.id)!;
  };
  for (const node of content.nodes) visit(node);
  const orderedNodes = [...content.nodes].sort((a, b) => depth.get(a.id)! - depth.get(b.id)!);
  const routes = new Map(routing?.edges.map((route) => [route.id, route]));
  const routePorts = new Map<string, DiagramRouting["ports"]>();
  for (const port of routing?.ports ?? []) {
    const list = routePorts.get(port.nodeId) ?? [];
    list.push(port);
    routePorts.set(port.nodeId, list);
  }
  return { nodes, edges, handles, orderedNodes, routes, routePorts };
}

/** Selection never rebuilds layout/ports/data. Unchanged items retain their exact references. */
export function graphSelection<T extends { id: string; selected?: boolean }>(
  items: readonly T[],
  id: string | undefined,
): T[] {
  return items.map((item) => {
    const selected = item.id === id;
    return !!item.selected === selected ? item : { ...item, selected };
  });
}
