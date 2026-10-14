import { assertUndoRecord } from "./undo-validation.ts";
import { visualRenderer, validateVisualContent, VISUAL_TEMPLATES } from "./catalog.ts";
import { assertModelCompatible } from "./compatibility.ts";
import type { VisualFamilyResolver } from "./family-resolver.ts";
import { withAuthoredTimes } from "./families/authored-times.ts";
import { assignModelIncarnations, assertModelIncarnations } from "./incarnations.ts";
import { applyVisualItemEdits } from "./item-edits.ts";
import {
  assertKnownFields,
  assertVisualJson,
  isVisualIncarnation,
  VISUAL_ID,
  VISUAL_MODEL_VERSION,
  type VisualModel,
  VisualModelError,
  type VisualMutation,
  visualRecord,
  visualText,
} from "./model.ts";
import { applyVisualUndo, type VisualUndoRecord, visualUndoChanges } from "./undo.ts";

export interface AuthorContext {
  actor?: string;
  /** An ISO timestamp with an offset. Omit to use the current time. */
  at?: string;
  /** Host-issued unique lifetime tokens. Omit to use crypto.randomUUID. */
  mint?: () => string;
}
export interface CreateModelInput {
  id: string;
  title: string;
  description?: string;
  renderer?: string;
  template?: string;
  content?: Record<string, unknown>;
  role?: VisualModel["role"];
}
export type ModelEdit = Omit<VisualMutation, "key">;
export interface ModelTransition<M extends VisualModel = VisualModel> {
  model: M;
  changes: ReturnType<typeof visualUndoChanges>;
  removed: readonly { collection: string; ids: readonly string[] }[];
}

function author(context: AuthorContext) {
  const actor = visualText(context.actor ?? "local", "Actor", 128);
  const raw = context.at ?? new Date().toISOString();
  if (
    typeof raw !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ||
    !Number.isFinite(Date.parse(raw))
  )
    throw new VisualModelError("invalid", "An authored timestamp needs an explicit timezone");
  const at = new Date(raw).toISOString();
  const mint = () => {
    const token = (
      context.mint ??
      (() => {
        if (typeof globalThis.crypto?.randomUUID !== "function")
          throw new VisualModelError(
            "unavailable",
            "This environment needs a secure random UUID source; use a secure context or provide mint",
          );
        return globalThis.crypto.randomUUID();
      })
    )();
    if (!isVisualIncarnation(token))
      throw new VisualModelError("invalid", "Invalid lifetime token");
    return token;
  };
  return { actor, at, mint };
}
function checkRevision(value: unknown): asserts value is number | undefined {
  if (value !== undefined && (!Number.isSafeInteger(value) || Number(value) < 1))
    throw new VisualModelError("invalid", "ifRevision must be a positive integer");
}
function checkGuard(model: VisualModel, patch: Pick<ModelEdit, "ifRevision" | "generation">) {
  checkRevision(patch.ifRevision);
  if (patch.generation !== undefined && patch.generation !== model.generation)
    throw new VisualModelError("conflict", "The model lifetime changed", {
      currentRevision: model.revision,
    });
  if (patch.ifRevision !== undefined && patch.ifRevision !== model.revision)
    throw new VisualModelError("conflict", "The model changed since it was read", {
      currentRevision: model.revision,
    });
}

