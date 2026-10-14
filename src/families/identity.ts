import type { VisualFamilyResolver } from "../family-resolver.ts";
import { visualRecord } from "../model.ts";

/**
 * What every surface may know about a visual family without loading its
 * authoring contract: names, record collections, the representations that
 * draw it and what each can do. No schema, template or validator lives here,
 * so a canvas that only resolves targets or picks an adapter stays small; the
 * authoring half is `families/index.ts`.
 */

/** The families a person chooses from, in the order a gallery presents them. */
export const VISUAL_RENDERER_CATEGORIES = [
  "Charts",
  "Explanations",
  "Relationships",
  "Analysis",
  "Time",
  "Space",
] as const;
export type VisualRendererCategory = (typeof VISUAL_RENDERER_CATEGORIES)[number];

/**
 * Everything an adapter may declare, and what each promises. A term outside
 * this record is a type error, not a new capability. `spatial model catalog`
 * serves the meanings, so an agent reads what a view can do from here.
 */
export const VISUAL_CAPABILITY_MEANINGS = {
  select: "A person can pick an identified item and expose that selection to the host.",
  edit: "Changes model content from the view.",
  layout: "Arranges items deliberately rather than by a fixed grammar.",
  collapse: "Folds a group of items into one.",
  "resource-links": "Opens the canvas resources that items link to.",
  camera: "Owns pan and zoom gestures; the camera stays on the device.",
  playback: "Animates through the model's own time.",
  "time-navigation": "Moves through the model's own time range.",
  "linked-time": "Follows the time its group announces.",
  "linked-entity": "Emphasises an entity another view announces.",
  "dataset-binding": "Reads rows from a pinned dataset.",
  parameters: "Exposes the parameters its author declared.",
  dependencies: "Draws and edits scheduled dependencies.",
  "workspace-assets": "Loads files from the canvas workspace.",
  "source-edit": "Edits the original source text.",
  "svg-export": "Exports the drawn picture as SVG.",
  "png-export": "Exports the drawn picture as PNG.",
} as const;
export type VisualCapability = keyof typeof VISUAL_CAPABILITY_MEANINGS;

/**
 * What feeds a view beyond its saved content, and the content fields each
 * kind reads. A family's `source.kind` answers one of these per content; the
 * browser and the server dispatch on the kind, never on the family.
 */
export const VISUAL_SOURCE_KINDS = {
  none: "The saved content alone; a family's `rows` names the rows it carries.",
  dataset:
    'Rows of a host-provided dataset: `datasource: "dataset"`, `params.dataset` and an optional pinned `params.revision`.',
  "render-data": "Rows the server's named `datasource` produces from `params`.",
  connection:
    "Rows the browser reads through the paired account in `connection`; the server cannot read them.",
  assets:
    "Workspace files listed in `assets` as `{id, path, sha256}`, resolved and checked by the server.",
  compiled: "A picture the server's local compiler renders from `language` and `source`.",
} as const;
type VisualSourceKind = keyof typeof VISUAL_SOURCE_KINDS;
const rowsOf = (value: unknown) => (Array.isArray(value) ? value : []) as readonly Item[];
/** Whether a Vega-Lite spec declares a top-level parameter of this name that is not a selection. */
const declaresParam = (spec: unknown, name: string) =>
  visualRecord(spec) &&
  Array.isArray(spec.params) &&
  spec.params.some((param) => visualRecord(param) && param.name === name && !("select" in param));

/** One way to draw a family: the adapter, the projection a view saves to ask for it, and what it does. */
export interface VisualFamilyAdapter {
  readonly adapter: string;
  readonly projection?: {
    readonly id: string;
    readonly label: string;
    readonly requirement: string;
  };
  readonly capabilities: readonly VisualCapability[];
}

/** Whether content can be read in a projection, and if not, why not in words a person acts on. */
interface VisualEligibility {
  readonly eligible: boolean;
  readonly reason?: string;
}

type Content = Record<string, unknown>;
type Item = Record<string, unknown>;

