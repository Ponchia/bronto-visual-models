import type { IssueReport } from "./schema.ts";
import { sha256Hex } from "./hash.ts";
import { RESERVED_OBJECT_KEYS } from "./reserved-keys.ts";
import type { VisualIncompatibility } from "./compatibility.ts";

/** Visual content has a durable identity independent of any canvas view. */
export const VISUAL_MODEL_VERSION = 2;
export const VISUAL_MODEL_ROLES = ["model", "template", "snapshot"] as const;
const MAX_VISUAL_CONTENT_BYTES = 2_000_000;
/** A model id is a lowercase slug, so it is also a path segment of the model's routes. */
export const VISUAL_MODEL_ID_SCHEMA = {
  type: "string",
  pattern: "^[a-z][a-z0-9_-]{0,127}$",
} as const;
export const VISUAL_ID = new RegExp(VISUAL_MODEL_ID_SCHEMA.pattern);
/** One lifetime of a record: minted when the record appears and never reused after it goes. */
export const VISUAL_INCARNATION_SCHEMA = {
  type: "string",
  pattern: "^[a-zA-Z0-9_-]{16,128}$",
} as const;
const INCARNATION = new RegExp(VISUAL_INCARNATION_SCHEMA.pattern);
export function isVisualIncarnation(value: unknown): value is string {
  return typeof value === "string" && INCARNATION.test(value);
}
export interface VisualModel {
  schemaVersion: number;
  id: string;
  generation: string;
  revision: number;
  title: string;
  description: string;
  modelType: string;
  renderer: string;
  content: Record<string, unknown>;
  status: "active" | "archived";
  role: (typeof VISUAL_MODEL_ROLES)[number];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  source?: { id: string; revision: number };
  rendererVersion?: number;
  /** Domain-issued record lifetimes, separate from renderer-authored fields. */
  elementIncarnations?: Record<string, Record<string, string>>;
}
/**
 * What a listing shows of a model. Records' lifetimes are content bookkeeping that
 * only a full read uses, and can outweigh the rest of the summary many times over.
 */
export type VisualModelSummary = Omit<VisualModel, "content" | "elementIncarnations">;
/** Which model, of what kind, at which revision: what a label needs, without content. */
export type VisualModelHead = Pick<VisualModel, "id" | "renderer" | "revision" | "generation">;
export interface VisualTarget {
  modelId: string;
  generation: string;
  revision: number;
  elementId: string;
  collection?: string;
  label: string;
  instanceId?: string;
  incarnation?: string;
}
export interface VisualMutation {
  key: string;
  ifRevision?: number;
  generation?: string;
  title?: string;
  description?: string;
  status?: "active" | "archived";
  content?: Record<string, unknown>;
  /** Collection edits, at most one per collection, applied as one revision and one undo. */
  items?: VisualItemEdit[];
}
/** One item's patch: its fields, and two names the edit grammar keeps for itself. */
export type VisualItemPatch = Record<string, unknown> & {
  id: string;
  /**
   * Field values the caller read, null for absent. Any that differ refuse the
   * whole edit, so two people moving different items both land.
   */
  expect?: Record<string, unknown>;
  /** Where a new item goes: after this item ID, or first for null. */
  after?: string | null;
};
/** One collection's part of an edit. */
export interface VisualItemEdit {
  field: string;
  set?: VisualItemPatch[];
  /** Each removal takes what the family says leaves with it (its relationships, its children). */
  remove?: string[];
  order?: string[];
  /** A fresh subject under an existing ID, rather than an ordinary update. */
  replace?: string[];
}
/** Item fields the edit grammar keeps; no family may declare them. */
export const VISUAL_ITEM_EDIT_RESERVED = ["expect", "after"] as const;
/** A value the caller expected and the one the item holds, null for absent. */
export interface VisualMismatch {
  readonly path: readonly [collection: string, id: string, field: string];
  readonly expected: unknown;
  readonly actual: unknown;
}
export function supportedModelVersion(value: unknown): boolean {
  return value === VISUAL_MODEL_VERSION;
}
export interface VisualReceipt {
  key: string;
  hash: string;
  id: string;
  revision: number;
  at: string;
  action: string;
}
/** One record's, field group's or collection order's part in a commit. */
export interface VisualReceiptChange {
  /** A record collection; `content` for other content fields; `model` for title, description, status and schemaVersion. */
  collection: string;
  id?: string;
  /** `replaced`: the same id, a new element lifetime. `identity`: a lifetime assigned to an existing record. */
  change: "added" | "removed" | "updated" | "replaced" | "identity" | "ordered";
  fields?: string[];
}
/**
 * A receipt as a write answers it. `generation` names the lifetime its
 * revision belongs to. `changes` describe the commit as it ran, so a replay,
 * which ran nothing, carries none.
 */
