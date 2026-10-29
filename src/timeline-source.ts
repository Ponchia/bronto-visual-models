import type { VisualFamilyResolver } from "./family-resolver.ts";
import type { VisualModel } from "./model.ts";
import { sourceSnapshotKey, type ResolvedSourceRows } from "./source-snapshot.ts";

export type ResolvedTimelineRows = ResolvedSourceRows;

/** Dataset timeline source identity, not a permission or a row read. */
export function timelineSourceKey(
  model: Pick<VisualModel, "id" | "generation" | "renderer" | "content">,
  registry?: VisualFamilyResolver,
): string | undefined {
  return model.renderer === "timeline" ? sourceSnapshotKey(model, registry) : undefined;
}

const field = { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z][A-Za-z0-9_]*$" };
export const TIMELINE_SOURCE_FIELDS = {
  datasource: { type: "string", enum: ["dataset"] },
  params: {
    type: "object",
    required: ["dataset"],
    additionalProperties: false,
    properties: {
      dataset: { type: "string", minLength: 1, maxLength: 200 },
      revision: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      since: { type: "string", maxLength: 40 },
      until: { type: "string", maxLength: 40 },
    },
  },
  fields: {
    type: "object",
    required: ["label", "start"],
    additionalProperties: false,
    properties: { label: field, start: field, end: field, lane: field, entity: field },
  },
} as const;

export interface TimelineFields {
  label: string;
  start: string;
  end?: string;
  lane?: string;
  entity?: string;
}

/** An ISO timestamp with an explicit offset, in epoch milliseconds; NaN for anything else. */
export function offsetInstant(value: string): number {
  // An unanchored `T.*` can rescan a hostile run of T characters quadratically.
  // Separate the linear separator scan from a fixed-width suffix check.
  if (typeof value !== "string" || !/[Tt]/.test(value)) return Number.NaN;
  const suffix = value.slice(-6);
  const zoned = /[Zz]$/.test(suffix) || /^[+-]\d{2}:\d{2}$/.test(suffix);
  return zoned ? Date.parse(value) : Number.NaN;
}
