import type { VisualFamilyResolver } from "./family-resolver.ts";
import { sha256Hex } from "./hash.ts";
import { modelCompatibility } from "./compatibility.ts";
import { visualFamilyIdentity, visualItemLabel } from "./families/identity.ts";
import { canonicalVisualJson, type VisualModel, type VisualTarget, visualRecord } from "./model.ts";

export function visualRowIdentity(row: Record<string, unknown>): string {
  return typeof row.id === "string" && row.id
    ? `id:${row.id}`
    : `row:${sha256Hex(canonicalVisualJson(row))}`;
}
export function modelTargets(model: VisualModel, registry?: VisualFamilyResolver): VisualTarget[] {
  const renderer = visualFamilyIdentity(model.renderer, registry);
  return (renderer?.records ?? []).flatMap((collection) =>
    ((model.content[collection] ?? []) as Array<Record<string, unknown>>).map((item) => ({
      modelId: model.id,
      generation: model.generation,
      revision: model.revision,
      collection,
      elementId: String(item.id),
      ...(model.elementIncarnations?.[collection]?.[String(item.id)]
        ? { incarnation: model.elementIncarnations[collection][String(item.id)] }
        : {}),
      label: visualItemLabel(renderer, collection, item, model.content),
    })),
  );
}
/** What a captured target finds in its model now; every reader derives its view from this. */
export type VisualTargetResolution =
  | {
      state: "attached" | "changed";
      reason?: string;
      /** The record the target names. */
      record: Record<string, unknown>;
      /** The model's own entry for the target now: its current revision, label and lifetime. */
      current: VisualTarget;
    }
  | {
      state: "missing" | "stale" | "unsupported";
      reason: string;
      record?: undefined;
      current?: undefined;
    };
/** Whether a target still names its subject, at its own revision or a later one. */
export function targetResolves(
  resolution: VisualTargetResolution,
): resolution is Extract<VisualTargetResolution, { record: object }> {
  return resolution.state === "attached" || resolution.state === "changed";
}

const recordIndexes = new WeakMap<
  VisualModel,
  { from: unknown[]; registry?: VisualFamilyResolver; index: Map<string, Record<string, unknown>> }
>();
/**
 * A model snapshot's records by `collection:id`, built once however many targets
 * resolve against it, and again only when a collection is replaced on the same
 * object. `built` hears the record count when this call builds it.
 */
function modelRecordIndex(
  model: VisualModel,
  built?: (records: number) => void,
  registry?: VisualFamilyResolver,
): Map<string, Record<string, unknown>> {
  const collections = visualFamilyIdentity(model.renderer, registry)?.records ?? [];
  const from = collections.map((collection) => model.content[collection]);
  const held = recordIndexes.get(model);
  if (held && held.registry === registry && held.from.length === from.length && held.from.every((rows, at) => rows === from[at]))
    return held.index;
  const index = new Map<string, Record<string, unknown>>();
  collections.forEach((collection, at) => {
    for (const item of (from[at] ?? []) as unknown[])
      if (visualRecord(item) && typeof item.id === "string")
        index.set(`${collection}:${item.id}`, item);
  });
  recordIndexes.set(model, { from, registry, index });
  built?.(index.size);
  return index;
}

/**
 * The one resolver. "missing" means nothing is there now; "stale" means
 * something else is: another model, a newer revision, or the same id with a new
 * lifetime. Either way the captured target is retained.
 */
export function resolveModelTarget(
  model: VisualModel,
  target: VisualTarget,
  built?: (records: number) => void,
  registry?: VisualFamilyResolver,
): VisualTargetResolution {
  const renderer = visualFamilyIdentity(model.renderer, registry);
  if (!renderer || !modelCompatibility(model, registry).ok)
    return {
      state: "unsupported",
      reason: "This model needs a compatible reader; the captured target is retained.",
    };
  if (model.id !== target.modelId || model.generation !== target.generation)
    return { state: "stale", reason: "The model identity changed." };
  if (target.revision > model.revision)
    return { state: "stale", reason: "The target belongs to a newer model revision." };
  let record: Record<string, unknown> | undefined;
  if (target.collection === "values") {
    if (model.content.datasource)
      return {
        state: "stale",
        reason:
          "This target belongs to a live source; preserve a snapshot for durable row discussion.",
      };
    const rows = Array.isArray(model.content.values)
      ? model.content.values.filter(
          (row): row is Record<string, unknown> =>
            visualRecord(row) && visualRowIdentity(row) === target.elementId,
        )
      : [];
    [record] = rows;
    if (rows.length !== 1 || !record)
      return { state: "missing", reason: "The selected row no longer resolves uniquely." };
  } else {
    record = modelRecordIndex(model, built, registry).get(`${target.collection}:${target.elementId}`);
    if (!record)
      return {
        state: "missing",
        reason: "The selected element was removed; its captured identity is retained.",
      };
  }
  const collection = target.collection as string;
  const incarnation = model.elementIncarnations?.[collection]?.[target.elementId];
  if (target.incarnation && incarnation !== target.incarnation)
    return {
      state: "stale",
      reason: "The element was replaced; its captured identity is retained.",
    };
  // The model's own entry for this element, as modelTargets lists it.
  const current: VisualTarget = {
    modelId: model.id,
    generation: model.generation,
    revision: model.revision,
    collection,
    elementId: target.elementId,
    ...(incarnation ? { incarnation } : {}),
    label:
      collection === "values"
        ? target.label
        : visualItemLabel(renderer, collection, record, model.content),
  };
  return {
    state: model.revision === target.revision ? "attached" : "changed",
    ...(model.revision !== target.revision
      ? {
          reason: `The model is now at revision ${model.revision}; the original discussion refers to revision ${target.revision}.`,
        }
      : {}),
    record,
    current,
  };
}