/** Validate an owned document without reading a network, database or UI. Host metadata may be retained. */
export function assertVisualModel(
  value: unknown,
  registry?: VisualFamilyResolver,
): asserts value is VisualModel {
  assertVisualJson(value);
  if (!visualRecord(value))
    throw new VisualModelError("invalid", "A visual model must be an object");
  if (typeof value.id !== "string" || !VISUAL_ID.test(value.id))
    throw new VisualModelError("invalid", "Invalid model ID");
  if (!isVisualIncarnation(value.generation))
    throw new VisualModelError("invalid", "Invalid model generation");
  checkRevision(value.revision);
  if (value.revision === undefined)
    throw new VisualModelError("invalid", "A stored model needs a revision");
  visualText(value.title, "Title", 240);
  visualText(value.description, "Description", 4000, true);
  visualText(value.createdBy, "Creator", 128);
  visualText(value.updatedBy, "Author", 128);
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string")
    throw new VisualModelError("invalid", "Stored timestamps are required");
  author({ at: value.createdAt as string });
  author({ at: value.updatedAt as string });
  if (
    !["active", "archived"].includes(String(value.status)) ||
    !["model", "template", "snapshot"].includes(String(value.role))
  )
    throw new VisualModelError("invalid", "Invalid model status or role");
  assertModelCompatible(value as unknown as VisualModel, "invalid", registry);
  validateVisualContent(String(value.renderer), String(value.modelType), value.content, registry);
  assertModelIncarnations(value as unknown as VisualModel, registry);
}

/** Create a document, not a persisted resource. A store owns its transaction and authority. */
export function createModel(
  input: CreateModelInput,
  context: AuthorContext = {},
  registry?: VisualFamilyResolver,
): VisualModel {
  assertVisualJson(input);
  if (!visualRecord(input)) throw new VisualModelError("invalid", "Model input must be an object");
  assertKnownFields(input as unknown as Record<string, unknown>, [
    "id",
    "title",
    "description",
    "renderer",
    "template",
    "content",
    "role",
  ]);
  if (typeof input.id !== "string" || !VISUAL_ID.test(input.id))
    throw new VisualModelError("invalid", "Invalid model ID");
  const template =
    input.template === undefined
      ? undefined
      : VISUAL_TEMPLATES.find((entry) => entry.id === input.template);
  if (input.template !== undefined && !template)
    throw new VisualModelError("invalid", "Unknown template");
  if (template && input.renderer !== undefined && input.renderer !== template.renderer)
    throw new VisualModelError("invalid", "Template and renderer disagree");
  const renderer = visualText(input.renderer ?? template?.renderer, "Renderer", 128);
  const definition = visualRenderer(renderer, registry);
  const content = structuredClone(input.content ?? template?.content ?? {});
  const normalized = withAuthoredTimes(renderer, content, registry);
  validateVisualContent(renderer, definition.modelType, normalized, registry);
  const { actor, at, mint } = author(context);
  const role = input.role ?? "model";
  if (!["model", "template", "snapshot"].includes(role))
    throw new VisualModelError("invalid", "Invalid model role");
  const model = assignModelIncarnations(
    {
      schemaVersion: VISUAL_MODEL_VERSION,
      id: input.id,
      generation: mint(),
      revision: 1,
      title: visualText(input.title, "Title", 240),
      description: visualText(input.description ?? "", "Description", 4000, true),
      renderer,
      modelType: definition.modelType,
      rendererVersion: definition.version,
      content: normalized,
      status: "active",
      role,
      createdAt: at,
      updatedAt: at,
      createdBy: actor,
      updatedBy: actor,
    } satisfies VisualModel,
    undefined,
    mint,
    undefined,
    registry,
  );
  assertModelIncarnations(model, registry);
  return model;
}

