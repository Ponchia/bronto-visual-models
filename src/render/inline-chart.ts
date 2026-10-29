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
