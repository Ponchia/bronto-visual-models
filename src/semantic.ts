import { VISUAL_RECORD_ID_SCHEMA as id } from "./model.ts";
import { TIMELINE_SOURCE_FIELDS } from "./timeline-source.ts";

/** The semantic families' bounds. Their schemas declare them; derivations and imports read them here. */
export const SEMANTIC_LIMITS = {
  label: 240,
  graphNodes: 300,
  graphEdges: 600,
  timelineLanes: 32,
  timelineEvents: 1000,
} as const;
const label = { type: "string", minLength: 1, maxLength: SEMANTIC_LIMITS.label } as const;
const prose = { type: "string", maxLength: 4000 } as const;
const position = { type: "number", minimum: -100000, maximum: 100000 } as const;
const size = { type: "number", minimum: 40, maximum: 10000 } as const;
const side = { type: "string", enum: ["top", "right", "bottom", "left"] } as const;
const identity = { id, label, description: prose, entityId: id };
const record = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const array = (items: unknown, maxItems: number) => ({ type: "array", items, maxItems });
const source = record(
  {
    language: { type: "string", enum: ["d2", "graphviz", "mermaid"] },
    text: { type: "string", maxLength: 20000 },
    notes: array({ type: "string", maxLength: 1000 }, 40),
  },
  ["language", "text"],
);

export interface SemanticEntity {
  id: string;
  label: string;
  description?: string;
  entityId?: string;
}
export interface GraphNode extends SemanticEntity {
  x: number;
  y: number;
  width?: number;
  height?: number;
  parentId?: string;
  group?: boolean;
  href?: string;
  ports?: Array<{ id: string; label?: string; side: "top" | "right" | "bottom" | "left" }>;
}
export interface GraphEdge extends SemanticEntity {
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
}
export interface GraphContent {
  nodes: GraphNode[];
  edges: GraphEdge[];
  direction?: "RIGHT" | "DOWN";
  source?: { language: "d2" | "graphviz" | "mermaid"; text: string; notes?: string[] };
}
/** An entity's size when it declares none; a collapsed group draws at this size too. */
export const GRAPH_ENTITY_SIZE = { width: 180, height: 90 } as const;
/**
 * A group's title band. A relationship may cross it, but its label must not
 * cover the title, and a laid-out group's children start below it.
 */
export const GRAPH_GROUP_TITLE_BAND = 44;
/** Where a laid-out group's children sit: below its title band, inset from its other sides. */
export const GRAPH_GROUP_PADDING = { top: GRAPH_GROUP_TITLE_BAND + 24, side: 24 } as const;
export interface TimelineEvent extends SemanticEntity {
  start: number;
  end?: number;
  lane: string;
}
export interface TimelineContent {
  lanes: SemanticEntity[];
  events: TimelineEvent[];
}
export type GanttTaskStatus = "planned" | "active" | "blocked" | "at-risk" | "done";
export interface GanttTask extends SemanticEntity {
  workstream: string;
  start: number;
  end?: number;
  progress?: number;
  status?: GanttTaskStatus;
  owner?: string;
  milestone?: boolean;
  parentId?: string;
}
export interface GanttDependency extends SemanticEntity {
  source: string;
  target: string;
  type: "finish-to-start";
}
export interface GanttContent {
  workstreams: SemanticEntity[];
  tasks: GanttTask[];
  dependencies: GanttDependency[];
}
export interface AnalysisNode extends SemanticEntity {
  value?: number;
  parentId?: string;
  metrics?: Record<string, number>;
}
export interface AnalysisLink extends SemanticEntity {
  source: string;
  target: string;
  value: number;
}
export interface AnalysisContent {
  layout: "sankey" | "treemap" | "sunburst" | "parallel";
  nodes: AnalysisNode[];
  links?: AnalysisLink[];
  dimensions?: string[];
}
export interface GeographicFeature extends SemanticEntity {
  geometry: {
    type: "Point" | "LineString" | "Polygon";
    coordinates: unknown;
  };
}
export interface GeographicContent {
  features: GeographicFeature[];
  center?: [number, number];
  zoom?: number;
}
export const GRAPH_SCHEMA = record(
  {
    nodes: array(
      record(
        {
          ...identity,
          x: position,
          y: position,
          width: size,
          height: size,
          parentId: id,
          group: { type: "boolean" },
          href: {
            type: "string",
            pattern: "^(?:https?://|/[^/]|#)[^\\s]*$",
            maxLength: 300,
          },
          ports: array(record({ id, label, side }, ["id", "side"]), 16),
        },
        ["id", "label", "x", "y"],
      ),
      SEMANTIC_LIMITS.graphNodes,
    ),
    edges: array(
      record({ ...identity, source: id, target: id, sourcePort: id, targetPort: id }, [
        "id",
        "label",
        "source",
        "target",
      ]),
      SEMANTIC_LIMITS.graphEdges,
    ),
    direction: { type: "string", enum: ["RIGHT", "DOWN"] },
    source,
  },
  ["nodes", "edges"],
);
export const TIMELINE_SCHEMA = record(
  {
    ...TIMELINE_SOURCE_FIELDS,
    lanes: array(record(identity, ["id", "label"]), SEMANTIC_LIMITS.timelineLanes),
    events: array(
      record({ ...identity, lane: id, start: { type: "number" }, end: { type: "number" } }, [
        "id",
        "label",
        "lane",
        "start",
      ]),
      SEMANTIC_LIMITS.timelineEvents,
    ),
  },
  ["lanes", "events"],
);
export const GANTT_SCHEMA = record(
  {
    workstreams: array(record(identity, ["id", "label"]), 64),
    tasks: array(
      record(
        {
          ...identity,
          workstream: id,
          start: { type: "number" },
          end: { type: "number" },
          progress: { type: "number", minimum: 0, maximum: 100 },
          status: {
            type: "string",
            enum: ["planned", "active", "blocked", "at-risk", "done"],
          },
          owner: { type: "string", maxLength: 120 },
          milestone: { type: "boolean" },
          parentId: id,
        },
        ["id", "label", "workstream", "start"],
      ),
      1000,
    ),
    dependencies: array(
      record(
        {
          ...identity,
          source: id,
          target: id,
          type: { type: "string", enum: ["finish-to-start"] },
        },
        ["id", "label", "source", "target", "type"],
      ),
      2000,
    ),
  },
  ["workstreams", "tasks", "dependencies"],
);
export const ANALYSIS_SCHEMA = record(
  {
    layout: { type: "string", enum: ["sankey", "treemap", "sunburst", "parallel"] },
    nodes: array(
      record(
        {
          ...identity,
          value: { type: "number", minimum: 0 },
          parentId: id,
          metrics: { type: "object", maxProperties: 16, additionalProperties: { type: "number" } },
        },
        ["id", "label"],
      ),
      1000,
    ),
    links: array(
      record(
        { ...identity, source: id, target: id, value: { type: "number", exclusiveMinimum: 0 } },
        ["id", "label", "source", "target", "value"],
      ),
      2000,
    ),
    dimensions: array({ type: "string", minLength: 1, maxLength: 80 }, 12),
  },
  ["layout", "nodes"],
);
export const GEOGRAPHY_SCHEMA = record(
  {
    features: array(
      record(
        {
          ...identity,
          geometry: record(
            {
              type: { type: "string", enum: ["Point", "LineString", "Polygon"] },
              coordinates: { type: "array" },
            },
            ["type", "coordinates"],
          ),
        },
        ["id", "label", "geometry"],
      ),
      1000,
    ),
    center: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
    zoom: { type: "number", minimum: 0, maximum: 20 },
  },
  ["features"],
);
