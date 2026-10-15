import type { ElkNode } from "elkjs";
import { visualRecord, type VisualModel } from "../model.ts";
import type { GraphContent } from "../semantic.ts";
import {
  diagramRoutingFingerprint,
  diagramRoutingMatches,
  type DiagramRouting,
  type DiagramPoint,
  validDiagramBox,
} from "../render/diagram-routing.ts";
import { graphPorts, graphEdgeHandles } from "../render/graph-ports.ts";

/** Extract only normalized ROOT-space edge coordinates; never write routes into model content. */
export function elkDiagramRouting(
  model: VisualModel,
  root: ElkNode,
  nodes: ReadonlyMap<string, string>,
  edgeIds: readonly string[],
): DiagramRouting {
  const graph = model.content as unknown as GraphContent;
  const result: DiagramRouting = {
    modelId: model.id,
    generation: model.generation,
    fingerprint: diagramRoutingFingerprint(model),
    edges: [],
    ports: [],
    omitted: [],
  };
  const point = (p: unknown): p is DiagramPoint =>
    !!p &&
    typeof p === "object" &&
    Number.isFinite((p as DiagramPoint).x) &&
    Number.isFinite((p as DiagramPoint).y) &&
    Math.abs((p as DiagramPoint).x) <= 2_000_000 &&
    Math.abs((p as DiagramPoint).y) <= 2_000_000;
  const norm = (p: DiagramPoint) => ({
    x: Math.round(p.x * 1000) / 1000,
    y: Math.round(p.y * 1000) / 1000,
  });
  const seen = new Set<string>();
  const visit = (node: ElkNode) => {
    const id = nodes.get(node.id),
      authored = graph.nodes.find((n) => n.id === id);
    if (authored && Array.isArray(node.ports)) {
      const declared = graphPorts(authored);
      for (let i = 0; i < declared.length; i++) {
        const port = declared[i]!,
          computed = node.ports.find((p) => visualRecord(p) && p.id === `${node.id}p${i}`);
        if (!computed || !point(computed) || !node.width || !node.height) continue;
        const offset =
          port.side === "left" || port.side === "right"
            ? computed.y / node.height
            : computed.x / node.width;
        if (offset >= 0 && offset <= 1) result.ports.push({ nodeId: id!, portId: port.id, offset });
      }
    }
    for (const edge of Array.isArray(node.edges) ? node.edges : []) {
      if (!visualRecord(edge)) continue;
      const index = /^e(\d+)$/.exec(edge.id)?.[1],
        id = index === undefined ? undefined : edgeIds[Number(index)];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const authoredEdge = graph.edges.find((e) => e.id === id)!;
      const handles = graphEdgeHandles(graph, authoredEdge);
      const expected = (end: "source" | "target") => {
        const authoredNode = graph.nodes.find((n) => n.id === authoredEdge[end])!;
        const engineId = [...nodes].find(([, authoredId]) => authoredId === authoredNode.id)?.[0];
        const index = graphPorts(authoredNode).findIndex((p) => p.id === handles[end]);
        return `${engineId}p${index}`;
      };
      if (
        !Array.isArray(edge.sources) ||
        edge.sources.length !== 1 ||
        !Array.isArray(edge.targets) ||
        edge.targets.length !== 1 ||
        edge.sources[0] !== expected("source") ||
        edge.targets[0] !== expected("target")
      ) {
        result.omitted.push(id);
        continue;
      }
      // Binary graph edges should have a single section. Branching or absent sections are disclosed as unrouted.
      const sections = edge.sections;
      if (!Array.isArray(sections) || sections.length !== 1) {
        result.omitted.push(id);
        continue;
      }
      const section = sections[0];
      if (
        !visualRecord(section) ||
        (section.bendPoints !== undefined && !Array.isArray(section.bendPoints))
      ) {
        result.omitted.push(id);
        continue;
      }
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
      if (
        points.length > 128 ||
        !points.every(point) ||
        points.some(
          (p, i) =>
            i > 0 &&
            Math.abs(p.x - points[i - 1]!.x) > 0.01 &&
            Math.abs(p.y - points[i - 1]!.y) > 0.01,
        )
      ) {
        result.omitted.push(id);
        continue;
      }
      const label = Array.isArray(edge.labels) ? edge.labels[0] : undefined;
      result.edges.push({
        id,
        points: points.map(norm),
        ...(label && validDiagramBox(label as any) && label.width! <= 1000 && label.height! <= 500
          ? {
              label: { ...norm(label as DiagramPoint), width: label.width!, height: label.height! },
            }
          : {}),
      });
    }
    for (const child of Array.isArray(node.children) ? node.children : [])
      if (visualRecord(child)) visit(child);
  };
  visit(root);
  for (const edge of graph.edges) if (!seen.has(edge.id)) result.omitted.push(edge.id);
  // A caller-supplied runner is a trust boundary. Invalid caches fall back rather than becoming paths.
  if (!diagramRoutingMatches(model, result))
    return { ...result, edges: [], ports: [], omitted: graph.edges.map((e) => e.id) };
  return result;
}
