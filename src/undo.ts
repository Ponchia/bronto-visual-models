import { RESERVED_OBJECT_KEYS } from "./reserved-keys.ts";
import type { VisualFamilyResolver } from "./family-resolver.ts";
import { visualRenderer } from "./catalog.ts";
import {
  canonicalVisualJson,
  type VisualModel,
  VisualModelError,
  type VisualReceiptChange,
  visualRecord,
} from "./model.ts";

interface Value {
  present: boolean;
  value?: unknown;
}
export interface VisualUndoChange {
  field: string;
  collection?: string;
  id?: string;
  index?: number;
  order?: true;
  identity?: true;
  incarnation?: string;
  before: Value;
  after: Value;
}
export interface VisualUndoRecord {
  key: string;
  id: string;
  generation: string;
  at: string;
  identityVersion?: 2;
  changes: VisualUndoChange[];
}
const valueAt = (object: Record<string, unknown>, key: string): Value =>
  Object.hasOwn(object, key) ? { present: true, value: object[key] } : { present: false };
/** An inverse keeps its own copy; only the values a change records are copied. */
const recorded = (value: Value): Value =>
  value.present ? { present: true, value: structuredClone(value.value) } : value;
/**
 * Equal as canonical JSON, without serialising either side: for JSON content,
 * key order is the only difference the canonical form removes.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => same(item, b[index]))
    );
  if (visualRecord(a) && visualRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
    );
  }
  return canonicalVisualJson(a) === canonicalVisualJson(b);
}

/** Each inverse guards only what the edit changed. Disjoint later edits survive. */
export function visualUndoChanges(
  before: VisualModel,
  after: VisualModel,
  registry?: VisualFamilyResolver,
): VisualUndoChange[] {
  const changes: VisualUndoChange[] = [];
  const compare = (field: string, a: Value, b: Value, rest: Partial<VisualUndoChange> = {}) => {
    if (!same(a, b)) changes.push({ field, before: recorded(a), after: recorded(b), ...rest });
  };
  for (const field of ["title", "description", "status"] as const)
    compare(field, { present: true, value: before[field] }, { present: true, value: after[field] });
  const collections = visualRenderer(before.renderer, registry).records;
  for (const collection of collections) {
    const old = before.elementIncarnations?.[collection] ?? {};
    const next = after.elementIncarnations?.[collection] ?? {};
    for (const id of new Set([...Object.keys(old), ...Object.keys(next)]))
      compare(id, valueAt(old, id), valueAt(next, id), { collection, id, identity: true });
  }
  for (const field of new Set([...Object.keys(before.content), ...Object.keys(after.content)])) {
    if (!collections.includes(field)) {
      compare(field, valueAt(before.content, field), valueAt(after.content, field), {
        collection: "content",
      });
      continue;
    }
    const a = (before.content[field] ?? []) as Array<Record<string, unknown> & { id: string }>;
    const b = (after.content[field] ?? []) as Array<Record<string, unknown> & { id: string }>;
    const left = new Map(a.map((row) => [row.id, row]));
    const right = new Map(b.map((row) => [row.id, row]));
    // Ordering is authored content for sequences and scenes, independently of
    // field values. Only changes to relative survivor order need an inverse;
    // membership inverses already remember where a removed item belonged.
    const commonBefore = a.filter((row) => right.has(row.id)).map((row) => row.id);
    const commonAfter = b.filter((row) => left.has(row.id)).map((row) => row.id);
    if (!same(commonBefore, commonAfter))
      changes.push({
        field: "",
        collection: field,
        order: true,
        before: { present: true, value: a.map((row) => row.id) },
        after: { present: true, value: b.map((row) => row.id) },
      });
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const old = left.get(id),
        next = right.get(id);
      const incarnation = after.elementIncarnations?.[field]?.[id];
      if (!old || !next) {
        compare(
          "",
          old ? { present: true, value: old } : { present: false },
          next ? { present: true, value: next } : { present: false },
          {
            collection: field,
            id,
            index: a.findIndex((row) => row.id === id),
            ...(incarnation ? { incarnation } : {}),
          },
        );
      } else if (!same(old, next))
        for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
          if (key !== "id")
            compare(key, valueAt(old, key), valueAt(next, key), {
              collection: field,
              id,
              ...(incarnation ? { incarnation } : {}),
            });
        }
    }
  }
  return changes;
}
/** A receipt lists this many changes and counts the rest. */
export const MAX_VISUAL_RECEIPT_CHANGES = 50;

