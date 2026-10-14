import type { VisualRendererId } from "./families/identity.ts";
import { visualFamily } from "./families/index.ts";

/** A content field a family stopped declaring, and why (decision 0130). */
export interface VisualRetirement {
  readonly family: VisualRendererId;
  readonly field: string;
  /** The last live write that carried the field, UTC. */
  readonly since: string;
  /**
   * The offline-state archive format current at retirement. The family carries
   * the field while that format restores; it stops when the format leaves support.
   */
  readonly archive: number;
  readonly reason: string;
}

/**
 * Every retirement ever made, oldest first. Append-only history: a family's
 * `retired` names the ones it still strips, and a test holds the two together.
 */
export const VISUAL_RETIREMENTS: readonly VisualRetirement[] = Object.freeze([
  {
    family: "vega-lite",
    field: "snapshot",
    since: "2026-09-30T21:55:55Z",
    archive: 5,
    reason: "D8, 30 Sep 2026: the retired chart node's capture evidence; nothing reads it",
  },
]);

/** The retirement a family still carries for this field, if it carries one. */
export function visualRetirement(renderer: string, field: string): VisualRetirement | undefined {
  if (!visualFamily(renderer)?.retired?.includes(field)) return undefined;
  return VISUAL_RETIREMENTS.find((entry) => entry.family === renderer && entry.field === field);
}

/**
 * Stored content as readers see it: without the fields its family retired.
 * `stripped` names each one left behind as `family.field`, for the census.
 */
export function withoutRetiredFields(
  renderer: string,
  content: Record<string, unknown>,
): { content: Record<string, unknown>; stripped: readonly string[] } {
  const present = (visualFamily(renderer)?.retired ?? []).filter((field) =>
    Object.hasOwn(content, field),
  );
  if (!present.length) return { content, stripped: [] };
  const kept = { ...content };
  for (const field of present) delete kept[field];
  return { content: kept, stripped: present.map((field) => `${renderer}.${field}`) };
}

/** Counts of stripped fields by `family.field`, the shape every census reports. */
export function tallyRetiredFields(
  tally: Record<string, number>,
  stripped: readonly string[],
): Record<string, number> {
  for (const field of stripped) tally[field] = (tally[field] ?? 0) + 1;
  return tally;
}
