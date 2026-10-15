import { assertVisualJson, visualRecord } from "./model.ts";

export interface ChartEncodingNote {
  code:
    | "nominal-path"
    | "truncated-baseline"
    | "log-magnitude"
    | "independent-scales"
    | "missing-field"
    | "empty-data";
  path: string[];
  message: string;
}
export interface ChartEncodingGuidance {
  notes: ChartEncodingNote[];
  truncated: boolean;
}

/**
 * Bounded advisory reading of common Vega-Lite patterns, not a compiler or a proof of data quality.
 * Never rewrites rows/specifications, rejects a deliberate exception, or resolves a source.
 */
export function chartEncodingGuidance(content: unknown): ChartEncodingGuidance {
  assertVisualJson(content);
  const notes: ChartEncodingNote[] = [];
  let truncated = false;
  const add = (code: ChartEncodingNote["code"], path: string[], message: string) => {
    if (notes.length < 24) notes.push({ code, path, message });
    else truncated = true;
  };
  if (!visualRecord(content) || !visualRecord(content.spec)) return { notes, truncated };
  const rows = Array.isArray(content.values) ? content.values : undefined;
  if (rows && rows.length === 0)
    add(
      "empty-data",
      ["values"],
      "There are no inline rows. An empty chart does not represent a zero measurement.",
    );
  const visit = (
    spec: Record<string, unknown>,
    path: string[],
    inherited: Record<string, unknown> = {},
    transformed = false,
  ) => {
    const encoding = { ...inherited, ...(visualRecord(spec.encoding) ? spec.encoding : {}) };
    const derived = transformed || Array.isArray(spec.transform);
    const mark =
      typeof spec.mark === "string"
        ? spec.mark
        : visualRecord(spec.mark)
          ? spec.mark.type
          : undefined;
    const x = visualRecord(encoding.x) ? encoding.x : undefined,
      y = visualRecord(encoding.y) ? encoding.y : undefined;
    const orient = visualRecord(spec.mark) ? spec.mark.orient : undefined;
    const domain =
      orient === "horizontal"
        ? y
        : orient === "vertical"
          ? x
          : x?.type === "quantitative" && y?.type !== "quantitative"
            ? y
            : x;
    if (
      ["line", "area", "trail"].includes(mark as string) &&
      domain?.type === "nominal" &&
      !Object.hasOwn(encoding, "order") &&
      !Array.isArray(domain.sort)
    )
      add(
        "nominal-path",
        [...path, "encoding"],
        "Connected marks imply an ordered path. For unordered categories prefer bars or points; for an intentional path declare its ordering and explain it.",
      );
    if (mark === "bar" || mark === "area")
      for (const [channel, definition] of (orient === "horizontal" ||
      (x?.type === "quantitative" && y?.type !== "quantitative")
        ? [["x", x]]
        : [["y", y]]) as Array<[string, Record<string, unknown> | undefined]>) {
        if (
          !definition ||
          definition.type !== "quantitative" ||
          definition.bin ||
          Object.hasOwn(encoding, `${channel}2`)
        )
          continue;
        const scale = visualRecord(definition.scale) ? definition.scale : undefined;
        const range = scale?.domain;
        const excludesZero =
          Array.isArray(range) &&
          range.length === 2 &&
          range.every((v) => typeof v === "number") &&
          ((Number(range[0]) > 0 && Number(range[1]) > 0) ||
            (Number(range[0]) < 0 && Number(range[1]) < 0));
        if (scale?.zero === false || excludesZero)
          add(
            "truncated-baseline",
            [...path, "encoding", channel, "scale"],
            "Bar length or filled area can imply magnitude from a baseline. A zero-excluding scale needs an explicit explanation; ranged intervals are treated separately.",
          );
        if (scale?.type === "log")
          add(
            "log-magnitude",
            [...path, "encoding", channel, "scale"],
            "A logarithmic scale cannot include zero. Explain the transformation or use a position-based mark instead of implying proportional length or area.",
          );
      }
    const resolve = visualRecord(spec.resolve) ? spec.resolve : undefined;
    const scales = visualRecord(resolve?.scale) ? resolve.scale : undefined;
    if (
      Array.isArray(spec.layer) &&
      spec.layer.length > 1 &&
      (scales?.x === "independent" || scales?.y === "independent")
    )
      add(
        "independent-scales",
        [...path, "resolve", "scale"],
        "Layered independent axes can visually imply a relationship determined by their ranges. Label units and scales explicitly, or compare separate panels.",
      );
    // Do not mistake transform outputs, aggregate counts or repeat references for absent raw fields.
    if (mark && rows?.length && !derived) {
      const fields = new Set<string>();
      for (const channel of ["x", "y", "color", "size", "shape"]) {
        const definition = visualRecord(encoding[channel]) ? encoding[channel] : undefined;
        if (
          typeof definition?.field !== "string" ||
          definition.aggregate === "count" ||
          definition.field.includes(".") ||
          definition.field.includes("[") ||
          fields.has(definition.field)
        )
          continue;
        fields.add(definition.field);
        if (
          !rows.some((row) => visualRecord(row) && Object.hasOwn(row, definition.field as string))
        )
          add(
            "missing-field",
            [...path, "encoding", channel, "field"],
            "An encoded field is absent from every inline row. Check spelling, missing values or a required host transformation.",
          );
      }
    }
    for (const key of ["layer", "concat", "hconcat", "vconcat"]) {
      const children = spec[key];
      if (Array.isArray(children))
        children.forEach((child, i) => {
          if (visualRecord(child)) visit(child, [...path, key, String(i)], encoding, derived);
        });
    }
    if (visualRecord(spec.spec)) visit(spec.spec, [...path, "spec"], encoding, derived);
  };
  visit(content.spec, ["spec"]);
  return { notes, truncated };
}

/** Deliberately small display menu: never describes unrelated categories as a continuous trend. */
export function chartMarkChoices(
  domain: "nominal" | "ordinal" | "quantitative" | "temporal",
): readonly string[] {
  return domain === "nominal" ? ["bar", "point"] : ["line", "area", "bar", "point"];
}
