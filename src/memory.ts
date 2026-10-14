import type { VisualFamilyResolver } from "./family-resolver.ts";
import { sha256Hex } from "./hash.ts";
import { assertKnownFields, assertVisualJson, assertVisualKey, canonicalVisualJson, modelSummary,
  type VisualCommitReceipt, type VisualModel, VisualModelError, visualModelIdForKey, visualRecord, visualText } from "./model.ts";
import { assertVisualModel, createModel, editModel, forkModel, undoModel, type AuthorContext, type CreateModelInput, type ModelEdit } from "./operations.ts";
import { type VisualUndoRecord, visualCreatedChanges, visualReceiptChanges, visualReceiptSummary } from "./undo.ts";

export type ModelCommand =
  | { type: "create"; key: string; model: Omit<CreateModelInput, "id"> & { id?: string } }
  | { type: "edit"; key: string; id: string; patch: ModelEdit }
  | { type: "undo"; key: string; id: string; operation: string }
  | { type: "fork"; key: string; id: string; fork: { id: string; title?: string; ifRevision: number; generation?: string } };
export interface CommandResult { receipt: VisualCommitReceipt; replayed: boolean; }
export interface ModelStoreSnapshot {
  version: 1;
  models: VisualModel[];
  receipts: VisualCommitReceipt[];
  inverses: VisualUndoRecord[];
}
export interface MemoryStoreOptions {
  registry?: VisualFamilyResolver;
  initial?: ModelStoreSnapshot;
  maxModels?: number;
  maxReceipts?: number;
  maxBytes?: number;
}
export interface CommandContext extends AuthorContext {
  /** Called inside the serialized transaction, including before receipt replay. Read authorization remains the host's job. */
  authorize?(command: ModelCommand, current: VisualModel | undefined): void | Promise<void>;
  signal?: AbortSignal;
}

/**
 * A bounded, single-process reference store. Not a CRDT, database or authorization server.
 * Its snapshot includes receipts and inverses; persist these together, never the models alone.
 */
