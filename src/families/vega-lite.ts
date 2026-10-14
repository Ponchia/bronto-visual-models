const MAX_DATASOURCE_PARAM_CHARS = 2000;
export interface VisualConnectionRef {
  instanceId: string;
  connectionId: string;
}
import { visualRecord } from "../model.ts";
import {
  datasetSearchText,
  defineVisualFamily,
  type VisualFieldDescriptors,
  type VisualIssue,
} from "./family.ts";

const MAX_CHART_ROWS = 2_000;

/** Vega-Lite sizes these from their children, never from a container. */
const COMPOSITIONS = ["concat", "hconcat", "vconcat", "facet", "repeat"];
/** Encoding channels that make a single view a facet. */
const FACET_CHANNELS = ["row", "column", "facet"];

/**
 * How a chart takes its view's space. `fit`: a single or layered view is drawn
 * at its body's size, whatever size its spec stores. `composed`: concat, facet
 * and repeat views still draw at the sizes their children name.
 */
export type ChartFill = "fit" | "composed";

export function chartFill(spec: Record<string, unknown>): ChartFill {
  const { encoding } = spec;
  const composed =
    COMPOSITIONS.some((key) => Object.hasOwn(spec, key)) ||
    (visualRecord(encoding) && FACET_CHANNELS.some((channel) => Object.hasOwn(encoding, channel)));
  return composed ? "composed" : "fit";
}

const STORED_SIZE =
  "The view decides this chart's size, so a stored width or height is ignored; remove it";

/** Each width and height a fitted chart stores, down through its layers. */
function storedSizes(spec: Record<string, unknown>, path: readonly string[]): VisualIssue[] {
  const own = ["width", "height"]
    .filter((key) => Object.hasOwn(spec, key))
    .map((key) => ({ path: [...path, key], message: STORED_SIZE }));
  const layers = Array.isArray(spec.layer) ? spec.layer : [];
  return [
    ...own,
    ...layers.flatMap((child, index) =>
      visualRecord(child) ? storedSizes(child, [...path, "layer", String(index)]) : [],
    ),
  ];
}

/** A mark a chart's author explains, anchored in data space so it survives resize and new rows. */
interface VegaLiteAnnotation {
  id: string;
  type?: "point" | "threshold" | "region";
  x?: number | string;
  y?: number | string;
  x2?: number | string;
  y2?: number | string;
  orientation?: "horizontal" | "vertical";
  match?: Record<string, string | number | boolean>;
  note: { title: string; body?: string };
  tone?: "accent" | "muted" | "success" | "warning" | "danger" | "info";
  side?: "top" | "right" | "bottom" | "left";
  dx?: number;
  dy?: number;
}

/** A chart's content: the grammar, and rows from exactly one place. */
export interface VegaLiteContent {
  spec?: Record<string, unknown>;
  values?: Record<string, unknown>[];
  datasource?: string;
  params?: Record<string, string | number>;
  connection?: VisualConnectionRef;
  annotations?: VegaLiteAnnotation[];
}

