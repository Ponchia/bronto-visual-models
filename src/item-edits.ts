import type { VisualFamilyResolver } from "./family-resolver.ts";
import {
  assertKnownFields,
  canonicalVisualJson,
  type VisualMismatch,
  type VisualModel,
  VisualModelError,
  type VisualRemoval,
  visualCollectionLimit,
  visualFamily,
  visualRecord,
  visualRemoval,
  visualText,
} from "./index.ts";

/** Shown whole in a refusal up to this size; past it, the refusal shows the shape. */
const RECOVERY_SAMPLE_CHARS = 400;

/**
 * The single-object form `items: {field, …}` is not aliased: its refusal shows
 * the same edit as the one entry of a list.
 */
function wrappedForm(edit: Record<string, unknown>): string {
  const whole = JSON.stringify({ items: [edit] });
  if (whole.length <= RECOVERY_SAMPLE_CHARS) return whole;
  const shape = Object.fromEntries(
    Object.entries(edit).map(([key, value]) => [key, Array.isArray(value) ? ["…"] : value]),
  );
  return JSON.stringify({ items: [shape] });
}

/** `items` is a non-empty list; the single-object form is refused with its wrapped form. */
function assertVisualItemEditList(items: unknown): asserts items is unknown[] {
  if (visualRecord(items))
    throw new VisualModelError(
      "invalid",
      `items is a list of collection edits; send this edit as its one entry: ${wrappedForm(items)}`,
    );
  if (!Array.isArray(items) || !items.length)
    throw new VisualModelError("invalid", "items lists one edit per collection");
}

type Row = Record<string, unknown> & { id: string };
/** Mismatches a refusal carries; a caller rereads the model for anything past these. */
const MAX_MISMATCHES = 50;
/** IDs an order refusal names per kind of problem. */
const MAX_NAMED = 10;

function named(ids: readonly string[]): string {
  const shown = ids.slice(0, MAX_NAMED).join(", ");
  return ids.length > MAX_NAMED ? `${shown} and ${ids.length - MAX_NAMED} more` : shown;
}

/** One collection's rows, in order, by ID. */
function rowsOf(content: Record<string, unknown>, field: string): Map<string, Row> {
  return new Map(((content[field] ?? []) as Row[]).map((row) => [row.id, row]));
}

/**
 * Every value a patch expected that the content does not hold, read before
 * anything is applied: the caller's view against the stored one.
 */
function expectationMismatches(
  content: Record<string, unknown>,
  edits: readonly Record<string, unknown>[],
): VisualMismatch[] {
  const mismatches: VisualMismatch[] = [];
  for (const edit of edits) {
    if (!Array.isArray(edit.set)) continue;
    const field = String(edit.field);
    const rows = rowsOf(content, field);
    for (const patch of edit.set) {
      if (!visualRecord(patch) || patch.expect === undefined) continue;
      if (!visualRecord(patch.expect) || Object.hasOwn(patch.expect, "id"))
        throw new VisualModelError(
          "invalid",
          "expect maps the item's fields to the values the caller read, null for absent",
        );
      const id = String(patch.id);
      const row = rows.get(id);
      for (const [name, value] of Object.entries(patch.expect)) {
        const expected = value ?? null;
        const actual = row && Object.hasOwn(row, name) ? (row[name] ?? null) : null;
        if (canonicalVisualJson(expected) !== canonicalVisualJson(actual))
          mismatches.push({ path: [field, id, name], expected, actual });
      }
    }
  }
  return mismatches;
}

/** `rows` with a new item placed after `after`, or first for null. */
function placedAfter(rows: Map<string, Row>, after: string | null, row: Row): Map<string, Row> {
  const next = new Map<string, Row>();
  if (after === null) next.set(row.id, row);
  for (const [id, existing] of rows) {
    next.set(id, existing);
    if (id === after) next.set(row.id, row);
  }
  return next;
}

/** Refuses an order that is not a permutation, naming the unknown, missing and repeated IDs. */
function assertPermutation(order: unknown, rows: Map<string, Row>, field: string): string[] {
  if (!Array.isArray(order) || order.some((id) => typeof id !== "string"))
    throw new VisualModelError("invalid", `Order lists every ${field} ID once`);
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const id of order as string[]) {
    if (seen.has(id)) repeated.push(id);
    seen.add(id);
  }
  const unknown = (order as string[]).filter((id) => !rows.has(id));
  const missing = [...rows.keys()].filter((id) => !seen.has(id));
  const problems = [
    ...(unknown.length ? [`unknown ${named(unknown)}`] : []),
    ...(missing.length ? [`missing ${named(missing)}`] : []),
    ...(repeated.length ? [`repeated ${named(repeated)}`] : []),
  ];
  if (problems.length)
    throw new VisualModelError(
      "invalid",
      `Order must name every current ${field} item exactly once: ${problems.join("; ")}`,
    );
  return order as string[];
}

/**
 * Applies a mutation's collection edits to `current` in place, in list order:
 * one revision and one undo, whatever the number of collections. Expectations
 * are checked first, against the content as the caller would have read it.
 * Returns, per collection, the IDs that name a new subject (`replace`) and
 * everything the removals took, the family's cascade included.
 */
