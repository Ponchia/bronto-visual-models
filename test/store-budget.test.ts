import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryModelStore,
  type ModelCommand,
  type ModelStoreSnapshot,
  VisualModelError,
} from "../src/index.ts";

const context = { actor: "byte-budget", at: "2026-10-15T10:00:00Z" };
const size = (snapshot: ModelStoreSnapshot) =>
  new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
const source = (id: string, key = `create-${id}`): ModelCommand => ({
  type: "create",
  key,
  model: {
    id,
    title: `Graph ${id}`,
    renderer: "diagram",
    content: {
      nodes: [{ id: "start", label: "Entry", x: 0, y: 0 }],
      edges: [],
    },
  },
});
const sequence: ModelCommand[] = [
  source("alpha"),
  source("beta"),
  {
    type: "edit",
    id: "alpha",
    key: "rename-alpha",
    patch: { title: "Spatial graphs: café, 日本語 and 🛰️" },
  },
  {
    type: "edit",
    id: "beta",
    key: "edit-beta",
    patch: { items: [{ field: "nodes", set: [{ id: "start", label: "🔎 A much longer title" }] }] },
  },
  {
    type: "fork",
    id: "alpha",
    key: "fork-alpha",
    fork: { id: "gamma", ifRevision: 2 },
  },
  { type: "undo", id: "alpha", key: "undo-alpha", operation: "rename-alpha" },
];

test("the incremental byte budget matches an independent full UTF-8 snapshot after each command", async () => {
  const store = new MemoryModelStore();
  for (const command of sequence) {
    const before = store.snapshot();
    await store.execute(command, context);
    const after = store.snapshot();
    const expected = size(after);
    assert.ok(expected > size(before), `Test command ${command.key} must grow the snapshot`);

    // A second store must admit the *exact* number of bytes the next commit writes.
    // UUID lifetimes have fixed byte length; all authored timestamps are pinned.
    const exact = new MemoryModelStore({ initial: before, maxBytes: expected });
    await exact.execute(command, context);
    assert.equal(size(exact.snapshot()), expected, command.key);
    assert.equal(
      new MemoryModelStore({ initial: exact.snapshot(), maxBytes: expected }).list().length,
      exact.list().length,
    );

    // One byte below the final size must reject without publishing a receipt,
    // mutating a model, or consuming the byte budget for a future transaction.
    const insufficient = new MemoryModelStore({ initial: before, maxBytes: expected - 1 });
    let notified = false;
    insufficient.subscribe(() => {
      notified = true;
    });
    await assert.rejects(
      insufficient.execute(command, context),
      (error: unknown) => error instanceof VisualModelError && error.code === "unavailable",
      command.key,
    );
    assert.equal(notified, false);
    assert.deepEqual(insufficient.snapshot(), before);
    assert.equal(insufficient.getReceipt(command.key), undefined);
  }
});

test("preview and replay do not consume capacity; failed updates do not skew later accounting", async () => {
  const reference = new MemoryModelStore();
  await reference.execute(source("alpha"), context);
  const before = reference.snapshot();
  const edit: ModelCommand = {
    type: "edit",
    id: "alpha",
    key: "first-edit",
    patch: { title: "Larger: ☃️ 汉字" },
  };
  await reference.execute(edit, context);
  const exactSize = size(reference.snapshot());

  const store = new MemoryModelStore({ initial: before, maxBytes: exactSize });
  const preview = await store.preview(edit, context);
  assert.equal(preview.effect, "none");
  assert.deepEqual(store.snapshot(), before);
  await assert.rejects(
    store.execute(
      { type: "edit", id: "alpha", key: "oversize", patch: { title: "x".repeat(230) } },
      context,
    ),
    (error: unknown) => error instanceof VisualModelError && error.code === "unavailable",
  );
  assert.deepEqual(store.snapshot(), before);
  await store.execute(edit, context);
  const committed = store.snapshot();
  assert.equal(size(committed), exactSize);
  assert.equal((await store.execute(edit, context)).replayed, true);
  assert.deepEqual(store.snapshot(), committed);
});
