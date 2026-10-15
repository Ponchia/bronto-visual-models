import type { RendererTokens } from "@ponchia/ui/renderer";
import type { GraphContent } from "../index.ts";
import type { Spec } from "vega";

export type MatrixOrder = "authored" | "label" | "degree";

/** A cell may represent several edges. Only explicit edge choice is a durable target. */
export function graphMatrix(content: GraphContent, query: string, order: MatrixOrder) {
  const needle = query.trim().toLocaleLowerCase();
  const nodes = content.nodes.filter(
    (node) => !needle || `${node.label} ${node.id}`.toLocaleLowerCase().includes(needle),
  );
  const ids = new Set(nodes.map((node) => node.id));
  const edges = content.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  const degree = new Map<string, number>();
  const byCell = new Map<string, { source: string; target: string; edges: typeof edges }>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    const key = JSON.stringify([edge.source, edge.target]);
    const cell = byCell.get(key) ?? { source: edge.source, target: edge.target, edges: [] };
    cell.edges.push(edge);
    byCell.set(key, cell);
  }
  if (order !== "authored")
    nodes.sort(
      (a, b) =>
        (order === "degree" ? (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) : 0) ||
        a.label.localeCompare(b.label) ||
        a.id.localeCompare(b.id),
    );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    nodes: nodes.map((node, index) => ({ ...node, index, collection: "nodes" })),
    cells: [...byCell.entries()].map(([key, cell]) => ({
      ...cell,
      key,
      count: cell.edges.length,
      ids: cell.edges.map((edge) => edge.id),
      label: `${byId.get(cell.source)?.label} → ${byId.get(cell.target)?.label}`,
      tooltip: `${byId.get(cell.source)?.label} → ${byId.get(cell.target)?.label}: ${cell.edges.map((edge) => edge.label).join("; ")}`,
    })),
    edges,
  };
}

/** Label margin and cell size that fit one ordered matrix into the available width. */
function matrixLayout(data: ReturnType<typeof graphMatrix>, availableWidth: number) {
  const margin = Math.min(
    140,
    Math.max(64, ...data.nodes.map((node) => node.label.length * 7 + 12)),
  );
  const cell = Math.max(
    16,
    Math.min(40, Math.floor((availableWidth - margin - 10) / Math.max(1, data.nodes.length))),
  );
  return { margin, cell, grid: cell * data.nodes.length };
}
/** The datasets one matrix draws at one available width. */
export function matrixData(data: ReturnType<typeof graphMatrix>, availableWidth: number) {
  return {
    nodes: data.nodes,
    cells: data.cells,
    layout: [matrixLayout(data, availableWidth)],
  };
}
/**
 * Sparse marks: O(nodes + edges), not a quadratic cross-product of empty
 * cells. The grammar is fixed per scheme's tokens; nodes, cells and the layout row
 * arrive as data, so filtering, ordering and resizing keep the compiled view.
 */
export function matrixSpec(tokens: RendererTokens): Spec {
  const ink = tokens.text,
    line = tokens.line;
  return {
    $schema: "https://vega.github.io/schema/vega/v6.json",
    width: { signal: "max(160, layout.grid + layout.margin + 10)" },
    height: { signal: "max(180, layout.grid + layout.margin + 10)" },
    padding: 0,
    autosize: "none",
    description:
      "Directed dependency matrix. Rows are sources; columns are targets. Choose an edge for an unambiguous comment.",
    signals: [
      { name: "layout", update: "data('layout')[0]" },
      { name: "selected", value: "" },
      { name: "selectedNode", value: "" },
    ],
    data: [
      { name: "nodes", values: [] },
      { name: "cells", values: [] },
      { name: "layout", values: [{ margin: 64, cell: 16, grid: 0 }] },
    ],
    scales: [
      {
        name: "position",
        type: "band",
        domain: { data: "nodes", field: "id" },
        range: { signal: "[layout.margin, layout.margin + layout.grid]" },
      },
    ],
    marks: [
      {
        type: "rule",
        aria: false, // grid guides are decorative; cells and labels carry the meaning
        from: { data: "nodes" },
        encode: {
          update: {
            x: { signal: "layout.margin" },
            x2: { signal: "layout.margin + layout.grid" },
            y: { scale: "position", field: "id" },
            stroke: { value: line },
          },
        },
      },
      {
        type: "rule",
        aria: false, // grid guides are decorative; cells and labels carry the meaning
        from: { data: "nodes" },
        encode: {
          update: {
            y: { signal: "layout.margin" },
            y2: { signal: "layout.margin + layout.grid" },
            x: { scale: "position", field: "id" },
            stroke: { value: line },
          },
        },
      },
      {
        type: "rect",
        name: "relationships",
        from: { data: "cells" },
        encode: {
          update: {
            x: { scale: "position", field: "target", offset: 1 },
            y: { scale: "position", field: "source", offset: 1 },
            width: { signal: "layout.cell - 2" },
            height: { signal: "layout.cell - 2" },
            fill: { value: tokens.categorical[0] ?? ink },
            fillOpacity: {
              signal:
                "(!selected && !selectedNode) || indexof(datum.ids, selected) >= 0 || datum.source === selectedNode || datum.target === selectedNode ? 1 : 0.3",
            },
            stroke: { signal: `indexof(datum.ids, selected) >= 0 ? '${ink}' : 'transparent'` },
            strokeWidth: { value: 2 },
            cursor: { value: "pointer" },
            tooltip: { field: "tooltip" },
            aria: { value: true },
            description: { field: "tooltip" },
          },
        },
      },
      {
        type: "text",
        name: "sources",
        from: { data: "nodes" },
        encode: {
          update: {
            x: { signal: "layout.margin - 8" },
            y: { scale: "position", field: "id", band: 0.5 },
            text: { field: "label" },
            align: { value: "right" },
            baseline: { value: "middle" },
            fill: { value: ink },
            fontSize: { value: 12 },
            limit: { signal: "layout.margin - 14" },
            tooltip: { field: "label" },
            cursor: { value: "pointer" },
          },
        },
      },
      {
        type: "text",
        name: "targets",
        from: { data: "nodes" },
        encode: {
          update: {
            y: { signal: "layout.margin - 8" },
            x: { scale: "position", field: "id", band: 0.5 },
            text: { field: "label" },
            angle: { value: -65 },
            align: { value: "left" },
            baseline: { value: "middle" },
            fill: { value: ink },
            fontSize: { value: 12 },
            limit: { signal: "layout.margin - 14" },
            tooltip: { field: "label" },
            cursor: { value: "pointer" },
          },
        },
      },
    ],
  };
}
