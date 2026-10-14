import type { VisualFamilyResolver } from "./family-resolver.ts";
import { visualRenderer } from "./catalog.ts";
import {
  assertKnownFields,
  assertVisualJson,
  assertVisualKey,
  isVisualIncarnation,
  type VisualModel,
  VisualModelError,
  visualRecord,
} from "./model.ts";
import { RESERVED_OBJECT_KEYS } from "./reserved-keys.ts";
import type { VisualUndoRecord } from "./undo.ts";

/** Validate retained operation inverses before they can name fields to restore. */
export function assertUndoRecord(
  value: unknown,
  model: VisualModel,
  registry?: VisualFamilyResolver,
): asserts value is VisualUndoRecord {
  assertVisualJson(value);
  if (!visualRecord(value)) throw new VisualModelError("invalid", "Undo record must be an object");
  assertKnownFields(value, ["key", "id", "generation", "at", "identityVersion", "changes"]);
  assertVisualKey(value.key);
  if (value.id !== model.id || value.generation !== model.generation)
    throw new VisualModelError("conflict", "Undo record belongs to a different model lifetime");
  if (
    value.identityVersion !== 2 ||
    !Array.isArray(value.changes) ||
    value.changes.length > 10000 ||
    typeof value.at !== "string" ||
    !Number.isFinite(Date.parse(value.at))
  )
    throw new VisualModelError("invalid", "Invalid undo record metadata");
  const collections = visualRenderer(model.renderer, registry).records;
  for (const change of value.changes) {
    if (!visualRecord(change))
      throw new VisualModelError("invalid", "Undo changes must be objects");
    assertKnownFields(change, [
      "field",
      "collection",
      "id",
      "index",
      "order",
      "identity",
      "incarnation",
      "before",
      "after",
    ]);
    const field = change.field;
    if (typeof field !== "string" || RESERVED_OBJECT_KEYS.includes(field))
      throw new VisualModelError("invalid", "Invalid undo field");
    for (const flag of ["identity", "order"])
      if (change[flag] !== undefined && change[flag] !== true)
        throw new VisualModelError("invalid", "Invalid undo flag");
    if (
      change.index !== undefined &&
      (!Number.isSafeInteger(change.index) || Number(change.index) < 0)
    )
      throw new VisualModelError("invalid", "Invalid undo position");
    if (change.incarnation !== undefined && !isVisualIncarnation(change.incarnation))
      throw new VisualModelError("invalid", "Invalid undo lifetime");
    if (
      change.id !== undefined &&
      (typeof change.id !== "string" || RESERVED_OBJECT_KEYS.includes(change.id))
    )
      throw new VisualModelError("invalid", "Invalid undo item ID");
    if (change.collection === undefined) {
      if (!["title", "description", "status"].includes(field) || change.identity || change.order)
        throw new VisualModelError("invalid", "Undo cannot rewrite model identity or metadata");
    } else if (change.collection === "content") {
      if (!field || change.identity || change.order)
        throw new VisualModelError("invalid", "Invalid content inverse");
    } else if (typeof change.collection !== "string" || !collections.includes(change.collection)) {
      throw new VisualModelError("invalid", "Undo names an unknown collection");
    } else if (change.order && (field !== "" || change.identity)) {
      throw new VisualModelError("invalid", "Invalid collection order inverse");
    }
    for (const side of ["before", "after"]) {
      const entry = change[side];
      if (!visualRecord(entry) || typeof entry.present !== "boolean")
        throw new VisualModelError("invalid", "Invalid inverse value");
      assertKnownFields(entry, ["present", "value"]);
      if (entry.present !== Object.hasOwn(entry, "value"))
        throw new VisualModelError("invalid", "Inverse value presence disagrees with its value");
      if (
        change.order &&
        (!entry.present ||
          !Array.isArray(entry.value) ||
          entry.value.some(
            (id: unknown) => typeof id !== "string" || RESERVED_OBJECT_KEYS.includes(id),
          ) ||
          new Set(entry.value).size !== entry.value.length)
      )
        throw new VisualModelError("invalid", "Invalid inverse ordering");
    }
  }
}
