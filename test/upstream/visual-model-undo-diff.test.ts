import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { type VisualModel, visualUndoChanges } from "../../src/index.ts";

// A graph at the renderer's ceiling: 300 nodes and 600 edges, every record with a lifetime.
function ceiling(): VisualModel {
  const nodes = Array.from({ length: 300 }, (_, i) => ({
    id: `n${i}`,
    label: `Component ${i}`,
    description: "A reasonably descriptive sentence about this component and its role.",
    x: (i % 20) * 240,
    y: Math.floor(i / 20) * 160,
    width: 180,
    height: 90,
  }));
  const edges = Array.from({ length: 600 }, (_, i) => ({
    id: `e${i}`,
    label: "depends on",
    source: `n${i % 300}`,
    target: `n${(i * 7 + 1) % 300}`,
  }));
  const lifetimes = (rows: readonly { id: string }[]) =>
    Object.fromEntries(rows.map((row) => [row.id, `incarnation-${row.id}-000000`]));
  return {
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
    content: { nodes, edges, direction: "RIGHT" },
    elementIncarnations: { nodes: lifetimes(nodes), edges: lifetimes(edges) },
  };
}

test("an inverse copies only the values its changes record, however large the model", () => {
  const before = ceiling();
  const after = structuredClone(before);
  const renamed = (after.content.nodes as Array<{ label: string }>)[5];
  assert.ok(renamed);
  renamed.label = "Renamed";
  const original = globalThis.structuredClone;
  let copies = 0;
  globalThis.structuredClone = ((
    value: unknown,
    options?: Parameters<typeof structuredClone>[1],
  ) => {
    copies += 1;
    return original(value, options);
  }) as typeof structuredClone;
  let changes: ReturnType<typeof visualUndoChanges>;
  try {
    changes = visualUndoChanges(before, after);
  } finally {
    globalThis.structuredClone = original;
  }
  assert.deepEqual(changes, [
    {
      field: "label",
      collection: "nodes",
      id: "n5",
      incarnation: "incarnation-n5-000000",
      before: { present: true, value: "Component 5" },
      after: { present: true, value: "Renamed" },
    },
  ]);
  // One before and one after, not a copy of every compared field.
  assert.ok(copies <= 2, `${copies} copies for one changed field`);
});

test("an inverse records each kind of change, and its values are its own", () => {
  const before = ceiling();
  const after = structuredClone(before);
  const nodes = after.content.nodes as Array<Record<string, unknown> & { id: string }>;
  const lifetimes = after.elementIncarnations?.nodes as Record<string, string>;
  const style = { tone: "accent" };
  after.title = "Graph, revised";
  after.content.direction = "DOWN";
  nodes.splice(1, 1); // n1 leaves
  nodes.push({ id: "n300", label: "Added", x: 0, y: 0 });
  nodes.splice(3, 2, ...nodes.slice(3, 5).reverse()); // n5 now precedes n4
  Object.assign(nodes[0] ?? {}, { style });
  delete lifetimes.n1;
  lifetimes.n300 = "incarnation-n300-000000";
  const changes = visualUndoChanges(before, after);
  const summary = changes.map(({ field, collection, id, order, identity, before, after }) => ({
    field,
    collection,
    id,
    order,
    identity,
    before: before.present,
    after: after.present,
  }));
  assert.deepEqual(
    summary.map((entry) => JSON.stringify(entry)),
    [
      { field: "title", before: true, after: true },
      { field: "n1", collection: "nodes", id: "n1", identity: true, before: true, after: false },
      {
        field: "n300",
        collection: "nodes",
        id: "n300",
        identity: true,
        before: false,
        after: true,
      },
      { field: "", collection: "nodes", order: true, before: true, after: true },
      { field: "style", collection: "nodes", id: "n0", before: false, after: true },
      { field: "", collection: "nodes", id: "n1", before: true, after: false },
      { field: "", collection: "nodes", id: "n300", before: false, after: true },
      { field: "direction", collection: "content", before: true, after: true },
    ].map((entry) => JSON.stringify(entry)),
  );
  // The recorded values are copies: changing the model afterwards leaves the inverse intact.
  const styled = changes.find((change) => change.field === "style");
  style.tone = "danger";
  assert.deepEqual(styled?.after, { present: true, value: { tone: "accent" } });
  assert.deepEqual(visualUndoChanges(before, structuredClone(before)), []);
});

// Each inverse, byte for byte, as the diff wrote it before it stopped copying every field.
const PINNED: Record<string, (after: VisualModel) => void> = {
  "one label": (after) => {
    const nodes = after.content.nodes as Array<Record<string, unknown>>;
    Object.assign(nodes[5] ?? {}, { label: "Renamed" });
  },
  "a node and its edges leave": (after) => {
    const content = after.content as {
      nodes: Array<{ id: string }>;
      edges: Array<{ id: string; source: string; target: string }>;
    };
    content.nodes = content.nodes.filter((node) => node.id !== "n7");
    content.edges = content.edges.filter((edge) => edge.source !== "n7" && edge.target !== "n7");
    for (const kind of ["nodes", "edges"] as const) {
      const lifetimes = after.elementIncarnations?.[kind] ?? {};
      for (const id of Object.keys(lifetimes))
        if (!content[kind].some((row) => row.id === id)) delete lifetimes[id];
    }
  },
  "edges rewired and reordered": (after) => {
    const edges = after.content.edges as Array<Record<string, unknown>>;
    for (const edge of edges.slice(0, 40)) edge.target = "n0";
    edges.reverse();
  },
  "a record replaced under its id": (after) => {
    const lifetimes = after.elementIncarnations?.nodes as Record<string, string>;
    lifetimes.n9 = "incarnation-n9-000001";
    Object.assign((after.content.nodes as Array<Record<string, unknown>>)[9] ?? {}, { x: 1, y: 2 });
  },
};

const PINNED_DIGESTS = {
  "one label": "54e5cad37304cbd6",
  "a node and its edges leave": "2fdafc526b8d7bca",
  "edges rewired and reordered": "ffeac66241e22fc1",
  "a record replaced under its id": "4635d840ad3a33f7",
};

test("each inverse is byte-identical to the one the diff wrote before", () => {
  const digests = Object.fromEntries(
    Object.entries(PINNED).map(([name, edit]) => {
      const before = ceiling();
      const after = structuredClone(before);
      edit(after);
      const bytes = JSON.stringify(visualUndoChanges(before, after));
      return [name, createHash("sha256").update(bytes).digest("hex").slice(0, 16)];
    }),
  );
  assert.deepEqual(digests, PINNED_DIGESTS);
});