export interface VisualCommitReceipt extends VisualReceipt {
  generation: string;
  changes?: VisualReceiptChange[];
  /** How many further changes `changes` leaves out. */
  changesOmitted?: number;
}
export type VisualModelErrorCode =
  | "invalid"
  | "not-found"
  | "conflict"
  /** A write that must name the revision it read, and did not. */
  | "precondition-required"
  | "forbidden"
  | "unavailable";
/** What a refusal carries besides its message, given when it is built. */
export interface VisualModelErrorOptions {
  /** Each problem with the content, capped, when validation named them. */
  readonly report?: IssueReport;
  /** The model's revision when a conflict refused the request, so the caller can reread. */
  readonly currentRevision?: number;
  /** Every expected value that differed, when per-item expectations refused an edit. */
  readonly mismatches?: readonly VisualMismatch[];
  /** How many more differed than `mismatches` lists, when above zero. */
  readonly mismatchesOmitted?: number;
  /** Why this build cannot interpret the model, when that refused the request. */
  readonly reason?: VisualIncompatibility;
}
export class VisualModelError extends Error {
  readonly code: VisualModelErrorCode;
  /** Each problem with the content, capped, when validation named them. */
  readonly report?: IssueReport;
  readonly currentRevision?: number;
  readonly mismatches?: readonly VisualMismatch[];
  readonly mismatchesOmitted?: number;
  readonly reason?: VisualIncompatibility;
  constructor(code: VisualModelErrorCode, message: string, options: VisualModelErrorOptions = {}) {
    super(message);
    this.name = "VisualModelError";
    this.code = code;
    if (options.currentRevision !== undefined) this.currentRevision = options.currentRevision;
    if (options.mismatches?.length) this.mismatches = options.mismatches;
    if (options.mismatchesOmitted) this.mismatchesOmitted = options.mismatchesOmitted;
    if (options.reason) this.reason = options.reason;
    if (options.report?.issues.length) this.report = options.report;
  }
}
/** What a refusal adds for a caller to act on, sent as the answer's `detail`. */
export function visualRefusalDetail(error: VisualModelError): Record<string, unknown> | undefined {
  const detail = {
    ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
    ...(error.mismatches ? { mismatches: error.mismatches } : {}),
    ...(error.mismatchesOmitted ? { mismatchesOmitted: error.mismatchesOmitted } : {}),
    ...(error.reason ? { reason: error.reason } : {}),
  };
  return Object.keys(detail).length ? detail : undefined;
}
/** HTTP status for each refusal code; one table for every route that answers one. */
export const VISUAL_MODEL_ERROR_STATUS: Readonly<Record<VisualModelErrorCode, number>> = {
  invalid: 400,
  "not-found": 404,
  conflict: 409,
  "precondition-required": 428,
  forbidden: 403,
  unavailable: 503,
};
/** The id a create or fork takes from its key when the request names none, so a retry names the same model. */
export function visualModelIdForKey(key: string): string {
  return `model-${sha256Hex(key).slice(0, 24)}`;
}
/** A model's summary; also drops what a library entry written by an earlier build still carries. */
export function modelSummary<
  M extends VisualModelSummary & Partial<Pick<VisualModel, "content" | "elementIncarnations">>,