/** All edits happen on an owned candidate. A refusal cannot partially modify the supplied model. */
export function editModel<M extends VisualModel>(
  model: M,
  patch: ModelEdit,
  context: AuthorContext = {},
  registry?: VisualFamilyResolver,
): ModelTransition<M> {
  assertVisualModel(model, registry);
  assertVisualJson(patch);
  if (!visualRecord(patch)) throw new VisualModelError("invalid", "Model patch must be an object");
  assertKnownFields(patch as unknown as Record<string, unknown>, [
    "generation",
    "ifRevision",
    "title",
    "description",
    "status",
    "content",
    "items",
  ]);
  if (model.role !== "model")
    throw new VisualModelError("forbidden", "Templates and snapshots are immutable; fork first");
  checkGuard(model, patch);
  if ((patch.content !== undefined || patch.status !== undefined) && patch.ifRevision === undefined)
    throw new VisualModelError(
      "precondition-required",
      "Replacing content or status requires ifRevision",
    );
  if (
    !["title", "description", "status", "content", "items"].some((field) =>
      Object.hasOwn(patch, field),
    )
  )
    throw new VisualModelError("invalid", "The edit contains no changes");
  const { actor, at, mint } = author(context);
  let candidate = structuredClone(model);
  if (patch.title !== undefined) candidate.title = visualText(patch.title, "Title", 240);
  if (patch.description !== undefined)
    candidate.description = visualText(patch.description, "Description", 4000, true);
  if (patch.status !== undefined) {
    if (patch.status !== "active" && patch.status !== "archived")
      throw new VisualModelError("invalid", "Invalid model status");
    candidate.status = patch.status;
  }
  if (patch.content !== undefined) {
    if (!visualRecord(patch.content))
      throw new VisualModelError("invalid", "Content patch must be an object");
    candidate.content = { ...candidate.content, ...structuredClone(patch.content) };
  }
  const edited =
    patch.items === undefined
      ? { fresh: undefined, removed: [] }
      : applyVisualItemEdits(candidate, patch.items, patch.ifRevision, registry);
  candidate.content = withAuthoredTimes(candidate.renderer, candidate.content, registry);
  validateVisualContent(candidate.renderer, candidate.modelType, candidate.content, registry);
  candidate = assignModelIncarnations(candidate, model, mint, edited.fresh, registry);
  candidate.revision += 1;
  if (!Number.isSafeInteger(candidate.revision))
    throw new VisualModelError("invalid", "Model revision is exhausted");
  candidate.rendererVersion = visualRenderer(candidate.renderer, registry).version;
  candidate.updatedAt = at;
  candidate.updatedBy = actor;
  assertModelIncarnations(candidate, registry);
  return {
    model: candidate,
    changes: visualUndoChanges(model, candidate, registry),
    removed: edited.removed,
  };
}

/** Undo guards changed fields and element lifetimes, preserving disjoint later edits. */
export function undoModel<M extends VisualModel>(
  model: M,
  record: VisualUndoRecord,
  context: AuthorContext = {},
  registry?: VisualFamilyResolver,
): ModelTransition<M> {
  assertVisualModel(model, registry);
  assertUndoRecord(record, model, registry);
  if (model.role !== "model")
    throw new VisualModelError("forbidden", "Templates and snapshots cannot be edited");
  const candidate = applyVisualUndo(model, record);
  validateVisualContent(candidate.renderer, candidate.modelType, candidate.content, registry);
  assertModelIncarnations(candidate, registry);
  const { actor, at } = author(context);
  candidate.revision += 1;
  if (!Number.isSafeInteger(candidate.revision))
    throw new VisualModelError("invalid", "Model revision is exhausted");
  candidate.updatedAt = at;
  candidate.updatedBy = actor;
  return { model: candidate, changes: visualUndoChanges(model, candidate, registry), removed: [] };
}

export function forkModel(
  model: VisualModel,
  input: { id: string; title?: string; ifRevision: number; generation?: string },
  context: AuthorContext = {},
  registry?: VisualFamilyResolver,
): VisualModel {
  assertVisualModel(model, registry);
  assertVisualJson(input);
  if (!visualRecord(input)) throw new VisualModelError("invalid", "Model input must be an object");
  assertKnownFields(input as unknown as Record<string, unknown>, [
    "id",
    "title",
    "ifRevision",
    "generation",
  ]);
  if (input.ifRevision === undefined)
    throw new VisualModelError("precondition-required", "Forking requires ifRevision");
  checkGuard(model, input);
  const fork = createModel(
    {
      id: input.id,
      title: input.title ?? model.title,
      description: model.description,
      renderer: model.renderer,
      content: model.content,
    },
    context,
    registry,
  );
  fork.source = { id: model.id, revision: model.revision };
  return fork;
}
