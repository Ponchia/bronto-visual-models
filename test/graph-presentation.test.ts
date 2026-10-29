import assert from "node:assert/strict";
import test from "node:test";
import {
  createModel,
  editModel,
  GRAPH_SHAPES,
  GRAPH_TONES,
  GRAPH_EDGE_LINES,
  VisualModelError,
} from "../src/index.ts";
import { createVisualRegistry, VISUAL_FAMILIES } from "../src/index.ts";
import { MemoryModelStore } from "../src/index.ts";

const initial = {
  nodes: [
    { id: "api", label: "API", x: 0, y: 0, shape: "rounded", tone: "accent" },
    { id: "db", label: "Database", x: 280, y: 0, shape: "database", tone: "info" },
  ],
  edges: [
    {
      id: "storage",
      label: "writes",
      source: "api",
      target: "db",
      line: "dashed",
      tone: "warning",
    },
  ],
};

test("validated diagram appearance survives editing, undo and snapshot restore", async () => {
  const store = new MemoryModelStore();
  await store.execute({
    type: "create",
    key: "graph-style-create",
    model: { id: "graph-style", title: "Data flow", renderer: "diagram", content: initial },
  });
  const saved = store.get("graph-style")!;
  assert.equal(saved.rendererVersion, 2);
  assert.deepEqual(saved.content, initial);
  await store.execute({
    type: "edit",
    key: "graph-style-edit",
    id: saved.id,
    patch: {
      items: [
        { field: "nodes", set: [{ id: "api", shape: "pill", expect: { shape: "rounded" } }] },
        { field: "edges", set: [{ id: "storage", line: "dotted", expect: { line: "dashed" } }] },
      ],
    },
  });
  const reloaded = new MemoryModelStore({ initial: store.snapshot() });
  assert.equal(reloaded.get("graph-style")!.content.nodes[0].shape, "pill");
  assert.equal(reloaded.get("graph-style")!.content.edges[0].line, "dotted");
  await reloaded.execute({
    type: "undo",
    id: saved.id,
    key: "graph-style-undo",
    operation: "graph-style-edit",
  });
  assert.deepEqual(reloaded.get("graph-style")!.content, initial);
});

test("appearance is a closed vocabulary; arbitrary styling and HTML are not executable schema", () => {
  const model = (value: unknown) =>
    createModel({
      id: "graph",
      title: "Graph",
      renderer: "diagram",
      content: value as Record<string, unknown>,
    });
  for (const shape of GRAPH_SHAPES)
    assert.doesNotThrow(() =>
      model({ ...initial, nodes: [{ ...initial.nodes[0], shape }, initial.nodes[1]] }),
    );
  for (const tone of GRAPH_TONES)
    assert.doesNotThrow(() =>
      model({ ...initial, nodes: [{ ...initial.nodes[0], tone }, initial.nodes[1]] }),
    );
  for (const line of GRAPH_EDGE_LINES)
    assert.doesNotThrow(() => model({ ...initial, edges: [{ ...initial.edges[0], line }] }));
  for (const bad of [
    { ...initial, nodes: [{ ...initial.nodes[0], shape: "svg" }, initial.nodes[1]] },
    {
      ...initial,
      nodes: [
        { ...initial.nodes[0], style: { background: "url(https://example.org)" } },
        initial.nodes[1],
      ],
    },
    { ...initial, nodes: [{ ...initial.nodes[0], tone: "javascript:alert(1)" }, initial.nodes[1]] },
    { ...initial, edges: [{ ...initial.edges[0], line: "url(https://example.org)" }] },
  ])
    assert.throws(
      () => model(bad),
      (error) => error instanceof VisualModelError && error.code === "invalid",
    );
});

test("older renderer versions read and edit, while new ones refuse older builds", () => {
  const original = createModel({
    id: "graph",
    title: "Graph",
    renderer: "diagram",
    content: { nodes: [{ id: "api", label: "API", x: 0, y: 0 }], edges: [] },
  });
  const old = { ...original, rendererVersion: 1 };
  const revision = editModel(old, {
    items: [{ field: "nodes", set: [{ id: "api", shape: "database", expect: { shape: null } }] }],
  }).model;
  assert.equal(revision.rendererVersion, 2);
  const v1 = createVisualRegistry(
    VISUAL_FAMILIES.map((family) => (family.id === "diagram" ? { ...family, version: 1 } : family)),
  );
  assert.throws(
    () => editModel(revision, { title: "Old reader" }, {}, v1),
    (error) => error instanceof VisualModelError && error.code === "invalid",
  );
});
