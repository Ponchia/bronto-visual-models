import { validateVisualContent } from "../catalog.ts";
import { chartFill, type ChartFill } from "../families/vega-lite.ts";
import {
  assertVisualJson,
  canonicalVisualJson,
  VisualModelError,
  visualRecord,
  type VisualModel,
} from "../model.ts";
import { chartSourceKey, type ResolvedChartRows } from "../chart-source.ts";
import type { VisualFamilyResolver } from "../family-resolver.ts";
import { sha256Hex } from "../hash.ts";
import { assertVisualModel } from "../operations.ts";
import { validSourceRevision } from "../source-snapshot.ts";

export interface InlineChartInput {
  spec: Record<string, unknown>;
  values: Record<string, unknown>[];
  fill: ChartFill;
}

/** Local direct-manipulation only. Arbitrary event streams, DOM bindings and
 * executable parameter expressions remain outside the reference viewer. */
const SELECTION_RESERVED_NAMES = new Set([
  "datum",
  "event",
  "item",
  "parent",
  "constructor",
  "prototype",
  "__proto__",
  "undefined",
  "null",
  "true",
  "false",
  "bvm_rows",
]);
const POINT_ENCODINGS = new Set(["x", "y", "color", "fill", "stroke", "size", "shape", "opacity"]);
const INTERVAL_ENCODINGS = new Set(["x", "y"]);

function prepareLocalSelections(input: unknown): void {
  if (!Array.isArray(input) || input.length < 1 || input.length > 4)
    throw new VisualModelError(
      "unavailable",
      "Chart selection parameters require 1–4 local selections",
    );
  const names = new Set<string>();
  for (const param of input) {
    if (!visualRecord(param)) throw new VisualModelError("unavailable", "Invalid chart selection");
    if (
      typeof param.name !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(param.name) ||
      param.name.startsWith("bvm_") ||
      SELECTION_RESERVED_NAMES.has(param.name) ||
      names.has(param.name)
    )
      throw new VisualModelError("unavailable", "Chart selections require unique, safe names");
    names.add(param.name);
    if (Object.keys(param).some((key) => !["name", "select"].includes(key)))
      throw new VisualModelError(
        "unavailable",
        "Only local chart selection parameters are supported; bindings and initial values are unavailable",
      );
    const select = param.select;
    const kind =
      typeof select === "string" ? select : visualRecord(select) ? select.type : undefined;
    if (kind !== "point" && kind !== "interval")
      throw new VisualModelError(
        "unavailable",
        "Only point and interval chart selections are available",
      );
    if (typeof select === "string") continue;
    if (!visualRecord(select)) throw new VisualModelError("unavailable", "Invalid chart selection");
    const choices =
      kind === "point"
        ? ["type", "fields", "encodings", "resolve", "clear", "toggle", "nearest"]
        : ["type", "fields", "encodings", "resolve", "clear", "translate", "zoom"];
    if (Object.keys(select).some((key) => !choices.includes(key)))
      throw new VisualModelError(
        "unavailable",
        "Chart selection event streams, expressions and unspecified controls are unavailable",
      );
    if (
      Object.hasOwn(select, "resolve") &&
      !["global", "union", "intersect"].includes(select.resolve as string)
    )
      throw new VisualModelError("unavailable", "Invalid chart selection resolution");
    if (Object.hasOwn(select, "clear") && select.clear !== false)
      throw new VisualModelError("unavailable", "Custom chart selection events are unavailable");
    for (const field of ["toggle", "nearest", "translate", "zoom"]) {
      if (Object.hasOwn(select, field) && typeof select[field] !== "boolean")
        throw new VisualModelError("unavailable", "Chart selection options must be boolean");
    }
    for (const key of ["fields", "encodings"]) {
      const values = select[key];
      if (values === undefined) continue;
      if (!Array.isArray(values) || values.length < 1 || values.length > 4)
        throw new VisualModelError("unavailable", "Chart selection projections require 1–4 fields");
      if (new Set(values).size !== values.length)
        throw new VisualModelError("unavailable", "Chart selection fields must be unique");
      if (key === "fields") {
        if (
          !values.every(
            (value) =>
              typeof value === "string" &&
              value.length >= 1 &&
              value.length <= 100 &&
              !/[\u0000-\u001f]/.test(value),
          )
        )
          throw new VisualModelError("unavailable", "Invalid chart selection field");
      } else {
        const allowed = kind === "point" ? POINT_ENCODINGS : INTERVAL_ENCODINGS;
        if (!values.every((value) => typeof value === "string" && allowed.has(value)))
          throw new VisualModelError("unavailable", "Unsupported chart selection encoding");
      }
    }
  }
}

