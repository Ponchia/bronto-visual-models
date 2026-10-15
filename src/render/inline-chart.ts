import { validateVisualContent } from "../catalog.ts";
import { chartFill, type ChartFill } from "../families/vega-lite.ts";
import { assertVisualJson, VisualModelError, visualRecord } from "../model.ts";

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

/** Every browser resource path is denied, even if future compiler output adds a loader call. */
export function inlineChartLoader() {
  const deny = async (): Promise<never> => {
    throw new VisualModelError("forbidden", "External chart resources are disabled");
  };
  return { load: deny, sanitize: deny, http: deny, file: deny };
}
