import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryModelStore,
  VisualModelError,
  createVisualRegistry,
  VISUAL_FAMILIES,
  type ModelCommand,
  type ModelStoreSnapshot,
} from "../src/index.ts";

const create = (): ModelCommand => ({
  type: "create",
  key: "create",
  model: {
    id: "graph",
    title: "Graph",
    renderer: "diagram",
    content: {
      nodes: [
        { id: "a", label: "App", x: 0, y: 0 },
        { id: "b", label: "Store", x: 200, y: 0 },
      ],
      edges: [{ id: "calls", source: "a", target: "b", label: "calls" }],
    },
  },
});
const edit = (key = "rename"): ModelCommand => ({
  type: "edit",
  id: "graph",
  key,
  patch: {
    items: [{ field: "nodes", set: [{ id: "a", label: "API", expect: { label: "App" } }] }],
  },
});
const context = { actor: "test", at: "2026-10-15T10:00:00Z" };
const code = (expected: string) => (error: unknown) =>
  error instanceof VisualModelError && error.code === expected;
async function seeded() {
  const store = new MemoryModelStore();
  await store.execute(create(), context);
  return store;
}

test("create preview owns a candidate but commits no model, key, inverse or notification", async () => {
  const store = new MemoryModelStore();
  let notifications = 0;
  store.subscribe(() => notifications++);
  const before = store.snapshot();
  const preview = await store.preview(create(), context);
  assert.equal(preview.effect, "none");
  assert.equal(preview.base, null);
  assert.equal(preview.model.revision, 1);
  assert.equal(preview.replayed, false);
  assert.ok(preview.changes.some((change) => change.id === "a" && change.change === "added"));
  assert.deepEqual(store.snapshot(), before);
  assert.equal(notifications, 0);
  const proposedGeneration = preview.model.generation;
  preview.model.title = "caller mutation";
  const committed = await store.execute(create(), context);
  assert.equal(committed.replayed, false);
  assert.equal(notifications, 1);
  assert.equal(store.get("graph")?.title, "Graph");
  assert.notEqual(
    committed.receipt.generation,
    proposedGeneration,
    "Preview lifetimes are not reserved",
  );
});
test("edit preview and commit share changes while a preview never authorizes a later stale write", async () => {
  const store = await seeded();
  const before = store.snapshot();
  const preview = await store.preview(edit(), context);
  assert.equal(preview.base?.revision, 1);
  assert.equal(preview.model.revision, 2);
  assert.deepEqual(store.snapshot(), before);
  const committed = await store.execute(edit(), context);
  assert.deepEqual(committed.receipt.changes, preview.changes);
  await assert.rejects(store.execute(edit("stale"), context), code("conflict"));
  assert.equal(store.getReceipt("stale"), undefined);
});
test("preview exposes cascade removals without touching saved nodes or edges", async () => {
  const store = await seeded();
  const preview = await store.preview(
    {
      type: "edit",
      key: "remove",
      id: "graph",
      patch: { ifRevision: 1, items: [{ field: "nodes", remove: ["b"] }] },
    },
    context,
  );
  assert.deepEqual(preview.model.content.edges, []);
  assert.ok(
    preview.changes.some(
      (change) =>
        change.collection === "edges" && change.id === "calls" && change.change === "removed",
    ),
  );
  assert.equal((store.get("graph")!.content.edges as unknown[]).length, 1);
});
test("undo and fork preview use the same guarded transitions without consuming keys", async () => {
  const store = await seeded();
  await store.execute(edit(), context);
  const before = store.snapshot();
  const undo = await store.preview(
    { type: "undo", id: "graph", key: "undo", operation: "rename" },
    context,
  );
  assert.equal((undo.model.content.nodes as { label: string }[])[0].label, "App");
  const fork = await store.preview(
    { type: "fork", id: "graph", key: "fork", fork: { id: "copy", ifRevision: 2 } },
    context,
  );
  assert.equal(fork.base?.id, "graph");
  assert.equal(fork.model.id, "copy");
  assert.equal(fork.model.source?.revision, 2);
  assert.equal(fork.model.revision, 1);
  assert.deepEqual(store.snapshot(), before);
});
test("preview replay reports current model with no new changes; receipt lookup is an owned historical copy", async () => {
  const store = await seeded();
  await store.execute(edit(), context);
  await store.execute(
    { type: "edit", key: "title", id: "graph", patch: { title: "Updated" } },
    context,
  );
  const preview = await store.preview(edit(), context);
  assert.equal(preview.replayed, true);
  assert.deepEqual(preview.changes, []);
  assert.equal(preview.model.revision, 3);
  const receipt = store.getReceipt("rename")!;
  assert.equal(receipt.revision, 2);
  receipt.revision = 100;
  assert.equal(store.getReceipt("rename")!.revision, 2);
  assert.equal(store.getReceipt("missing"), undefined);
  await assert.rejects(
    store.preview(edit(), { ...context, actor: "someone-else" }),
    code("conflict"),
  );
});
test("preview waits behind pending commits and owns its input before awaiting policy", async () => {
  const store = await seeded();
  let release!: () => void;
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = store.execute(
    { type: "edit", id: "graph", key: "first", patch: { title: "First" } },
    { ...context, authorize: () => pause },
  );
  const command = edit();
  const peek = store.preview(command, context);
  if (command.type === "edit") command.patch = { title: "Mutated" };
  release();
  await write;
  const preview = await peek;
  assert.equal(preview.base?.revision, 2);
  assert.equal(preview.model.title, "First");
  assert.equal(preview.model.revision, 3);
  assert.equal((preview.model.content.nodes as { label: string }[])[0].label, "API");
  assert.equal(store.get("graph")!.revision, 2);
});
test("preview rechecks authorization even for replay and a rejection does not poison the queue", async () => {
  const store = await seeded();
  let called = 0;
  await assert.rejects(
    store.preview(create(), {
      ...context,
      authorize() {
        called++;
        throw new VisualModelError("forbidden", "Revoked");
      },
    }),
    code("forbidden"),
  );
  assert.equal(called, 1);
  assert.equal((await store.preview(edit(), context)).effect, "none");
  await assert.rejects(store.preview(edit(), { ...context, signal: AbortSignal.abort() }));
  assert.equal((await store.execute(edit(), context)).replayed, false);
});
test("preview enforces actual store limits and custom registry without retaining work", async () => {
  const store = new MemoryModelStore({ maxReceipts: 1 });
  await store.execute(create(), context);
  await assert.rejects(store.preview(edit(), context), code("unavailable"));
  assert.equal((await store.preview(create(), context)).replayed, true);
  const tiny = new MemoryModelStore({ maxBytes: 100 });
  await assert.rejects(tiny.preview(create(), context), code("unavailable"));
  assert.deepEqual(tiny.snapshot().models, []);
  const family = { ...VISUAL_FAMILIES.find((f) => f.id === "diagram")!, id: "custom-graph" };
  const custom = new MemoryModelStore({ registry: createVisualRegistry([family]) });
  const command = create();
  if (command.type === "create") command.model.renderer = family.id;
  assert.equal((await custom.preview(command, context)).model.renderer, family.id);
});
test("notification subscribers may re-register or add listeners without reentrant delivery", async () => {
  const store = new MemoryModelStore();
  let calls = 0,
    late = 0;
  let stop = () => {};
  const listener = () => {
    calls++;
    stop();
    if (calls < 3) stop = store.subscribe(listener);
    store.subscribe(() => late++);
  };
  stop = store.subscribe(listener);
  await store.execute(create(), context);
  assert.equal(calls, 1);
  assert.equal(late, 0);
  await store.execute(edit(), context);
  assert.equal(calls, 2);
  assert.equal(late, 1);
});
test("untrusted snapshots cannot invoke accessors before validation", () => {
  let calls = 0;
  const snapshot = Object.defineProperty({}, "version", {
    enumerable: true,
    get() {
      calls++;
      return 1;
    },
  });
  assert.throws(
    () => new MemoryModelStore({ initial: snapshot as ModelStoreSnapshot }),
    code("invalid"),
  );
  assert.equal(calls, 0);
  for (const initial of [null, false, 0, ""])
    assert.throws(
      () => new MemoryModelStore({ initial: initial as unknown as ModelStoreSnapshot }),
      code("invalid"),
    );
});
test("abort requested by a synchronous lifetime callback is honored before publication", async () => {
  const store = new MemoryModelStore();
  const abort = new AbortController();
  await assert.rejects(
    store.execute(create(), {
      ...context,
      signal: abort.signal,
      mint() {
        abort.abort();
        return crypto.randomUUID();
      },
    }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(store.get("graph"), undefined);
  assert.equal(store.getReceipt("create"), undefined);
});

test("aggregate snapshots retain the store byte budget without relaxing each model's own limit", async () => {
  const saved = (await seeded()).get("graph")!;
  const initial: ModelStoreSnapshot = {
    version: 1,
    models: [
      { ...saved, id: "large-a", hostNote: "x".repeat(1_050_000) },
      { ...saved, id: "large-b", hostNote: "y".repeat(1_050_000) },
    ] as ModelStoreSnapshot["models"],
    receipts: [],
    inverses: [],
  };
  assert.ok(JSON.stringify(initial).length > 2_000_000);
  assert.equal(new MemoryModelStore({ initial }).list().length, 2);
  (initial.models[0] as unknown as { hostNote: string }).hostNote = "x".repeat(2_000_000);
  assert.throws(() => new MemoryModelStore({ initial }), code("invalid"));
});
