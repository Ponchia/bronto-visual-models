import type { ValidationIssue } from "../schema.ts";
import { VisualModelError, visualRecord } from "../model.ts";
import {
  type VisualFamilyIdentity,
  type VisualRendererId,
  visualFamilyIdentity,
} from "./identity.ts";

/**
 * One thing wrong with content, where it is wrong: the shared validation
 * issue. The path names records by id, not by index (`["edges", "<id>",
 * "sourcePort"]`), so an issue stays next to its field when a draft reorders;
 * `[]` is the content as a whole.
 */
export type VisualIssue = ValidationIssue;

type Content = Record<string, unknown>;
type Item = Record<string, unknown>;

/**
 * How an editor presents one field. Type, choices and bounds come from the
 * schema and are not restated here; this says what the schema cannot.
 */
interface VisualFieldDescriptor {
  readonly label: string;
  readonly control?: "text" | "multiline" | "number" | "choice" | "tone" | "ref" | "time" | "color";
  /** The collection whose item this field names; with `of`, a list on the item `of` names. */
  readonly ref?: string;
  /** The field naming the item that owns `ref`: a port belongs to the node its edge end names. */
  readonly of?: string;
  readonly format?: "epoch-ms" | "iso-time" | "iso-date";
  readonly section?: string;
  readonly order?: number;
  readonly hidden?: boolean;
  readonly readOnly?: boolean;
}
/** Field descriptors keyed by field name; a dotted key names a nested field (`note.title`). */
export type VisualFieldDescriptors = Readonly<Record<string, VisualFieldDescriptor>>;

/** Items that leave one collection together. */
export interface VisualRemoval {
  readonly collection: string;
  readonly ids: readonly string[];
}

/** How a family's items take part in generic tools. */
interface VisualCollectionRules {
  /** Item fields whose text is authored meaning; an item's note is always included. */
  readonly search: readonly string[];
  readonly fields?: VisualFieldDescriptors;
  /**
   * A new item with the given id. `near` is where a person asked for it;
   * `group` asks for an item that holds others, where the collection has one;
   * `values` are fields a person already chose, such as a relation's ends.
   * Throws a VisualModelError when the content cannot hold one yet.
   */
  readonly newItem?: (
    content: Content,
    options: { id: string; near?: { x: number; y: number }; group?: boolean; values?: Item },
  ) => Item & { id: string };
  /**
   * Everything that leaves with these items, themselves included, so a
   * removal never strands a relationship or a child. Without it, only the
   * items leave.
   */
  readonly cascade?: (content: Content, ids: readonly string[]) => readonly VisualRemoval[];
  /** What removing one item does, in words shown before a person confirms it. */
  readonly removalNote?: string;
}

/** Something a person can add from the collection editor. */
interface VisualAddition {
  readonly label: string;
  readonly collection: string;
  /** Ask `newItem` for an item that holds others. */
  readonly group?: boolean;
  /** Choose the relation's ends (its `ref` fields) before adding it. */
  readonly relation?: boolean;
}

/**
 * The authoring half of a family: its content schema, its own rules beyond the
 * schema, and how its items take part in search. Generic code asks the family;
 * it never branches on a renderer name.
 */
export interface VisualFamily extends VisualFamilyIdentity {
  readonly schema: Readonly<Record<string, unknown>>;
  /** Every rule the schema cannot state (relationships, geometry, structure) that the content breaks. */
  readonly validate?: (content: Content) => readonly VisualIssue[];
  /**
   * What valid content says that its renderer draws otherwise, such as a size
   * the view overrides: warnings for the author, never a refusal.
   */
  readonly advise?: (content: Content) => readonly VisualIssue[];
  readonly collections: Readonly<Record<string, VisualCollectionRules>>;
  /** Fields outside the record collections. */
  readonly fields?: VisualFieldDescriptors;
  /** What the collection editor offers to add, in button order. */
  readonly additions?: (content: Content) => readonly VisualAddition[];
  /** Authored text outside the record collections: a spec title, a source, a dataset address. */
  readonly searchText?: (content: Content) => readonly unknown[];
  /**
   * Content fields the schema no longer declares that a load still strips,
   * each named in VISUAL_RETIREMENTS with its reason (decision 0130).
   */
  readonly retired?: readonly string[];
  /**
   * What the family draws from rows its source resolved, returned beside the
   * rows themselves, such as a timeline's events. Throws when the rows cannot
   * be drawn.
   */
  readonly fromRows?: (rows: readonly Item[], content: Content) => Record<string, unknown>;
}

