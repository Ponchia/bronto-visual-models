import assert from "node:assert/strict";
import test from "node:test";
import type { ElkNode } from "elkjs";
import {
  createModel,
  editModel,
  MemoryModelStore,
  VisualModelError,
  type GraphContent,
} from "../src/index.ts";
import { layoutDiagram } from "../src/layout/elk.ts";
import { graphPorts, graphEdgeHandles } from "../src/render/graph-ports.ts";

const graph = (): GraphContent => ({
  nodes: [
    { id: "a", label: "Entry", x: 300, y: 300 },
    { id: "b", label: "Service", x: 300, y: 300, width: 220, height: 100 },
    { id: "c", label: "Database", x: 300, y: 300 },
    { id: "d", label: "Disconnected", x: 300, y: 300 },
  ],
  edges: [
    { id: "ab", label: "requests", source: "a", target: "b" },
    { id: "bc", label: "stores", source: "b", target: "c" },
  ],
});
const model = (content = graph()) =>
  createModel({
    id: "graph",
    title: "Private title",
    renderer: "diagram",
    content: content as unknown as Record<string, unknown>,
  });
const refusal = (error: unknown) => error instanceof VisualModelError;
function stub(root: ElkNode): ElkNode {
  const place = (node: ElkNode, index: number): ElkNode => ({
    ...node,
    x: index * 280 + 24,
    y: 68,
    ...(node.children ? { children: node.children.map(place) } : {}),
  });
  return { ...root, width: 1200, height: 500, children: root.children?.map(place) };
}
for (const direction of ["RIGHT", "DOWN"] as const) {
  test(`ELK ${direction} proposal separates nodes without mutating content or identity`, async () => {
    const before = model();
    const bytes = JSON.stringify(before);
    const proposal = await layoutDiagram(before, { direction });
    assert.equal(JSON.stringify(before), bytes);
    assert.deepEqual(proposal.base, {
      id: before.id,
      renderer: "diagram",
      generation: before.generation,
      revision: 1,
    });
    assert.equal(proposal.patch.ifRevision, 1);
    const after = editModel(before, proposal.patch).model;
    assert.deepEqual(after.content.edges, before.content.edges);
    assert.deepEqual(after.elementIncarnations, before.elementIncarnations);
    const nodes = after.content.nodes as GraphContent["nodes"];
    const a = nodes.find((n) => n.id === "a")!,
      b = nodes.find((n) => n.id === "b")!;
    assert(direction === "RIGHT" ? b.x > a.x : b.y > a.y);
    assert.equal(b.width, 220);
    assert.equal(b.height, 100);
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const x = nodes[i]!,
          y = nodes[j]!;
        assert(
          x.x + (x.width ?? 180) <= y.x ||
            y.x + (y.width ?? 180) <= x.x ||
            x.y + (x.height ?? 90) <= y.y ||
            y.y + (y.height ?? 90) <= x.y,
          `overlap ${x.id}/${y.id}`,
        );
      }
  });
}
test("layout can be previewed, committed, undone and refuses stale topology", async () => {
  const store = new MemoryModelStore();
  await store.execute({
    type: "create",
    key: "create",
    model: {
      id: "graph",
      title: "Example",
      renderer: "diagram",
      content: graph() as unknown as Record<string, unknown>,
    },
  });
  const before = store.get("graph")!;
  const { patch } = await layoutDiagram(before);
  const command = { type: "edit" as const, key: "arrange", id: "graph", patch };
  assert.equal((await store.preview(command)).effect, "none");
  assert.equal(store.get("graph")!.revision, 1);
  await store.execute(command);
  await store.execute({ type: "undo", key: "undo", id: "graph", operation: "arrange" });
  assert.deepEqual(store.get("graph")!.content, before.content);
  await assert.rejects(
    store.execute({ ...command, key: "stale" }),
    (error: any) => error.code === "conflict",
  );
});
test("groups retain parent identities, relative child coordinates and room for headings", async () => {
  const content = graph();
  content.nodes.push({ id: "group", label: "A group", group: true, x: 0, y: 0 });
  content.nodes[0]!.parentId = "group";
  content.nodes[1]!.parentId = "group";
  const before = model(content);
  const after = editModel(before, (await layoutDiagram(before)).patch).model;
  const nodes = after.content.nodes as GraphContent["nodes"];
  const group = nodes.find((n) => n.id === "group")!;
  for (const child of nodes.filter((n) => n.parentId === "group")) {
    assert(child.x >= 24);
    assert(child.y >= 68);
    assert(child.x + (child.width ?? 180) <= group.width!);
    assert(child.y + (child.height ?? 90) <= group.height!);
  }
  assert.deepEqual(after.content.edges, content.edges);
});
test("cycles, parallel edges and self-links remain semantic edges after layout", async () => {
  const content = graph();
  content.edges.push(
    { id: "back", label: "returns", source: "c", target: "a" },
    { id: "parallel", label: "also", source: "a", target: "b" },
    { id: "self", label: "retries", source: "a", target: "a" },
  );
  const before = model(content);
  const proposal = await layoutDiagram(before);
  assert.equal(proposal.edgeCount, 5);
  assert.deepEqual(editModel(before, proposal.patch).model.content.edges, content.edges);
});
test("explicit ports are supplied to ELK and preserved in the saved model", async () => {
  const content = graph();
  content.nodes[0]!.ports = [
    { id: "out-a", side: "bottom" },
    { id: "out-b", side: "bottom" },
  ];
  content.edges[0]!.sourcePort = "out-b";
  const before = model(content);
  let captured: ElkNode | undefined;
  const proposal = await layoutDiagram(
    before,
    { direction: "DOWN" },
    {
      engine: {
        layout: async (root) => {
          captured = structuredClone(root);
          return stub(root);
        },
      },
    },
  );
  assert.equal(captured!.children![0]!.ports![1]!.layoutOptions!["elk.port.side"], "SOUTH");
  assert.equal(captured!.edges![0]!.sources[0], captured!.children![0]!.ports![1]!.id);
  assert(!JSON.stringify(captured).includes("Private title"));
  assert(!JSON.stringify(captured).includes("requests"));
  assert.deepEqual(editModel(before, proposal.patch).model.content.nodes![0], {
    ...content.nodes[0],
    x: 24,
    y: 68,
  });
});
test("inputs are captured before waiting for the runner", async () => {
  const before = model();
  let release!: (root: ElkNode) => void;
  let root!: ElkNode;
  const pending = layoutDiagram(
    before,
    {},
    {
      engine: {
        layout: async (input) => {
          root = input;
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      },
    },
  );
  before.content.nodes = [];
  release(stub(root));
  assert.equal((await pending).nodeCount, 4);
});
test("aborted work never yields an applyable proposal", async () => {
  const controller = new AbortController();
  let calls = 0;
  const engine = {
    layout: async (root: ElkNode) => {
      calls++;
      controller.abort();
      return stub(root);
    },
  };
  await assert.rejects(layoutDiagram(model(), {}, { engine, signal: controller.signal }));
  assert.equal(calls, 1);
  await assert.rejects(layoutDiagram(model(), {}, { engine, signal: controller.signal }));
  assert.equal(calls, 1);
});
for (const [name, bad] of [
  ["missing node", (r: ElkNode) => ({ ...r, children: r.children!.slice(1) })],
  [
    "unknown node",
    (r: ElkNode) => ({
      ...r,
      children: [...r.children!, { id: "alien", x: 0, y: 0, width: 180, height: 90 }],
    }),
  ],
  ["duplicate node", (r: ElkNode) => ({ ...r, children: [r.children![0]!, ...r.children!] })],
  [
    "out-of-range geometry",
    (r: ElkNode) => {
      r.children![0]!.x = Infinity;
      return r;
    },
  ],
  [
    "changed leaf size",
    (r: ElkNode) => {
      r.children![0]!.width = 500;
      return r;
    },
  ],
  [
    "wrong hierarchy",
    (r: ElkNode) => {
      r.children![0]!.children = [r.children!.pop()!];
      return r;
    },
  ],
  ["null result", () => null as unknown as ElkNode],
] as const)
  test(`invalid engine result: ${name} cannot become authored state`, async () => {
    const before = model(),
      bytes = JSON.stringify(before);
    await assert.rejects(
      layoutDiagram(before, {}, { engine: { layout: async (r) => bad(stub(r)) } }),
      refusal,
    );
    assert.equal(JSON.stringify(before), bytes);
  });
test("unsupported inputs and options refuse before invoking an engine", async () => {
  let calls = 0;
  const engine = {
    layout: async (r: ElkNode) => {
      calls++;
      return stub(r);
    },
  };
  for (const options of [
    null,
    { spacing: 1 },
    { layerSpacing: Infinity },
    { direction: "UP" },
    { remote: true },
  ])
    await assert.rejects(layoutDiagram(model(), options as any, { engine }), refusal);
  await assert.rejects(layoutDiagram(model({ nodes: [], edges: [] }), {}, { engine }), refusal);
  const snapshot = { ...model(), role: "snapshot" as const };
  await assert.rejects(layoutDiagram(snapshot, {}, { engine }), refusal);
  assert.equal(calls, 0);
});
test("same source and options produce the same geometry", async () => {
  const before = model();
  assert.deepEqual((await layoutDiagram(before)).patch, (await layoutDiagram(before)).patch);
});
test("all implicit port sides render; custom ports on the same side are distributed", () => {
  assert.deepEqual(
    graphPorts({}).map((p) => p.id),
    ["top", "right", "bottom", "left"],
  );
  const custom = graphPorts({
    ports: [
      { id: "a", side: "right" },
      { id: "b", side: "right" },
    ],
  });
  assert.deepEqual(
    custom.map((p) => p.offset),
    [1 / 3, 2 / 3],
  );
  const content = graph();
  assert.deepEqual(graphEdgeHandles(content, content.edges[0]!, "DOWN"), {
    source: "bottom",
    target: "top",
  });
  content.nodes[0]!.ports = [{ id: "custom", side: "top" }];
  assert.equal(graphEdgeHandles(content, content.edges[0]!).source, "custom");
});
