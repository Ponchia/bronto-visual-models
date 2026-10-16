import assert from "node:assert/strict";
import { MemoryModelStore, modelTargets } from "@ponchia/visual-models";

// Synthetic data, one process, no server, account or visualization peers.
const store = new MemoryModelStore();
await store.execute({
  type: "create",
  key: "create-orders",
  model: {
    id: "orders",
    title: "Order service",
    renderer: "diagram",
    content: { nodes: [{ id: "api", label: "API", x: 20, y: 20 }], edges: [] },
  },
});
const edit = {
  type: "edit",
  key: "rename-api",
  id: "orders",
  patch: {
    items: [
      { field: "nodes", set: [{ id: "api", label: "Orders API", expect: { label: "API" } }] },
    ],
  },
};
const preview = await store.preview(edit);
assert.equal(preview.effect, "none");
assert.equal(modelTargets(store.get("orders"))[0].label, "API");
await store.execute(edit);
const retry = await store.execute(edit);
assert.equal(retry.replayed, true);
assert.equal(modelTargets(store.get("orders"))[0].label, "Orders API");
await assert.rejects(store.execute({ ...edit, key: "stale-edit" }));
await store.execute({ type: "undo", id: "orders", key: "undo-rename", operation: "rename-api" });
assert.equal(modelTargets(store.get("orders"))[0].label, "API");
console.log(
  JSON.stringify(
    {
      created: true,
      previewDidNotWrite: true,
      retryReplayed: true,
      staleEditRefused: true,
      undoRestoredLabel: true,
    },
    null,
    2,
  ),
);