export function defineVisualFamily<Id extends VisualRendererId>(
  id: Id,
  authoring: Omit<VisualFamily, keyof VisualFamilyIdentity>,
): VisualFamily & { id: Id } {
  const identity = visualFamilyIdentity(id);
  if (!identity) throw new Error(`No identity declares the visual family ${id}`);
  return Object.freeze({ ...identity, ...authoring, id });
}

/**
 * The issues a throwing validator found: every one it names, or, for one that
 * stops at its first problem, that problem as the content's one issue.
 */
export function issuesFrom(check: () => void): VisualIssue[] {
  try {
    check();
    return [];
  } catch (error) {
    if (!(error instanceof VisualModelError)) throw error;
    return error.report ? [...error.report.issues] : [{ path: [], message: error.message }];
  }
}

/** What removing these items takes with it, by the family's own rules; untouched collections are omitted. */
export function visualRemoval(
  family: VisualFamily | undefined,
  collection: string,
  content: Content,
  ids: readonly string[],
): readonly VisualRemoval[] {
  const removal = family?.collections[collection]?.cascade?.(content, ids) ?? [
    { collection, ids: [...ids] },
  ];
  return removal.filter((entry) => entry.ids.length > 0);
}

export const NESTED_REMOVAL =
  "Removing this item also removes its descendants and connected relationships. The change is saved to the model source.";

/**
 * The removal rule of items that nest by `parentId` and relate by two end
 * fields (`source` and `target` unless named): a parent takes its descendants,
 * and a relationship leaves with either end.
 */
export function nestedCascade(
  items: string,
  relations: string,
  [from, to]: readonly [string, string] = ["source", "target"],
) {
  return (content: Content, ids: readonly string[]): VisualRemoval[] => {
    const records = (field: string) =>
      (Array.isArray(content[field]) ? content[field] : []).filter(visualRecord);
    const removed = new Set(ids);
    for (let grew = true; grew; ) {
      grew = false;
      for (const item of records(items))
        if (
          typeof item.parentId === "string" &&
          removed.has(item.parentId) &&
          !removed.has(String(item.id))
        ) {
          removed.add(String(item.id));
          grew = true;
        }
    }
    const leaving = (field: string, gone: (item: Item) => boolean) => ({
      collection: field,
      ids: records(field)
        .filter(gone)
        .map((item) => String(item.id)),
    });
    return [
      leaving(items, (item) => removed.has(String(item.id))),
      ...(Array.isArray(content[relations])
        ? [
            leaving(
              relations,
              (item) => removed.has(String(item[from])) || removed.has(String(item[to])),
            ),
          ]
        : []),
    ];
  };
}

/** The searchable text of a collection's items: the named fields and each item's note. */
export function searchableItems(value: unknown, fields: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const text: unknown[] = [];
  for (const item of value)
    if (visualRecord(item)) {
      for (const field of fields) text.push(item[field]);
      if (visualRecord(item.note)) text.push(item.note.title, item.note.body);
    }
  return text.filter((entry): entry is string => typeof entry === "string");
}

/** A dataset-bound model is found by the dataset it reads. */
export function datasetSearchText(content: Record<string, unknown>): unknown[] {
  if (content.datasource !== "dataset") return [];
  return [content.datasource, visualRecord(content.params) ? content.params.dataset : undefined];
}

/** The fields most relationship families author. */
export const SEMANTIC_SEARCH = ["label", "description", "entityId"] as const;
export const SEMANTIC_FIELDS = {
  label: { label: "Label", control: "text", order: 0 },
  description: { label: "Description", control: "multiline", order: 1 },
  entityId: { label: "Shared entity", control: "text", section: "Identity" },
} satisfies VisualFieldDescriptors;