export interface VisualFamilyIdentity {
  readonly id: string;
  readonly label: string;
  readonly category: VisualRendererCategory;
  readonly description: string;
  /** The type every model this renderer draws records. A request never chooses it. */
  readonly modelType: string;
  readonly version: number;
  readonly environment: "svg" | "webgl" | "image" | "dom";
  /** Collections of identified items, in the order targets list them. */
  readonly records: readonly string[];
  /**
   * How a collection's items are named where their own label is not enough,
   * such as a relationship named by what it joins. The default is the item's
   * label, then its note title, then its id.
   */
  readonly labels?: Readonly<Record<string, (item: Item, content: Content) => string>>;
  /** What the content holds, in a phrase a card or import preview shows. */
  readonly summary?: (content: Content) => string;
  /** Where drawn data comes from beyond the saved content. Absent means nowhere. */
  readonly source?: {
    readonly kind: (content: Content) => VisualSourceKind;
    /** The content a source read depends on; a change in any of it is a different read. */
    readonly inputs: (content: Content) => readonly unknown[];
    /** The rows the content carries itself, drawn when the kind is `none`. */
    readonly rows?: (content: Content) => readonly Item[];
  };
  /** The family's own adapter first; alternate projections follow in the order a view offers them. */
  readonly adapters: readonly VisualFamilyAdapter[];
  /** The projection a view shows when it names none. Defaults to the family id. */
  readonly defaultProjection?: (content: Content) => string;
  /** Whether content can be shown in an alternate projection. Defaults to always. */
  readonly eligible?: (projection: string, content: Content) => VisualEligibility;
  /**
   * Whether this content emphasises an entity another view announces, on a
   * view that declares `linked-entity`. Absent means it always does.
   */
  readonly followsEntity?: (content: Content) => boolean;
}

const selectEditExport = ["select", "edit", "svg-export", "png-export"] as const;
const spatialLayerCapabilities = [
  "select",
  "camera",
  "linked-entity",
  "dataset-binding",
  "png-export",
] as const;
const hierarchy = (layout: unknown) => layout === "treemap" || layout === "sunburst";
const count = (items: unknown, one: string, many: string) => {
  const n = Array.isArray(items) ? items.length : 0;
  return `${n} ${n === 1 ? one : many}`;
};
const named = (items: unknown, id: unknown) =>
  (Array.isArray(items) ? items : []).find((item) => item?.id === id)?.label ?? String(id);
/** A relationship named by what it joins: "Client → Service · calls". */
const joins =
  (ends: string) => (relation: Record<string, unknown>, content: Record<string, unknown>) =>
    `${named(content[ends], relation.source)} → ${named(content[ends], relation.target)} · ${relation.label}`;

