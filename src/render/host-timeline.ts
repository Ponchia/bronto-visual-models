import type { VisualFamilyResolver } from "../family-resolver.ts";
import { timelineFromRows } from "../families/timeline.ts";
import { sha256Hex } from "../hash.ts";
import {
  assertVisualJson,
  canonicalVisualJson,
  VisualModelError,
  type VisualModel,
} from "../model.ts";
import { assertVisualModel } from "../operations.ts";
import type { TimelineContent } from "../semantic.ts";
import { validSourceRevision, type SourceRowTarget } from "../source-snapshot.ts";
import {
  timelineSourceKey,
  type TimelineFields,
  type ResolvedTimelineRows,
} from "../timeline-source.ts";

export interface PreparedHostTimeline {
  readonly content: TimelineContent;
  readonly source: Readonly<{ sourceKey: string; revision: string; digest: string }>;
  /** Row identities are ephemeral source targets, never model-incarnation records. */
  readonly targets: ReadonlyMap<string, SourceRowTarget>;
}

/**
 * A derived, read-only presentation of authorized host rows. No resource reads,
 * persistent edits, element incarnations or source credentials live here.
 */
export function prepareHostTimeline(
  model: VisualModel,
  supplied: ResolvedTimelineRows,
  registry?: VisualFamilyResolver,
): PreparedHostTimeline {
  assertVisualModel(model, registry);
  if (model.renderer !== "timeline")
    throw new VisualModelError("unavailable", "Only timeline models accept timeline rows");
  const expected = timelineSourceKey(model, registry);
  if (!expected) throw new VisualModelError("unavailable", "The timeline has no bound row source");
  if (!supplied || supplied.sourceKey !== expected || !validSourceRevision(supplied.revision))
    throw new VisualModelError(
      "unavailable",
      "Host timeline rows do not match this source snapshot",
    );
  let content: TimelineContent;
  let digest: string;
  try {
    assertVisualJson(supplied.rows);
    if (!Array.isArray(supplied.rows))
      throw new VisualModelError("invalid", "Expected an array of rows");
    content = timelineFromRows(supplied.rows, model.content.fields as TimelineFields);
    digest = sha256Hex(canonicalVisualJson(supplied.rows));
  } catch {
    // Dataset rows/identifiers may contain private details. Never echo the
    // offending values through a public viewer callback or exception.
    throw new VisualModelError(
      "unavailable",
      "Host timeline rows or mappings cannot be displayed by the reference renderer",
    );
  }
  const source = Object.freeze({
    sourceKey: expected,
    revision: supplied.revision,
    digest,
  });
  const targets = new Map<string, SourceRowTarget>();
  for (let index = 0; index < content.events.length; index++) {
    const event = content.events[index]!;
    const row = supplied.rows[index]!;
    targets.set(
      event.id,
      Object.freeze({
        modelId: model.id,
        generation: model.generation,
        sourceKey: source.sourceKey,
        revision: source.revision,
        rowId: String(row.rowId),
        ...(event.entityId ? { entityId: event.entityId } : {}),
      }),
    );
  }
  return { content, source, targets };
}