>(model: M): Omit<M, "content" | "elementIncarnations"> {
  const { content: _content, elementIncarnations: _incarnations, ...summary } = model;
  return summary;
}
export function visualRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
/** Reject prototype-bearing names, non-JSON values and excessive payloads before copying. */
export function assertVisualJson(value: unknown): void {
  let count = 0;
  const visit = (item: unknown, depth: number) => {
    if (++count > 100_000 || depth > 32)
      throw new VisualModelError("invalid", "Visual data is too deep or large");
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) {
      if (item.length > 100_000 || Object.getPrototypeOf(item) !== Array.prototype)
        throw new VisualModelError("invalid", "Visual data requires bounded JSON arrays");
      const fields = Object.getOwnPropertyDescriptors(item);
      const keys = Reflect.ownKeys(fields).filter((key) => key !== "length");
      if (keys.length !== item.length)
        throw new VisualModelError(
          "invalid",
          "Visual arrays cannot contain holes or named properties",
        );
      for (let index = 0; index < item.length; index++) {
        const descriptor = fields[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
          throw new VisualModelError(
            "invalid",
            "Visual arrays cannot contain getters or hidden entries",
          );
        visit(descriptor.value, depth + 1);
      }
      return;
    }
    if (!visualRecord(item))
      throw new VisualModelError("invalid", "Visual data must contain only JSON values");
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== null && prototype !== Object.prototype)
      throw new VisualModelError("invalid", "Visual data requires plain JSON objects");
    const fields = Object.getOwnPropertyDescriptors(item);
    for (const key of Reflect.ownKeys(fields)) {
      if (typeof key !== "string" || RESERVED_OBJECT_KEYS.includes(key))
        throw new VisualModelError("invalid", "Reserved visual field name");
      const descriptor = fields[key];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
        throw new VisualModelError(
          "invalid",
          "Visual data cannot contain getters or hidden fields",
        );
      visit(descriptor.value, depth + 1);
    }
  };
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_VISUAL_CONTENT_BYTES)
    throw new VisualModelError("invalid", "Visual content exceeds 2 MB");
}
/**
 * The identifier a record carries: its own `id`, and the `entityId` it shares
 * with other models. A reserved object key is not one: a record's id becomes a
 * key of its incarnations, and code looks records up by id.
 */
export const VISUAL_RECORD_ID_SCHEMA = {
  type: "string",
  pattern: `^(?!(?:${RESERVED_OBJECT_KEYS.join("|")})$)[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`,
} as const;
const RECORD_ID = new RegExp(VISUAL_RECORD_ID_SCHEMA.pattern);
export function isVisualRecordId(value: unknown): value is string {
  return typeof value === "string" && RECORD_ID.test(value);
}
/** Dataset columns cannot be named `entityId`, so a row may carry either spelling. */
const ENTITY_FIELDS = ["entityId", "entity", "entity_id"] as const;
/**
 * The entity a record or row declares, never inferred from a label. A view reads
 * it the same way when it announces an entity and when it is matched by one.
 */
export function recordEntity(record: unknown): string | undefined {
  if (!visualRecord(record)) return undefined;
  for (const field of ENTITY_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}
export function assertVisualKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(key))
    throw new VisualModelError("invalid", "A stable operation key of 1–128 characters is required");
}
export function visualText(value: unknown, name: string, max: number, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max)
    throw new VisualModelError("invalid", `${name} must be ${empty ? "0" : "1"}–${max} characters`);
  return value;
}
export function assertKnownFields(value: Record<string, unknown>, fields: readonly string[]): void {
  for (const key of Object.keys(value))
    if (!fields.includes(key)) throw new VisualModelError("invalid", `Unknown field: ${key}`);
}

/** Stable value comparison is shared by receipts, editor diffs and guarded undo. */
export function canonicalVisualJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalVisualJson).join(",")}]`;
  if (visualRecord(value))
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalVisualJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
