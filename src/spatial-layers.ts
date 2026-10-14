import { VISUAL_RECORD_ID_SCHEMA as id, VisualModelError } from "./model.ts";
import { offsetInstant, TIMELINE_SOURCE_FIELDS } from "./timeline-source.ts";

const field = { type: "string", minLength: 1, maxLength: 64 };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const color = { type: "string", pattern: "^#[0-9a-fA-F]{6}$" };
export const SPATIAL_LAYER_SCHEMA = object(
  {
    coordinateSystem: { type: "string", enum: ["cartesian", "lnglat"] },
    unit: { type: "string", enum: ["data", "m", "cm", "mm"] },
    rows: { type: "array", maxItems: 5000, items: { type: "object", maxProperties: 40 } },
    datasource: TIMELINE_SOURCE_FIELDS.datasource,
    params: TIMELINE_SOURCE_FIELDS.params,
    layers: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: object(
        {
          id,
          label: { type: "string", minLength: 1, maxLength: 200 },
          type: { type: "string", enum: ["points", "paths", "arcs", "columns", "polygons"] },
          x: field,
          y: field,
          z: field,
          targetX: field,
          targetY: field,
          targetZ: field,
          path: field,
          height: field,
          labelField: field,
          entityField: field,
          color,
          colorField: field,
          colorBy: field,
          palette: { type: "array", minItems: 2, maxItems: 32, items: color },
          radius: { type: "number", exclusiveMinimum: 0, maximum: 100000 },
          width: { type: "number", minimum: 1, maximum: 12 },
          visible: { type: "boolean" },
          stack: object(
            {
              category: field,
              series: field,
              value: field,
              scale: { type: "number", exclusiveMinimum: 0, maximum: 1000 },
              spacing: { type: "number", exclusiveMinimum: 0, maximum: 100000 },
            },
            ["category", "series", "value", "scale", "spacing"],
          ),
        },
        ["id", "label", "type"],
      ),
    },
  },
  ["coordinateSystem", "unit", "rows", "layers"],
);