/**
 * The standalone view's explicit resource policy, not the stored family's grammar.
 * Refuse unsupported content instead of silently ignoring another source or annotations.
 * Compilation and rendering remain upstream responsibilities; this is not a CPU sandbox.
 */
export function prepareInlineChart(content: unknown): InlineChartInput {
  assertVisualJson(content);
  validateVisualContent("vega-lite", "chart", content);
  if (!visualRecord(content)) throw new VisualModelError("invalid", "Chart content is required");
  if (["datasource", "connection", "params"].some((key) => Object.hasOwn(content, key)))
    throw new VisualModelError(
      "unavailable",
      "Resolve connected chart data in the host and pass explicit inline values; no data is fetched",
    );
  if (Array.isArray(content.annotations) && content.annotations.length)
    throw new VisualModelError(
      "unavailable",
      "This reference chart view does not draw authored annotations; use a host adapter",
    );
  if (!visualRecord(content.spec) || !Array.isArray(content.values))
    throw new VisualModelError(
      "invalid",
      "An inline chart needs spec and values (an empty array is valid)",
    );
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!visualRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "params" && path === "spec") {
        prepareLocalSelections(child);
        continue;
      }
      if (["data", "datasets", "url", "href", "bind", "params", "selection"].includes(key))
        throw new VisualModelError(
          "unavailable",
          `${path}.${key} is outside the inline chart view: use content.values and host-owned interactions`,
        );
      if (key === "mark" && (child === "image" || (visualRecord(child) && child.type === "image")))
        throw new VisualModelError("unavailable", `${path}.mark: image resources are not loaded`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(content.spec, "spec");
  const spec = structuredClone(content.spec);
  return {
    spec,
    values: structuredClone(content.values) as Record<string, unknown>[],
    fill: chartFill(spec),
  };
}

export interface PreparedHostChart {
  readonly input: InlineChartInput;
  /** Current source revision and exact accepted row identity for draw acknowledgements. */
  readonly source: Readonly<{ sourceKey: string; revision: string; digest: string }>;
}

/**
 * Reuse the inline viewer's deny-all Vega policy, but accept rows that an
 * authorized host has already materialized from the model's exact source.
 * Never perform access checks or reads here, and never persist resolved rows.
 */
export function prepareHostChart(
  model: VisualModel,
  supplied: ResolvedChartRows,
  registry?: VisualFamilyResolver,
): PreparedHostChart {
  assertVisualModel(model, registry);
  if (model.renderer !== "vega-lite")
    throw new VisualModelError("unavailable", "Only chart models accept chart rows");
  const expected = chartSourceKey(model, registry);
  if (!expected) throw new VisualModelError("unavailable", "The chart has no bound row source");
  if (
    !supplied ||
    typeof supplied.sourceKey !== "string" ||
    supplied.sourceKey !== expected ||
    !validSourceRevision(supplied.revision)
  )
    throw new VisualModelError("unavailable", "Host chart rows do not match this source snapshot");
  if (
    Object.hasOwn(model.content, "values") ||
    (Object.hasOwn(model.content, "connection") && Object.hasOwn(model.content, "datasource"))
  )
    throw new VisualModelError(
      "unavailable",
      "Bound charts cannot mix inline or competing sources",
    );
  // Do not include the stored datasource/connection/params when passing this
  // temporary input through the reference viewer's schema and resource policy.
  // A failing row is not echoed to a host error callback.
  let input: InlineChartInput;
  try {
    input = prepareInlineChart({
      spec: model.content.spec,
      values: supplied.rows,
      ...(Object.hasOwn(model.content, "annotations")
        ? { annotations: model.content.annotations }
        : {}),
    });
  } catch {
    throw new VisualModelError(
      "unavailable",
      "Host chart rows or grammar cannot be shown by the reference renderer",
    );
  }
  return {
    input,
    source: Object.freeze({
      sourceKey: expected,
      revision: supplied.revision,
      digest: sha256Hex(canonicalVisualJson(input.values)),
    }),
  };
}

/** Every browser resource path is denied, even if future compiler output adds a loader call. */
export function inlineChartLoader() {
  const deny = async (): Promise<never> => {
    throw new VisualModelError("forbidden", "External chart resources are disabled");
  };
  return { load: deny, sanitize: deny, http: deny, file: deny };
}