export class MemoryModelStore {
  readonly #registry: VisualFamilyResolver | undefined;
  readonly #maxModels: number;
  readonly #maxReceipts: number;
  readonly #maxBytes: number;
  #models = new Map<string, VisualModel>();
  #receipts = new Map<string, VisualCommitReceipt>();
  #inverses = new Map<string, VisualUndoRecord>();
  #tail: Promise<void> = Promise.resolve();
  #listeners = new Set<(result: CommandResult) => void>();
  constructor(options: MemoryStoreOptions = {}) {
    this.#registry = options.registry;
    this.#maxModels = options.maxModels ?? 256;
    this.#maxReceipts = options.maxReceipts ?? 4096;
    this.#maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
    for (const limit of [this.#maxModels, this.#maxReceipts, this.#maxBytes])
      if (!Number.isSafeInteger(limit) || limit < 1) throw new VisualModelError("invalid", "Store limits must be positive integers");
    if (options.initial) this.#restore(options.initial);
  }
  get(id: string): VisualModel | undefined {
    const model = this.#models.get(id);
    return model ? structuredClone(model) : undefined;
  }
  list() { return [...this.#models.values()].map((model) => modelSummary(structuredClone(model))); }
  snapshot(): ModelStoreSnapshot {
    return structuredClone({ version: 1, models: [...this.#models.values()], receipts: [...this.#receipts.values()], inverses: [...this.#inverses.values()] });
  }
  subscribe(listener: (result: CommandResult) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
  async execute(input: ModelCommand, context: CommandContext = {}): Promise<CommandResult> {
    assertVisualJson(input);
    if (!visualRecord(input) || !["create", "edit", "undo", "fork"].includes(String(input.type)))
      throw new VisualModelError("invalid", "Unknown model command");
    if (input.type === "create" && !visualRecord(input.model)) throw new VisualModelError("invalid", "Create needs a model object");
    if (input.type !== "create" && typeof input.id !== "string") throw new VisualModelError("invalid", "A model ID is required");
    if (input.type === "edit" && !visualRecord(input.patch)) throw new VisualModelError("invalid", "Edit needs a patch object");
    if (input.type === "fork" && !visualRecord(input.fork)) throw new VisualModelError("invalid", "Fork needs its target and revision");
    const command = structuredClone(input);
    assertVisualKey(command.key);
    const actor = visualText(context.actor ?? "local", "Actor", 128);
    const hash = sha256Hex(canonicalVisualJson({ command, actor }));
    const heldContext = { ...context, actor };
    const work = this.#tail.then(async () => {
      heldContext.signal?.throwIfAborted();
      const id = command.type === "create" ? command.model.id ?? visualModelIdForKey(command.key) : command.id;
      const current = this.#models.get(id);
      // Authority is checked even for a replay, before revealing whether its receipt exists.
      await heldContext.authorize?.(structuredClone(command), current ? structuredClone(current) : undefined);
      heldContext.signal?.throwIfAborted();
      const existing = this.#receipts.get(command.key);
      if (existing) {
        if (existing.hash !== hash) throw new VisualModelError("conflict", "Operation key was used for a different request or actor");
        const { changes: _changes, changesOmitted: _omitted, ...receipt } = existing;
        return { receipt: structuredClone(receipt), replayed: true };
      }
      if (this.#receipts.size >= this.#maxReceipts) throw new VisualModelError("unavailable", "Receipt capacity reached; no retry history was discarded");
      let next: VisualModel;
      let inverse: VisualUndoRecord | undefined;
      let changes: ReturnType<typeof visualCreatedChanges>;
      switch (command.type) {
        case "create": {
          assertKnownFields(command as unknown as Record<string, unknown>, ["type", "key", "model"]);
          if (current) throw new VisualModelError("conflict", "Model ID already exists");
          next = createModel({ ...command.model, id }, heldContext, this.#registry);
          changes = visualCreatedChanges(next, this.#registry);
          break;
        }
        case "edit": {
          assertKnownFields(command as unknown as Record<string, unknown>, ["type", "key", "id", "patch"]);
          if (!current) throw new VisualModelError("not-found", "Model not found");
          const transition = editModel(current, command.patch, heldContext, this.#registry);
          next = transition.model;
          inverse = { key: command.key, id: next.id, generation: next.generation, at: next.updatedAt, identityVersion: 2, changes: transition.changes };
          changes = visualReceiptChanges(transition.changes);
          break;
        }
        case "undo": {
          assertKnownFields(command as unknown as Record<string, unknown>, ["type", "key", "id", "operation"]);
          assertVisualKey(command.operation);
          if (!current) throw new VisualModelError("not-found", "Model not found");
          const original = this.#inverses.get(command.operation);
          if (!original) throw new VisualModelError("not-found", "No reversible edit has that operation key");
          const transition = undoModel(current, original, heldContext, this.#registry);
          next = transition.model;
          inverse = { key: command.key, id: next.id, generation: next.generation, at: next.updatedAt, identityVersion: 2, changes: transition.changes };
          changes = visualReceiptChanges(transition.changes);
          break;
        }
        case "fork": {
          assertKnownFields(command as unknown as Record<string, unknown>, ["type", "key", "id", "fork"]);
          if (!current) throw new VisualModelError("not-found", "Model not found");
          if (this.#models.has(command.fork.id)) throw new VisualModelError("conflict", "Fork model ID already exists");
          next = forkModel(current, command.fork, heldContext, this.#registry);
          changes = visualCreatedChanges(next, this.#registry);
          break;
        }
        default: throw new VisualModelError("invalid", "Unknown model command");
      }
      const receipt: VisualCommitReceipt = { key: command.key, hash, id: next.id, revision: next.revision,
        generation: next.generation, at: next.updatedAt, action: command.type, ...visualReceiptSummary(changes) };
      const models = new Map(this.#models).set(next.id, next);
      if (models.size > this.#maxModels) throw new VisualModelError("unavailable", "Model capacity reached");
      const receipts = new Map(this.#receipts).set(command.key, receipt);
      const inverses = new Map(this.#inverses);
      if (inverse) inverses.set(command.key, inverse);
      this.#checkBytes({ version: 1, models: [...models.values()], receipts: [...receipts.values()], inverses: [...inverses.values()] });
      // One synchronous commit point. No user callback or await can observe a half-commit.
      this.#models = models; this.#receipts = receipts; this.#inverses = inverses;
      const result = { receipt: structuredClone(receipt), replayed: false };
      for (const listener of this.#listeners) {
        try { listener(structuredClone(result)); } catch { /* An observer cannot undo a committed write. */ }
      }
      return result;
    });
    this.#tail = work.then(() => {}, () => {});
    return work;
  }
  #checkBytes(snapshot: ModelStoreSnapshot) {
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > this.#maxBytes)
      throw new VisualModelError("unavailable", "Store byte capacity reached; nothing was committed");
  }
  #restore(initial: ModelStoreSnapshot) {
    if (!visualRecord(initial) || initial.version !== 1 || !Array.isArray(initial.models) || !Array.isArray(initial.receipts) || !Array.isArray(initial.inverses))
      throw new VisualModelError("invalid", "Invalid model store snapshot");
    this.#checkBytes(initial);
    if (initial.models.length > this.#maxModels || initial.receipts.length > this.#maxReceipts || initial.inverses.length > initial.receipts.length)
      throw new VisualModelError("invalid", "Snapshot exceeds store limits");
    for (const model of initial.models) {
      assertVisualModel(model, this.#registry);
      if (this.#models.has(model.id)) throw new VisualModelError("invalid", "Duplicate model in snapshot");
      this.#models.set(model.id, structuredClone(model));
    }
    for (const receipt of initial.receipts) {
      assertVisualJson(receipt); assertVisualKey(receipt.key);
      const model = this.#models.get(receipt.id);
      if (!model || model.generation !== receipt.generation || !/^[a-f0-9]{64}$/.test(receipt.hash) ||
          !Number.isSafeInteger(receipt.revision) || receipt.revision < 1 || receipt.revision > model.revision || this.#receipts.has(receipt.key))
        throw new VisualModelError("invalid", "Invalid receipt in snapshot");
      this.#receipts.set(receipt.key, structuredClone(receipt));
    }
    for (const record of initial.inverses) {
      assertVisualJson(record);
      const receipt = this.#receipts.get(record.key);
      if (!receipt || receipt.id !== record.id || receipt.generation !== record.generation || record.identityVersion !== 2 ||
          !Array.isArray(record.changes) || this.#inverses.has(record.key))
        throw new VisualModelError("invalid", "Invalid undo record in snapshot");
      this.#inverses.set(record.key, structuredClone(record));
    }
  }
}
