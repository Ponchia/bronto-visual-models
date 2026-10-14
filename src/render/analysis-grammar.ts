import type { RendererTokens } from "@ponchia/ui/renderer";
import type { AnalysisContent } from "../index.ts";
import { type SankeyLink, type SankeyNode, sankey, sankeyLinkHorizontal } from "d3-sankey";
import type { Spec } from "vega";

const ROOT = "__spatial_analysis_root__";
/** Named hues before the rest fold into one neutral Other colour. */
const HUES = 7;
const opacity = { signal: "!selected || datum.id === selected ? 1 : 0.3" };
const tooltip = { signal: "datum.label + (isValid(datum.value) ? ': ' + datum.value : '')" };
const base = {
  $schema: "https://vega.github.io/schema/vega/v6.json",
  // Geometry is computed against this exact drawable box, including its own
  // margins. Vega fit-autosize would repeatedly shrink width/height around
  // fixed-coordinate marks until zero, translating real marks out of view.
  padding: 0,
  autosize: "none",
  signals: [{ name: "selected", value: "" }],
};
/**
 * A branch's palette slot, or -1 for Other. Colour follows a branch in authored
 * order, never its rank, so editing one value never repaints the others.
 */
function slotOf(branches: string[]): (id: string) => number {
  return (id) => {
    const index = branches.indexOf(id);
    return index >= 0 && index < HUES ? index : -1;
  };
}
/** Each node's slot by the branch it belongs to: the first level with siblings. */
function hierarchySlots(content: AnalysisContent): Map<string, number> {
  const children = new Map<string | undefined, string[]>();
  for (const node of content.nodes) {
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  let level = children.get(undefined) ?? [];
  for (let depth = 0; level.length === 1 && depth < content.nodes.length; depth += 1)
    level = children.get(level[0]) ?? level;
  const slot = slotOf(level);
  const parents = new Map(content.nodes.map((node) => [node.id, node.parentId]));
  const result = new Map<string, number>();
  for (const node of content.nodes) {
    let id: string | undefined = node.id;
    for (let depth = 0; id && !level.includes(id) && depth < content.nodes.length; depth += 1)
      id = parents.get(id);
    result.set(node.id, id ? slot(id) : -1);
  }
  return result;
}
/** The drawable box: the smallest size its fixed margins still fit. */
export function analysisBox(size: { width: number; height: number }) {
  return { width: Math.max(240, size.width), height: Math.max(180, size.height) };
}
export type AnalysisData = Record<string, object[]>;
/**
 * The identified values one layout draws, laid out for one box. A new size
 * re-lays out these values; the compiled grammar stays.
 */
export function analysisData(
  content: AnalysisContent,
  width: number,
  height: number,
): AnalysisData {
  if (content.layout === "sankey") {
    type Datum = { id: string; label: string };
    const graph = sankey<Datum, Datum>()
      .nodeId((node) => node.id)
      .nodeWidth(18)
      .nodePadding(18)
      .extent([
        [20, 20],
        [Math.max(120, width - 20), Math.max(80, height - 30)],
      ])({
      nodes: content.nodes.map((node) => ({ id: node.id, label: node.label })),
      links: (content.links ?? []).map((link) => ({ ...link })),
    });
    const linkPath = sankeyLinkHorizontal<Datum, Datum>();
    const slot = slotOf(content.nodes.map((node) => node.id));
    const nodes = graph.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      slot: slot(node.id),
      value: node.value,
      x0: node.x0,
      x1: node.x1,
      y0: node.y0,
      y1: node.y1,
      collection: "nodes",
    }));
    const links = graph.links.map((link) => ({
      id: link.id,
      label: link.label,
      value: link.value,
      path: linkPath(link as SankeyLink<Datum, Datum>),
      width: link.width,
      slot: slot((link.source as SankeyNode<Datum, Datum>).id),
      collection: "links",
    }));
    return { entities: nodes, links };
  }
  if (content.layout === "parallel") {
    const dimensions = content.dimensions ?? [];
    const extent = dimensions.map((dimension) => {
      const values = content.nodes.map((node) => node.metrics?.[dimension] ?? 0);
      return [Math.min(...values, 0), Math.max(...values, 1)];
    });
    const axes = dimensions.map((label, index) => ({
      label,
      x: 40 + (index * Math.max(1, width - 80)) / Math.max(1, dimensions.length - 1),
      low: extent[index]?.[0],
      high: extent[index]?.[1],
      limit: Math.max(50, width / dimensions.length - 10),
    }));
    const slot = slotOf(content.nodes.map((node) => node.id));
    const rows = content.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      slot: slot(node.id),
      collection: "nodes",
      path: dimensions
        .map((dimension, index) => {
          const range = extent[index] ?? [0, 1],
            low = range[0] ?? 0,
            high = range[1] ?? 1;
          const y =
            height -
            40 -
            (((node.metrics?.[dimension] ?? 0) - low) / Math.max(1e-12, high - low)) *
              (height - 80);
          return `${index ? "L" : "M"}${axes[index]?.x ?? 0},${y}`;
        })
        .join(" "),
    }));
    return { entities: rows, axes };
  }
  let root = ROOT;
  while (content.nodes.some((node) => node.id === root)) root += "_";
  const slots = hierarchySlots(content);
  return {
    entities: [
      { id: root, label: "", parentId: null, value: 0, slot: -1, collection: "nodes" },
      ...content.nodes.map((node) => ({
        ...node,
        parentId: node.parentId ?? root,
        slot: slots.get(node.id) ?? -1,
        collection: "nodes",
      })),
    ],
  };
}
/** A datum's colour: its branch's hue, or the neutral Other. */
const colourOf = "(datum.slot >= 0 && datum.slot < length(hues) ? hues[datum.slot] : other)";
const colour = { signal: colourOf };
/** Label ink that reads on a filled mark: whichever of text and surface contrasts more. */
const inkOnFill = `contrast(${colourOf}, ink) >= contrast(${colourOf}, paper) ? ink : paper`;