export interface SpatialLayer {
  id: string;
  label: string;
  type: "points" | "paths" | "arcs" | "columns" | "polygons";
  x?: string;
  y?: string;
  z?: string;
  targetX?: string;
  targetY?: string;
  targetZ?: string;
  path?: string;
  height?: string;
  labelField?: string;
  entityField?: string;
  color?: string;
  colorField?: string;
  colorBy?: string;
  palette?: string[];
  radius?: number;
  width?: number;
  visible?: boolean;
  stack?: { category: string; series: string; value: string; scale: number; spacing: number };
}
export interface SpatialLayersContent extends Record<string, unknown> {
  coordinateSystem: "cartesian" | "lnglat";
  unit: "data" | "m" | "cm" | "mm";
  rows: Record<string, unknown>[];
  layers: SpatialLayer[];
  datasource?: "dataset";
  params?: { dataset: string; revision?: number; since?: string; until?: string };
}
export interface SpatialDatum {
  id: string;
  label: string;
  entity?: string;
  position: [number, number, number];
  target?: [number, number, number];
  path?: [number, number, number][];
  height: number;
  color: [number, number, number, number];
  source: Record<string, unknown>;
}
const fail = (message: string): never => {
  throw new VisualModelError("invalid", message);
};
function number(
  row: Record<string, unknown>,
  field: string | undefined,
  fallback?: number,
): number {
  const value = field ? row[field] : fallback;
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e9
    ? value
    : fail(`Layer column ${field ?? "(missing)"} requires finite numeric values.`);
}
function text(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  return typeof value === "string" && value.length > 0 && value.length <= 240
    ? value
    : fail(`Layer column ${field} requires nonempty labels of at most 240 characters.`);
}
function rgba(value: unknown): [number, number, number, number] {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value))
    fail("Layer colors must be six-digit hexadecimal colors.");
  const hex = value as string;
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    210,
  ];
}
function coordinate(position: number[], system: string): void {
  if (
    (position.length !== 2 && position.length !== 3) ||
    position.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e9)
  )
    fail("Layer coordinates must be bounded numeric 2D or 3D positions.");
  if (
    system === "lnglat" &&
    (Math.abs(position[0] ?? 0) > 180 || Math.abs(position[1] ?? 0) > 85.051129)
  )
    fail("Geographic positions require longitude and Web Mercator latitude, in degrees.");
}
/** Field mappings are data, never executable accessors, URLs or expression strings. */
export function resolveSpatialLayers(
  content: SpatialLayersContent,
  rows: readonly Record<string, unknown>[],
) {
  if (rows.length > 5000)
    fail("Spatial layers support at most 5000 source rows; narrow the dataset window.");
  const seen = new Set<string>();
  for (const row of rows) {
    const id = content.datasource ? row.rowId : row.id;
    if (typeof id !== "string" || !id || seen.has(id))
      fail("Spatial rows require unique stable IDs (dataset rowId or inline id).");
    seen.add(id as string);
  }
  let coordinates = 0;
  const result = content.layers.map((layer) => {
    const stacked = layer.stack;
    const categories = stacked
      ? [...new Set(rows.map((row) => text(row, stacked.category)))].sort()
      : [];
    const categoryIndex = new Map(categories.map((category, i) => [category, i]));
    const totals = new Map<string, number>();
    const seenStack = new Set<string>();
    const palette = layer.palette ?? [
      "#cde2fb",
      "#9ec5f4",
      "#6da7ec",
      "#3987e5",
      "#256abf",
      "#184f95",
      "#0d366b",
    ];
    const colorValues = layer.colorBy
      ? [...new Set(rows.map((row) => text(row, layer.colorBy ?? "")))].sort()
      : [];
    const colorIndex = new Map(colorValues.map((value, index) => [value, index]));
    const order = stacked
      ? [...rows].sort(
          (a, b) =>
            text(a, stacked.category).localeCompare(text(b, stacked.category)) ||
            text(a, stacked.series).localeCompare(text(b, stacked.series)) ||
            String(a.rowId ?? a.id).localeCompare(String(b.rowId ?? b.id)),
        )
      : rows;
    const data = order.map((row): SpatialDatum => {
      const id = String(content.datasource ? row.rowId : row.id);
      let position: [number, number, number];
      let height = layer.height ? number(row, layer.height) : 0;
      let label = layer.labelField ? text(row, layer.labelField) : String(row.label ?? id);
      if (stacked) {
        if (content.coordinateSystem !== "cartesian" || layer.type !== "columns")
          fail("Stacked columns require Cartesian coordinates.");
        const category = text(row, stacked.category),
          series = text(row, stacked.series);
        const key = JSON.stringify([category, series]);
        if (seenStack.has(key))
          fail(
            "Each stacked category/cohort must identify one source row. Narrow the dataset observation window to one snapshot instead of summing different dates.",
          );
        seenStack.add(key);
        height = number(row, stacked.value) * stacked.scale;
        if (height < 0) fail("Stacked column measurements must be nonnegative.");
        position = [
          (categoryIndex.get(category) ?? 0) * stacked.spacing,
          0,
          totals.get(category) ?? 0,
        ];
        totals.set(category, position[2] + height);
        label = `${category} · ${series} · ${row[stacked.value]}`;
      } else position = [number(row, layer.x, 0), number(row, layer.y, 0), number(row, layer.z, 0)];
      coordinate(position, content.coordinateSystem);
      let path: [number, number, number][] | undefined;
      if (layer.type === "paths" || layer.type === "polygons") {
        const raw = layer.path ? row[layer.path] : undefined;
        if (!Array.isArray(raw) || raw.length < (layer.type === "polygons" ? 4 : 2))
          fail("A path or polygon must contain a valid coordinate array.");
        path = (raw as unknown[]).map((point) => {
          if (!Array.isArray(point)) fail("A path point must be an array.");
          const p = point as number[];
          coordinate(p, content.coordinateSystem);
          if (++coordinates > 100000) fail("Layer paths exceed the 100000-coordinate budget.");
          return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
        });
        if (layer.type === "polygons" && JSON.stringify(path[0]) !== JSON.stringify(path.at(-1)))
          fail("A polygon ring must be explicitly closed.");
        if (path[0]) position = [path[0][0] ?? 0, path[0][1] ?? 0, path[0][2] ?? 0];
      }
      const target: [number, number, number] | undefined =
        layer.type === "arcs"
          ? [number(row, layer.targetX), number(row, layer.targetY), number(row, layer.targetZ, 0)]
          : undefined;
      if (target) coordinate(target, content.coordinateSystem);
      if (
        height < 0 ||
        !Number.isFinite(height) ||
        height > 1e9 ||
        position.some((v) => Math.abs(v) > 1e9)
      )
        fail("Layer heights and stacked bounds must be finite nonnegative values within budget.");
      return {
        id,
        label,
        position,
        target,
        path,
        height,
        color: rgba(
          layer.colorField
            ? row[layer.colorField]
            : layer.colorBy
              ? palette[(colorIndex.get(String(row[layer.colorBy])) ?? 0) % palette.length]
              : (layer.color ?? "#4e91c2"),
        ),
        ...(layer.entityField && typeof row[layer.entityField] === "string"
          ? { entity: String(row[layer.entityField]) }
          : {}),
        source: row,
      };
    });
    return { layer, data, categories };
  });
  return result;
}
export function validateSpatialLayers(content: Record<string, unknown>): void {
  const model = content as SpatialLayersContent;
  if (model.coordinateSystem === "lnglat" && model.unit !== "m")
    fail("Geographic height/radius units are metres; longitude and latitude remain degrees.");
  if (model.datasource) {
    if (!model.params || model.rows.length)
      fail("Dataset layers require a binding and empty inline rows; source facts are read-only.");
  } else if (model.params) fail("Layer source parameters require a datasource.");
  if (model.params) {
    const { since, until } = model.params;
    for (const value of [since, until])
      if (value !== undefined && !Number.isFinite(offsetInstant(value)))
        fail("Layer observation bounds require ISO timestamps with an explicit timezone.");
    if (since && until && offsetInstant(until) <= offsetInstant(since))
      fail("Layer observation bounds must end after they start.");
  }
  for (const layer of model.layers) {
    if (layer.colorBy && layer.colorField)
      fail("Choose category colors or explicit hexadecimal row colors, not both.");
    if (layer.stack && (layer.x || layer.y || layer.z || layer.height || layer.path))
      fail("Choose stacked field mapping or positioned geometry, not both.");
    if (!layer.stack && !["paths", "polygons"].includes(layer.type) && (!layer.x || !layer.y))
      fail("Positioned layers require x and y columns.");
    if (["paths", "polygons"].includes(layer.type) && !layer.path)
      fail("Path and polygon layers require a coordinate column.");
    if (layer.type === "arcs" && (!layer.targetX || !layer.targetY))
      fail("Arc layers require target coordinates.");
  }
  if (!model.datasource) resolveSpatialLayers(model, model.rows);
}