// `values` is separate from `spec` rather than living at `spec.data.values`,
// and that separation is load-bearing in three ways. An agent can replace the
// rows without rewriting the spec (`--data '{"values": [...]}'`) or restyle
// without resending the rows. There is exactly one source of rows, so a spec
// and a dataset can never disagree about which is current. And the renderer
// builds `{...spec, data: {values}}` at draw time, so a stored spec that names
// its own `data` cannot take effect — the containment is structural, not a rule
// written in a comment. Nested `data` inside `layer`/`transform` is closed off
// the same way, by handing vega a loader that refuses every fetch.
const VEGA_LITE_SCHEMA = {
  type: "object",
  properties: {
    // Deliberately open: Vega-Lite's grammar is large, versioned upstream,
    // and enumerating it here would mean this schema drifts behind every
    // release and refuses valid charts. The spec is not privileged input —
    // it cannot reach data or the network — so an invalid one is a chart
    // that reports its own compile error, not a security boundary crossed.
    spec: { type: "object" },
    values: {
      type: "array",
      maxItems: MAX_CHART_ROWS,
      items: { type: "object" },
    },
    // Naming a provider makes the server the source of rows (ADR 0010).
    // Hosts can supply an allowlist. Naming a source never authorizes or loads it.
    datasource: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    connection: {
      type: "object",
      properties: {
        instanceId: { type: "string", pattern: "^[a-f0-9-]{36}$" },
        connectionId: { type: "string", pattern: "^[a-f0-9-]{36}$" },
      },
      required: ["instanceId", "connectionId"],
      additionalProperties: false,
    },
    params: {
      type: "object",
      maxProperties: 8,
      additionalProperties: {
        anyOf: [{ type: "string", maxLength: MAX_DATASOURCE_PARAM_CHARS }, { type: "integer" }],
      },
    },
    // Closed where the spec above is open, because this grammar is OURS:
    // the resolver in the web client is the only consumer, so an unknown
    // key is an authoring mistake worth refusing at the gateway rather
    // than a forward-compatibility bet. Anchors are domain values; the
    // browser re-resolves them through the drawn scales on every render.
    annotations: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1, maxLength: 64 },
          type: { type: "string", enum: ["point", "threshold", "region"] },
          x: { anyOf: [{ type: "number" }, { type: "string", maxLength: 256 }] },
          y: { anyOf: [{ type: "number" }, { type: "string", maxLength: 256 }] },
          x2: { anyOf: [{ type: "number" }, { type: "string", maxLength: 256 }] },
          y2: { anyOf: [{ type: "number" }, { type: "string", maxLength: 256 }] },
          orientation: { type: "string", enum: ["horizontal", "vertical"] },
          match: {
            type: "object",
            maxProperties: 4,
            additionalProperties: {
              anyOf: [{ type: "string", maxLength: 256 }, { type: "number" }, { type: "boolean" }],
            },
          },
          note: {
            type: "object",
            properties: {
              title: { type: "string", minLength: 1, maxLength: 120 },
              body: { type: "string", maxLength: 1000 },
            },
            required: ["title"],
            additionalProperties: false,
          },
          tone: {
            type: "string",
            enum: ["accent", "muted", "success", "warning", "danger", "info"],
          },
          side: { type: "string", enum: ["top", "right", "bottom", "left"] },
          dx: { type: "number", minimum: -2000, maximum: 2000 },
          dy: { type: "number", minimum: -2000, maximum: 2000 },
        },
        required: ["id", "note"],
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const anchor = (label: string): VisualFieldDescriptors[string] => ({
  label,
  control: "text",
  section: "Anchor",
});

export function createVegaLiteFamily(
  options: { datasources?: readonly string[]; maxParameterChars?: number } = {},
) {
  return defineVisualFamily("vega-lite", {
    schema: {
      ...VEGA_LITE_SCHEMA,
      properties: {
        ...VEGA_LITE_SCHEMA.properties,
        datasource: {
          ...VEGA_LITE_SCHEMA.properties.datasource,
          ...(options.datasources ? { enum: [...options.datasources] } : {}),
        },
        params: {
          ...VEGA_LITE_SCHEMA.properties.params,
          additionalProperties: {
            anyOf: [
              {
                type: "string",
                maxLength: options.maxParameterChars ?? MAX_DATASOURCE_PARAM_CHARS,
              },
              { type: "integer" },
            ],
          },
        },
      },
    },
    retired: ["snapshot"],
    advise: (content) =>
      visualRecord(content.spec) && chartFill(content.spec) === "fit"
        ? storedSizes(content.spec, ["spec"])
        : [],
    fields: {
      spec: { label: "Chart grammar", hidden: true },
      values: { label: "Rows", hidden: true },
      datasource: { label: "Source", control: "choice", section: "Data" },
      params: { label: "Source parameters", section: "Data" },
      connection: { label: "Connection", section: "Data", hidden: true },
    },
    collections: {
      annotations: {
        search: [],
        fields: {
          "note.title": { label: "Title", control: "text", order: 0 },
          "note.body": { label: "Note", control: "multiline", order: 1 },
          type: { label: "Anchor kind", control: "choice", order: 2 },
          x: anchor("X"),
          y: anchor("Y"),
          x2: anchor("X end"),
          y2: anchor("Y end"),
          match: { label: "Matching row", section: "Anchor" },
          orientation: { label: "Orientation", control: "choice", section: "Anchor" },
          tone: { label: "Tone", control: "tone", section: "Presentation" },
          side: { label: "Note side", control: "choice", section: "Presentation" },
          dx: { label: "Note offset X", control: "number", section: "Presentation" },
          dy: { label: "Note offset Y", control: "number", section: "Presentation" },
        },
      },
    },
    // The chosen source is authored and names no secret, so searching a
    // datasource id (or a dataset's address) answers "which charts read it".
    // Its other parameters stay out: they may carry credentials.
    searchText: (content) => [
      ...(visualRecord(content.spec) ? [content.spec.title, content.spec.description] : []),
      ...(content.datasource === "dataset" ? datasetSearchText(content) : [content.datasource]),
    ],
  });
}
export const vegaLiteFamily = createVegaLiteFamily();