/**
 * Only reviewed grammars are constructed; model data never becomes executable
 * expression text or a URL. Colours come from the host's chart tokens.
 */
export function analysisSpec(layout: AnalysisContent["layout"], tokens: RendererTokens): Spec {
  const palette = {
    ...base,
    signals: [
      ...base.signals,
      { name: "hues", value: tokens.categorical.slice(0, HUES) },
      { name: "other", value: tokens.textDim },
      { name: "ink", value: tokens.text },
      { name: "paper", value: tokens.panel },
    ],
  };
  if (layout === "sankey")
    return {
      ...palette,
      data: [
        { name: "entities", values: [] },
        { name: "links", values: [] },
      ],
      marks: [
        {
          type: "path",
          from: { data: "links" },
          encode: {
            update: {
              path: { field: "path" },
              stroke: colour,
              strokeWidth: { field: "width" },
              strokeOpacity: { value: 0.45 },
              opacity,
              tooltip,
            },
          },
        },
        {
          type: "rect",
          from: { data: "entities" },
          encode: {
            update: {
              x: { field: "x0" },
              x2: { field: "x1" },
              y: { field: "y0" },
              y2: { field: "y1" },
              fill: colour,
              opacity,
              tooltip,
            },
          },
        },
        {
          type: "text",
          from: { data: "entities" },
          encode: {
            update: {
              x: { signal: "datum.x0 < width/2 ? datum.x1 + 6 : datum.x0 - 6" },
              y: { signal: "(datum.y0 + datum.y1)/2" },
              align: { signal: "datum.x0 < width/2 ? 'left' : 'right'" },
              baseline: { value: "middle" },
              limit: { value: 160 },
              text: { field: "label" },
              fontSize: { value: 13 },
              fill: { signal: "ink" },
              opacity,
            },
          },
        },
      ],
    } as Spec;
  if (layout === "parallel")
    return {
      ...palette,
      data: [
        { name: "entities", values: [] },
        { name: "axes", values: [] },
      ],
      marks: [
        {
          type: "rule",
          from: { data: "axes" },
          encode: {
            update: {
              x: { field: "x" },
              y: { value: 40 },
              y2: { signal: "height-40" },
              stroke: { signal: "ink" },
              strokeOpacity: { value: 0.35 },
            },
          },
        },
        {
          type: "path",
          from: { data: "entities" },
          encode: {
            update: {
              path: { field: "path" },
              stroke: colour,
              strokeWidth: { signal: "datum.id === selected ? 4 : 2" },
              opacity,
              tooltip: { field: "label" },
            },
          },
        },
        ...(
          [
            ["label", "20"],
            ["high", "38"],
            ["low", "height - 22"],
          ] as const
        ).map(([field, y]) => ({
          type: "text",
          from: { data: "axes" },
          encode: {
            update: {
              x: { field: "x" },
              y: { signal: y },
              text: { field },
              align: { value: "center" },
              fontSize: { value: 12 },
              fill: { signal: "ink" },
              limit: { field: "limit" },
            },
          },
        })),
      ],
    } as Spec;
  const tree = {
    name: "entities",
    values: [],
    transform: [
      { type: "stratify", key: "id", parentKey: "parentId" },
      layout === "sunburst"
        ? {
            type: "partition",
            field: "value",
            size: [{ signal: "2 * PI" }, { signal: "min(width, height) / 2 - 8" }],
            as: ["a0", "r0", "a1", "r1", "depth", "children"],
          }
        : {
            type: "treemap",
            field: "value",
            method: "resquarify",
            size: [{ signal: "width" }, { signal: "height" }],
            paddingInner: 3,
            paddingTop: 24,
            paddingOuter: 4,
          },
      { type: "filter", expr: "datum.depth > 0" },
    ],
  };
  const marks =
    layout === "sunburst"
      ? [
          {
            type: "arc",
            from: { data: "entities" },
            encode: {
              update: {
                x: { signal: "width/2" },
                y: { signal: "height/2" },
                startAngle: { field: "a0" },
                endAngle: { field: "a1" },
                innerRadius: { field: "r0" },
                outerRadius: { field: "r1" },
                stroke: { signal: "paper" },
                strokeWidth: { value: 2 },
                fill: colour,
                opacity,
                tooltip,
              },
            },
          },
        ]
      : [
          {
            type: "rect",
            from: { data: "entities" },
            encode: {
              update: {
                x: { field: "x0" },
                x2: { field: "x1" },
                y: { field: "y0" },
                y2: { field: "y1" },
                fill: colour,
                fillOpacity: { signal: "datum.children ? 0.25 : 0.8" },
                stroke: { signal: "paper" },
                strokeWidth: { value: 2 },
                opacity,
                tooltip,
              },
            },
          },
          {
            type: "text",
            from: { data: "entities" },
            encode: {
              update: {
                x: { signal: "datum.x0+5" },
                y: { signal: "datum.y0+16" },
                // Headers only for the first level, and a label only where its box fits it.
                text: {
                  signal:
                    "(datum.children && datum.depth > 1) || datum.x1 - datum.x0 < 40 || datum.y1 - datum.y0 < 20 ? '' : datum.label",
                },
                limit: { signal: "max(0,datum.x1-datum.x0-10)" },
                // A parent's header sits on its faint wash, a leaf's label on its fill.
                fill: { signal: `datum.children ? ink : ${inkOnFill}` },
                fontSize: { value: 13 },
                opacity,
              },
            },
          },
        ];
  return { ...palette, data: [tree], marks } as Spec;
}