export function applyVisualItemEdits(
  current: VisualModel,
  items: unknown,
  revision: number | undefined,
  registry?: VisualFamilyResolver,
): { fresh: Record<string, string[]>; removed: VisualRemoval[] } {
  assertVisualItemEditList(items);
  const fields = new Set<string>();
  const edits = items.map((edit) => {
    if (!visualRecord(edit))
      throw new VisualModelError("invalid", "Each collection edit must be an object");
    assertKnownFields(edit, ["field", "set", "remove", "order", "replace"]);
    const field = visualText(edit.field, "Collection", 80);
    if (fields.has(field))
      throw new VisualModelError(
        "invalid",
        `items names ${field} twice; one entry holds every change to a collection`,
      );
    fields.add(field);
    // Refuses a collection the renderer does not edit; the bound is the family schema's.
    visualCollectionLimit(current.renderer, field, registry);
    return edit;
  });
  const mismatches = expectationMismatches(current.content, edits);
  if (mismatches.length)
    throw new VisualModelError(
      "conflict",
      `Items changed since they were read (${named(mismatches.map((entry) => entry.path.join(".")))}); reread and decide again`,
      {
        currentRevision: current.revision,
        mismatches: mismatches.slice(0, MAX_MISMATCHES),
        mismatchesOmitted: Math.max(0, mismatches.length - MAX_MISMATCHES),
      },
    );
  const family = visualFamily(current.renderer, registry);
  const fresh: Record<string, string[]> = {};
  const removed = new Map<string, Set<string>>();
  for (const edit of edits) {
    const field = String(edit.field);
    const limit = visualCollectionLimit(current.renderer, field, registry);
    let rows = rowsOf(current.content, field);
    const remove = edit.remove ?? [];
    const set = edit.set ?? [];
    if (edit.replace !== undefined) {
      const replace = edit.replace;
      if (revision === undefined)
        throw new VisualModelError(
          "precondition-required",
          "Replacing subject identity requires ifRevision (--if-rev)",
        );
      if (
        !Array.isArray(replace) ||
        replace.length > limit ||
        new Set(replace).size !== replace.length ||
        replace.some(
          (itemId) =>
            typeof itemId !== "string" ||
            !rows.has(itemId) ||
            !Array.isArray(set) ||
            !set.some((patch) => visualRecord(patch) && patch.id === itemId),
        )
      )
        throw new VisualModelError(
          "invalid",
          "Replacing subject identity needs a patch for every current item",
        );
      fresh[field] = replace as string[];
    }
    if (!Array.isArray(remove) || !Array.isArray(set))
      throw new VisualModelError("invalid", "Item edits list removals and patches");
    if (remove.length + set.length > limit)
      throw new VisualModelError(
        "invalid",
        `One edit names at most ${limit} ${field}, as many as the collection holds`,
      );
    const edited = new Set<string>();
    const requested = remove.map((raw) => {
      const itemId = visualText(raw, "Item ID", 128);
      if (edited.has(itemId)) throw new VisualModelError("invalid", "Duplicate item edit");
      edited.add(itemId);
      return itemId;
    });
    // What leaves with these items by the family's own rules: the same cascade a client previews.
    for (const { collection, ids } of requested.length
      ? visualRemoval(family, field, current.content, requested)
      : []) {
      const gone = removed.get(collection) ?? new Set<string>();
      for (const id of ids) gone.add(id);
      removed.set(collection, gone);
      if (collection === field)
        for (const id of ids) {
          edited.add(id);
          rows.delete(id);
        }
      else
        current.content[collection] = ((current.content[collection] ?? []) as Row[]).filter(
          (row) => !ids.includes(row.id),
        );
    }
    let placed = false;
    for (const patch of set) {
      if (!visualRecord(patch))
        throw new VisualModelError("invalid", "Item patch must be an object");
      const itemId = visualText(patch.id, "Item ID", 128);
      if (edited.has(itemId))
        throw new VisualModelError("invalid", "Duplicate or removed item edit");
      edited.add(itemId);
      const { expect: _expect, after, ...values } = patch;
      const row: Row = { ...(rows.get(itemId) ?? {}), id: itemId };
      for (const [key, value] of Object.entries(values)) {
        if (key === "id") continue;
        if (value === null) delete row[key];
        else row[key] = value;
      }
      if (after === undefined) {
        rows.set(itemId, row);
        continue;
      }
      if (rows.has(itemId))
        throw new VisualModelError(
          "invalid",
          `after places a new item; ${itemId} exists, so move it with order`,
        );
      if (after !== null && (typeof after !== "string" || !rows.has(after)))
        throw new VisualModelError(
          "invalid",
          `after names ${String(after)}, which is not in ${field}`,
        );
      rows = placedAfter(rows, after, row);
      placed = true;
    }
    if (edit.order !== undefined) {
      if (revision === undefined)
        throw new VisualModelError(
          "precondition-required",
          "Reordering requires ifRevision (--if-rev)",
        );
      if (placed)
        throw new VisualModelError(
          "invalid",
          "An entry places new items with after, or orders every item, not both",
        );
      current.content[field] = assertPermutation(edit.order, rows, field).map((id) => rows.get(id));
    } else current.content[field] = [...rows.values()];
  }
  return {
    fresh,
    removed: [...removed].map(([collection, ids]) => ({ collection, ids: [...ids] })),
  };
}