/** What a commit changed, read from the inverse it already computed: one entry per record or field group. */
export function visualReceiptChanges(changes: readonly VisualUndoChange[]): VisualReceiptChange[] {
  const entries = new Map<string, VisualReceiptChange>();
  const entry = (
    collection: string,
    id: string | undefined,
    change: VisualReceiptChange["change"],
  ) => {
    // A record id is free text, so the kind keeps a record named "ordered" apart from an order entry.
    const key = JSON.stringify(
      id !== undefined
        ? ["record", collection, id]
        : [change === "ordered" ? "order" : "group", collection],
    );
    let found = entries.get(key);
    if (!found) {
      found = { collection, ...(id === undefined ? {} : { id }), change };
      entries.set(key, found);
    }
    return found;
  };
  for (const change of changes) {
    if (change.order) {
      entry(change.collection ?? "", undefined, "ordered");
      continue;
    }
    if (!change.collection || change.collection === "content") {
      const group = entry(change.collection ? "content" : "model", undefined, "updated");
      group.fields = [...(group.fields ?? []), change.field];
      continue;
    }
    const record = entry(change.collection, change.id, "updated");
    if (change.identity) {
      // Identity entries come first; membership or field entries for the same record refine them.
      if (change.before.present && change.after.present) record.change = "replaced";
      else if (record.change === "updated" && !record.fields) record.change = "identity";
    } else if (change.field === "") record.change = change.after.present ? "added" : "removed";
    else {
      if (record.change === "identity") record.change = "updated";
      record.fields = [...(record.fields ?? []), change.field];
    }
  }
  return [...entries.values()];
}
/** A created model's receipt: its records, listed without a diff, and its other content fields. */
export function visualCreatedChanges(
  model: VisualModel,
  registry?: VisualFamilyResolver,
): VisualReceiptChange[] {
  const records = visualRenderer(model.renderer, registry).records;
  const changes: VisualReceiptChange[] = [];
  for (const collection of records)
    for (const row of (model.content[collection] ?? []) as ReadonlyArray<{ id: string }>)
      changes.push({ collection, id: row.id, change: "added" });
  const fields = Object.keys(model.content).filter((field) => !records.includes(field));
  if (fields.length) changes.push({ collection: "content", change: "updated", fields });
  return changes;
}
/** The changes a receipt carries: the first MAX_VISUAL_RECEIPT_CHANGES, and a count of the rest. */
export function visualReceiptSummary(changes: readonly VisualReceiptChange[]): {
  changes: VisualReceiptChange[];
  changesOmitted?: number;
} {
  return changes.length > MAX_VISUAL_RECEIPT_CHANGES
    ? {
        changes: changes.slice(0, MAX_VISUAL_RECEIPT_CHANGES),
        changesOmitted: changes.length - MAX_VISUAL_RECEIPT_CHANGES,
      }
    : { changes: [...changes] };
}
export function applyVisualUndo<M extends VisualModel>(model: M, record: VisualUndoRecord): M {
  if (!record || !Array.isArray(record.changes))
    throw new VisualModelError("invalid", "An undo record needs a list of changes");
  for (const change of record.changes) {
    if (
      !change ||
      typeof change.field !== "string" ||
      [change.field, change.collection, change.id].some(
        (key) =>
          key !== undefined && (typeof key !== "string" || RESERVED_OBJECT_KEYS.includes(key)),
      )
    )
      throw new VisualModelError("invalid", "Undo names a reserved or invalid field");
    if (
      !change.collection &&
      !["title", "description", "status", "schemaVersion"].includes(change.field)
    )
      throw new VisualModelError("invalid", "Undo cannot rewrite model identity or ownership");
  }
  if (record.id !== model.id || record.generation !== model.generation)
    throw new VisualModelError("conflict", "The model identity has changed");
  if (record.identityVersion !== 2 && record.changes.some((change) => change.collection))
    throw new VisualModelError(
      "conflict",
      "This undo predates element identity adoption; its original edit remains available for review",
    );
  if (record.changes.some((change) => !change.collection && change.field === "schemaVersion"))
    throw new VisualModelError(
      "conflict",
      "Model format transitions cannot be undone; their original receipts remain available for review",
    );
  for (const change of record.changes) {
    if (
      change.incarnation &&
      model.elementIncarnations?.[change.collection ?? ""]?.[change.id ?? ""] !== change.incarnation
    )
      throw new VisualModelError("conflict", "The edited element was replaced; undo refused");
  }
  const candidate = structuredClone(model);
  const assign = (object: Record<string, unknown>, field: string, change: VisualUndoChange) => {
    if (!same(valueAt(object, field), change.after))
      throw new VisualModelError(
        "conflict",
        `Later edits changed ${change.collection ?? "model"}.${change.id ?? ""}.${field}; undo refused`,
      );
    if (change.before.present)
      Object.defineProperty(object, field, {
        value: structuredClone(change.before.value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    else Reflect.deleteProperty(object, field);
  };
  // Guard the original ordering before membership inverses alter the rows.
  // Unrelated inserted rows may remain; a later reorder/removal of our targets
  // must refuse rather than silently moving someone else's work.
  for (const change of record.changes.filter((entry) => entry.order)) {
    const expected = change.after.value as string[];
    const targets = new Set(expected);
    const rows = (model.content[change.collection ?? ""] ?? []) as Array<{ id: string }>;
    if (
      !same(
        rows.filter((row) => targets.has(row.id)).map((row) => row.id),
        expected,
      )
    )
      throw new VisualModelError(
        "conflict",
        "Later edits changed the collection order; undo refused",
      );
  }
  for (const change of record.changes.filter((entry) => !entry.order)) {
    if (change.identity) {
      const tokens = candidate.elementIncarnations?.[change.collection ?? ""];
      if (!tokens)
        throw new VisualModelError("conflict", "Element identities are unavailable; undo refused");
      assign(tokens, change.field, change);
      continue;
    }
    if (!change.collection) {
      assign(candidate as unknown as Record<string, unknown>, change.field, change);
      continue;
    }
    if (change.collection === "content") {
      assign(candidate.content, change.field, change);
      continue;
    }
    const rows = (candidate.content[change.collection] ?? []) as Array<
      Record<string, unknown> & { id: string }
    >;
    const index = rows.findIndex((row) => row.id === change.id);
    if (change.field === "") {
      const current = index >= 0 ? { present: true, value: rows[index] } : { present: false };
      if (!same(current, change.after))
        throw new VisualModelError(
          "conflict",
          "Later edits changed the item membership; undo refused",
        );
      if (index >= 0) rows.splice(index, 1);
      if (change.before.present && visualRecord(change.before.value))
        rows.splice(
          Math.max(0, Math.min(change.index ?? rows.length, rows.length)),
          0,
          structuredClone(change.before.value) as Record<string, unknown> & { id: string },
        );
    } else {
      const row = rows[index];
      if (!row) throw new VisualModelError("conflict", "The edited item no longer exists");
      assign(row, change.field, change);
    }
    candidate.content[change.collection] = rows;
  }
  for (const change of record.changes.filter((entry) => entry.order)) {
    const collection = change.collection ?? "";
    const order = change.before.value as string[];
    const rows = candidate.content[collection] as Array<Record<string, unknown> & { id: string }>;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const targets = new Set(order);
    if (order.some((id) => !byId.has(id)))
      throw new VisualModelError("conflict", "An ordered item no longer exists; undo refused");
    let at = 0;
    candidate.content[collection] = rows.map((row) =>
      targets.has(row.id) ? byId.get(order[at++] as string) : row,
    );
  }
  return candidate;
}
