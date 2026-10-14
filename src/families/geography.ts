import { GEOGRAPHY_SCHEMA, type GeographicContent } from "../semantic.ts";
import {
  defineVisualFamily,
  SEMANTIC_FIELDS,
  SEMANTIC_SEARCH,
  type VisualIssue,
} from "./family.ts";

const MAX_COORDINATES = 20_000;
const COORDINATES = "Coordinates require longitude ±180 and Web Mercator latitude ±85.051129";

function coordinate(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part)) &&
    Math.abs(Number(value[0])) <= 180 &&
    Math.abs(Number(value[1])) <= 85.051129
  );
}

/** The one problem with a feature's geometry, if any. */
function geometryIssue(geometry: GeographicContent["features"][number]["geometry"]) {
  const points =
    geometry.type === "Point"
      ? [geometry.coordinates]
      : geometry.type === "LineString"
        ? geometry.coordinates
        : (geometry.coordinates as unknown[])?.flat();
  const minimum = geometry.type === "Point" ? 1 : geometry.type === "LineString" ? 2 : 4;
  if (!Array.isArray(points) || points.length < minimum)
    return { count: 0, message: "Geographic geometry has too few coordinates" };
  if (!points.every(coordinate)) return { count: points.length, message: COORDINATES };
  if (
    geometry.type === "Polygon" &&
    (geometry.coordinates as unknown[][]).some(
      (ring) =>
        !Array.isArray(ring) ||
        ring.length < 4 ||
        JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1)),
    )
  )
    return {
      count: points.length,
      message: "Polygon rings must be explicitly closed and contain at least four coordinates",
    };
  return { count: points.length };
}

function geographyIssues(content: Record<string, unknown>): VisualIssue[] {
  const map = content as unknown as GeographicContent;
  const issues: VisualIssue[] = [];
  if (map.center && !coordinate(map.center))
    issues.push({ path: ["center"], message: COORDINATES });
  let total = 0;
  for (const feature of map.features) {
    const { count, message } = geometryIssue(feature.geometry);
    total += count;
    if (message) issues.push({ path: ["features", feature.id, "geometry"], message });
  }
  if (total > MAX_COORDINATES)
    issues.push({
      path: ["features"],
      message: `Geographic models are limited to ${MAX_COORDINATES} coordinates`,
    });
  return issues;
}

export const geographyFamily = defineVisualFamily("geography", {
  schema: GEOGRAPHY_SCHEMA,
  validate: geographyIssues,
  fields: {
    center: { label: "Centre", section: "Camera" },
    zoom: { label: "Zoom", control: "number", section: "Camera" },
  },
  additions: () => [{ label: "Add point", collection: "features" }],
  collections: {
    features: {
      search: SEMANTIC_SEARCH,
      fields: { ...SEMANTIC_FIELDS, geometry: { label: "Geometry", section: "Shape" } },
      newItem: (_content, { id }) => ({
        id,
        label: "New point",
        geometry: { type: "Point", coordinates: [0, 0] },
      }),
    },
  },
});