const identities = [
  {
    id: "scene3d",
    label: "3D composition",
    category: "Space",
    description:
      "Real glTF/GLB assets and simple primitives with stable placed-object identity, transforms, finishes, lighting, saved viewpoints and measures.",
    modelType: "scene3d",
    // 2 adds `measures`; an older build leaves a version-2 model intact.
    version: 2,
    environment: "webgl",
    records: ["nodes", "assets", "viewpoints", "measures"],
    source: { kind: () => "assets", inputs: (content) => [content.assets] },
    adapters: [
      {
        adapter: "scene3d",
        capabilities: ["select", "edit", "camera", "playback", "workspace-assets", "png-export"],
      },
    ],
  },
  {
    id: "spatial-layers",
    label: "Spatial data layers",
    category: "Space",
    description:
      "Declarative points, paths, arcs, polygons and columns over explicit rows or pinned native datasets.",
    modelType: "spatial",
    version: 1,
    environment: "webgl",
    records: ["layers", "rows"],
    source: {
      kind: (content) => (content.datasource ? "dataset" : "none"),
      inputs: (content) => [content.datasource, content.params, content.fields],
      rows: (content) => rowsOf(content.rows),
    },
    adapters: [
      {
        adapter: "spatial-layers",
        projection: { id: "layers-2d", label: "Planar layers", requirement: "spatial data" },
        capabilities: spatialLayerCapabilities,
      },
      {
        adapter: "spatial-layers",
        projection: { id: "layers-3d", label: "Spatial layers", requirement: "spatial data" },
        capabilities: spatialLayerCapabilities,
      },
    ],
    defaultProjection: () => "layers-3d",
  },
  {
    id: "diagram",
    label: "Editable diagram",
    category: "Relationships",
    description: "Identified nodes, groups, ports and relationships with deliberate layout.",
    modelType: "graph",
    version: 1,
    environment: "dom",
    records: ["nodes", "edges"],
    summary: (content) =>
      `${count(content.nodes, "entity", "entities")} · ${count(content.edges, "relationship", "relationships")}`,
    labels: { edges: joins("nodes") },
    adapters: [
      {
        adapter: "diagram",
        projection: { id: "diagram", label: "Diagram", requirement: "graph" },
        capabilities: [
          "select",
          "edit",
          "layout",
          "collapse",
          "resource-links",
          "camera",
          "svg-export",
          "png-export",
        ],
      },
      {
        adapter: "network",
        projection: { id: "network", label: "Relationship network", requirement: "graph" },
        capabilities: ["select", "camera", "png-export"],
      },
      {
        adapter: "matrix",
        projection: { id: "matrix", label: "Dependency matrix", requirement: "graph" },
        capabilities: ["select", "svg-export", "png-export"],
      },
    ],
  },
  {
    id: "timeline",
    label: "Timeline",
    category: "Time",
    description:
      "Identified events and ranges in lanes; navigation is local and editing is explicit.",
    modelType: "timeline",
    version: 2,
    environment: "dom",
    records: ["lanes", "events"],
    summary: (content) =>
      content.datasource
        ? `Reads ${String(content.datasource)}`
        : `${count(content.events, "event", "events")} in ${count(content.lanes, "lane", "lanes")}`,
    source: {
      kind: (content) => (content.datasource ? "dataset" : "none"),
      inputs: (content) => [content.datasource, content.params, content.fields],
    },
    adapters: [
      {
        adapter: "timeline",
        capabilities: ["select", "edit", "camera", "time-navigation", "linked-time", "png-export"],
      },
    ],
  },
  {
    id: "gantt",
    label: "Gantt plan",
    category: "Time",
    description:
      "Scheduled workstreams, tasks, progress, milestones and finish-to-start dependencies.",
    modelType: "gantt",
    version: 1,
    environment: "dom",
    records: ["workstreams", "tasks", "dependencies"],
    summary: (content) =>
      `${count(content.tasks, "task", "tasks")} in ${count(content.workstreams, "workstream", "workstreams")} · ${count(content.dependencies, "dependency", "dependencies")}`,
    labels: { dependencies: joins("tasks") },
    adapters: [
      {
        adapter: "gantt",
        capabilities: ["select", "edit", "camera", "time-navigation", "dependencies", "png-export"],
      },
    ],
  },
  {
    id: "analysis",
    label: "Flow and hierarchy",
    category: "Analysis",
    description: "Weighted acyclic flows, treemaps, sunbursts and multivariable comparison.",
    modelType: "analysis",
    version: 1,
    environment: "svg",
    records: ["nodes", "links"],
    summary: (content) =>
      content.layout === "sankey"
        ? `${count(content.nodes, "entity", "entities")} · ${count(content.links, "flow", "flows")}`
        : content.layout === "parallel"
          ? `${count(content.nodes, "row", "rows")} across ${count(content.dimensions, "dimension", "dimensions")}`
          : `${count(content.nodes, "entity", "entities")} in a hierarchy`,
    labels: { links: joins("nodes") },
    adapters: [
      { adapter: "analysis", capabilities: selectEditExport },
      {
        adapter: "analysis",
        projection: { id: "treemap", label: "Treemap", requirement: "weighted hierarchy" },
        capabilities: selectEditExport,
      },
      {
        adapter: "analysis",
        projection: { id: "sunburst", label: "Sunburst", requirement: "weighted hierarchy" },
        capabilities: selectEditExport,
      },
    ],
    // The authored layout is the default; a hierarchy may also be read as the other one.
    defaultProjection: (content) => String(content.layout),
    eligible: (_projection, content) =>
      hierarchy(content.layout)
        ? { eligible: true }
        : {
            eligible: false,
            reason: `A treemap or sunburst reads a weighted hierarchy; this model is ${content.layout === "sankey" ? "a weighted flow" : "a parallel-coordinate comparison"}.`,
          },
  },
  {
    id: "geography",
    label: "Geography",
    category: "Space",
    description:
      "Identified local points, paths and areas without an implicit external tile provider.",
    modelType: "geography",
    version: 1,
    environment: "webgl",
    records: ["features"],
    summary: (content) => count(content.features, "feature", "features"),
    adapters: [{ adapter: "geography", capabilities: ["select", "camera", "png-export"] }],
  },
  {
    id: "infographic",
    label: "Infographic",
    category: "Explanations",
    description: "Editable sequences and visual explanations powered by AntV Infographic.",
    modelType: "infographic",
    version: 2,
    environment: "svg",
    records: ["items", "relations"],
    adapters: [{ adapter: "infographic", capabilities: selectEditExport }],
  },
  {
    id: "vega-lite",
    label: "Data chart",
    category: "Charts",
    description:
      "Analytical charts over explicit rows or controlled dataset bindings. The view decides a single or layered chart's size, so a stored width or height is ignored.",
    modelType: "chart",
    version: 1,
    environment: "svg",
    records: ["annotations"],
    summary: (content) =>
      [
        content.datasource
          ? `Reads ${String(content.datasource)}`
          : count(content.values, "row", "rows"),
        ...(Array.isArray(content.annotations) && content.annotations.length
          ? [count(content.annotations, "annotation", "annotations")]
          : []),
      ].join(" · "),
    source: {
      kind: (content) =>
        content.connection
          ? "connection"
          : content.datasource === "dataset"
            ? "dataset"
            : content.datasource
              ? "render-data"
              : "none",
      inputs: (content) => [content.datasource, content.params, content.connection],
      rows: (content) => rowsOf(content.values),
    },
    // A chart emphasises an announced entity only where its spec says how.
    followsEntity: (content) => declaresParam(content.spec, "spatial_entity"),
    adapters: [
      {
        adapter: "vega-lite",
        capabilities: [
          "select",
          "edit",
          "parameters",
          "linked-time",
          "linked-entity",
          "dataset-binding",
          "svg-export",
          "png-export",
        ],
      },
    ],
  },
  {
    id: "source-diagram",
    label: "Local source diagram",
    category: "Relationships",
    description:
      "Local D2, Graphviz or strict Mermaid rendering; original source remains canonical.",
    modelType: "diagram",
    version: 1,
    environment: "image",
    records: [],
    source: { kind: () => "compiled", inputs: (content) => [content.language, content.source] },
    adapters: [
      { adapter: "source-diagram", capabilities: ["source-edit", "svg-export", "png-export"] },
    ],
  },
] as const satisfies readonly VisualFamilyIdentity[];

