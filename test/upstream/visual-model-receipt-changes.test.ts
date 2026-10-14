import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_VISUAL_RECEIPT_CHANGES,
  type VisualModel,
  visualCreatedChanges,
  visualReceiptChanges,
  visualReceiptSummary,
  visualUndoChanges,
} from "../../src/index.ts";

const graph = (patch: Partial<VisualModel> = {}): VisualModel => ({
  schemaVersion: 2,
  id: "graph",
  generation: "generation-one",
  revision: 1,
  
  title: "Graph",
  description: "",
  modelType: "graph",
  renderer: "diagram",
  rendererVersion: 1,
  role: "model",
  status: "active",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  createdBy: "test",
  updatedBy: "test",
  content: {
    nodes: [
      { id: "a", label: "A", x: 0, y: 0 },
      { id: "b", label: "B", x: 300, y: 0 },
      { id: "c", label: "C", x: 600, y: 0 },
    ],
    edges: [],
  },
  elementIncarnations: {
    nodes: { a: "incarnation-a-0001", b: "incarnation-b-0001", c: "incarnation-c-0001" },
  },
  ...patch,
});

test("a receipt names what an edit changed, one entry per record", () => {
  const before = graph();
  const after = graph({
    title: "Renamed",
    content: {
      nodes: [
        { id: "a", label: "A", x: 0, y: 0 },
        { id: "c", label: "C moved", x: 650, y: 40 },
        { id: "b", label: "B", x: 300, y: 0 },
        { id: "d", label: "D", x: 900, y: 0 },
      ],
      edges: [],
      direction: "DOWN",
    },
    elementIncarnations: {
      nodes: {
        a: "incarnation-a-0002",
        b: "incarnation-b-0001",
        c: "incarnation-c-0001",
        d: "incarnation-d-0001",
      },
    },
  });
  assert.deepEqual(visualReceiptChanges(visualUndoChanges(before, after)), [
    { collection: "model", change: "updated", fields: ["title"] },
    { collection: "nodes", id: "a", change: "replaced" },
    { collection: "nodes", id: "d", change: "added" },
    { collection: "nodes", change: "ordered" },
    { collection: "nodes", id: "c", change: "updated", fields: ["label", "x", "y"] },
    { collection: "content", change: "updated", fields: ["direction"] },
  ]);
  const removed = graph({
    content: { nodes: [{ id: "a", label: "A", x: 0, y: 0 }], edges: [] },
    elementIncarnations: { nodes: { a: "incarnation-a-0001" } },
  });
  assert.deepEqual(visualReceiptChanges(visualUndoChanges(before, removed)), [
    { collection: "nodes", id: "b", change: "removed" },
    { collection: "nodes", id: "c", change: "removed" },
  ]);
});

test("a record whose id names a change kind stays its own entry", () => {
  // Record ids are free text: "ordered" and "updated" are ids like any other.
  const before = graph({
    content: {
      nodes: [
        { id: "ordered", label: "O", x: 0, y: 0 },
        { id: "updated", label: "U", x: 300, y: 0 },
      ],
      edges: [],
    },
    elementIncarnations: {
      nodes: { ordered: "incarnation-o-0001", updated: "incarnation-u-0001" },
    },
  });
  const after = graph({
    content: {
      nodes: [
        { id: "updated", label: "U", x: 300, y: 0 },
        { id: "ordered", label: "O moved", x: 0, y: 0 },
      ],
      edges: [],
      direction: "DOWN",
    },
    elementIncarnations: before.elementIncarnations,
  });
  assert.deepEqual(visualReceiptChanges(visualUndoChanges(before, after)), [
    { collection: "nodes", change: "ordered" },
    { collection: "nodes", id: "ordered", change: "updated", fields: ["label"] },
    { collection: "content", change: "updated", fields: ["direction"] },
  ]);
  const content = graph({
    content: { nodes: [], edges: [], direction: "DOWN" },
    elementIncarnations: {},
  });
  const renamed = graph({
    content: { nodes: [{ id: "updated", label: "U", x: 0, y: 0 }], edges: [], direction: "UP" },
    elementIncarnations: { nodes: { updated: "incarnation-u-0001" } },
  });
  assert.deepEqual(visualReceiptChanges(visualUndoChanges(content, renamed)), [
    { collection: "nodes", id: "updated", change: "added" },
    { collection: "content", change: "updated", fields: ["direction"] },
  ]);
});

test("a created model's receipt lists its records without diffing them", () => {
  assert.deepEqual(
    visualCreatedChanges(graph({ content: { ...graph().content, direction: "DOWN" } })),
    [
      { collection: "nodes", id: "a", change: "added" },
      { collection: "nodes", id: "b", change: "added" },
      { collection: "nodes", id: "c", change: "added" },
      { collection: "content", change: "updated", fields: ["direction"] },
    ],
  );
});

test("a long change list keeps its first entries and counts the rest", () => {
  const nodes = Array.from({ length: MAX_VISUAL_RECEIPT_CHANGES + 7 }, (_, index) => ({
    id: `n${index}`,
    label: `N${index}`,
    x: index * 10,
    y: 0,
  }));
  const all = visualCreatedChanges(graph({ content: { nodes, edges: [] } }));
  const summary = visualReceiptSummary(all);
  assert.deepEqual(summary.changes, all.slice(0, MAX_VISUAL_RECEIPT_CHANGES));
  assert.equal(summary.changesOmitted, 7);
  assert.deepEqual(visualReceiptSummary(all.slice(0, 2)), { changes: all.slice(0, 2) });
});
