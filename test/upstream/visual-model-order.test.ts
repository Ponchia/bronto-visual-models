import assert from "node:assert/strict";
import test from "node:test";
import {
  applyVisualUndo,
  type VisualModel,
  type VisualUndoRecord,
  visualUndoChanges,
} from "../../src/index.ts";

const original = (): VisualModel => ({
  schemaVersion: 2,
  id: "sequence",
  generation: "generation",
  revision: 1,

  title: "Sequence",
  description: "",
  modelType: "infographic",
  renderer: "infographic",
  role: "model",
  status: "active",
  createdAt: "now",
  updatedAt: "now",
  createdBy: "test",
  updatedBy: "test",
  content: {
    items: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ],
  },
});
const inverse = (a: VisualModel, b: VisualModel): VisualUndoRecord => ({
  key: "reorder",
  id: a.id,
  generation: a.generation,
  identityVersion: 2,
  at: "now",
  changes: visualUndoChanges(a, b),
});
test("order-only undo restores sequence and preserves disjoint labels and insertions", () => {
  const before = original(),
    after = original();
  (after.content.items as unknown[]).reverse();
  const record = inverse(before, after);
  assert.equal(record.changes.length, 1);
  const current = structuredClone(after);
  const rows = current.content.items as Array<{ id: string; label: string }>;
  const row = rows[0];
  assert.ok(row);
  row.label = "C updated";
  rows.splice(1, 0, { id: "extra", label: "Later insertion" });
  const restored = applyVisualUndo(current, record).content.items as typeof rows;
  assert.deepEqual(
    restored.map((x) => x.id),
    ["a", "extra", "b", "c"],
  );
  assert.equal(restored[3]?.label, "C updated");
});
test("order undo refuses a later reorder without changing input", () => {
  const before = original(),
    after = original();
  (after.content.items as unknown[]).reverse();
  const current = original();
  const snapshot = structuredClone(current);
  assert.throws(() => applyVisualUndo(current, inverse(before, after)), /collection order/);
  assert.deepEqual(current, snapshot);
});
test("order and membership undo restore the complete original sequence", () => {
  const before = original(),
    after = original();
  after.content.items = [
    { id: "c", label: "C" },
    { id: "a", label: "A" },
    { id: "d", label: "D" },
  ];
  assert.deepEqual(applyVisualUndo(after, inverse(before, after)).content, before.content);
});