export type VisualRendererId = (typeof identities)[number]["id"];
/** Every browser adapter a family names; the registry must implement exactly these. */
export type VisualAdapterId = (typeof identities)[number]["adapters"][number]["adapter"];

/** Literal identities make the browser adapter registry exhaustive. */
export const VISUAL_FAMILY_IDENTITIES: readonly (Omit<VisualFamilyIdentity, "id" | "adapters"> & {
  readonly id: VisualRendererId;
  readonly adapters: readonly (Omit<VisualFamilyAdapter, "adapter"> & {
    readonly adapter: VisualAdapterId;
  })[];
})[] = Object.freeze(identities);

/** The one lookup by renderer id; undefined for a renderer this build does not know. */
export function visualFamilyIdentity(
  id: string,
): (typeof VISUAL_FAMILY_IDENTITIES)[number] | undefined;
export function visualFamilyIdentity(
  id: string,
  registry: VisualFamilyResolver | undefined,
): VisualFamilyIdentity | undefined;
export function visualFamilyIdentity(
  id: string,
  registry?: VisualFamilyResolver,
): VisualFamilyIdentity | undefined {
  return registry ? registry.family(id) : VISUAL_FAMILY_IDENTITIES.find((entry) => entry.id === id);
}

/** What a target calls an item: the family's own naming, else its label, note title or id. */
export function visualItemLabel(
  family: VisualFamilyIdentity | undefined,
  collection: string,
  item: Item,
  content: Content,
): string {
  const own = family?.labels?.[collection];
  if (own) return own(item, content);
  if (typeof item.label === "string") return item.label;
  return visualRecord(item.note) && typeof item.note.title === "string"
    ? item.note.title
    : String(item.id);
}
