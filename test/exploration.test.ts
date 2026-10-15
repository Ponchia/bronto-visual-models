import assert from "node:assert/strict";
import test from "node:test";
import { createModel, editModel, type GraphContent } from "../src/index.ts";
import { graphInteractionIndex, graphSelection } from "../src/render/graph-index.ts";
import { graphEdgeHandles } from "../src/render/graph-ports.ts";
import { graphMatrix, matrixData, matrixSpec } from "../src/render/graph-matrix.ts";
import {
  chartTableColumns,
  chartTablePage,
  chartTableWindow,
  chartCellFullText,
} from "../src/render/chart-table.ts";
const graph = (): GraphContent => ({
  nodes: [
    {
      id: "b",
      label: "Beta",
      x: 0,
      y: 0,
      parentId: "g",
      description: "private authored prose",
      ports: [
        { id: "one", side: "bottom" },
        { id: "two", side: "bottom" },
      ],
    },
    { id: "a", label: "Alpha", x: 300, y: 0 },
    { id: "g", label: "Group", x: 0, y: 0, group: true },
  ],
  edges: [
    {
      id: "b",
      label: "Beta to Alpha",
      source: "b",
      target: "a",
      sourcePort: "two",
      targetPort: "top",
      description: "kept only in authored model",
    },
    { id: "same", label: "Second link", source: "b", target: "a" },
    { id: "self", label: "Self", source: "a", target: "a" },
  ],
});
test("graph index retains namespaced nodes/edges, authored order and correct endpoints", () => {
  const content = graph(),
    before = JSON.stringify(content),
    index = graphInteractionIndex(content);
  assert.equal(index.nodes.get("b"), content.nodes[0]);
  assert.equal(index.edges.get("b"), content.edges[0]);
  assert.deepEqual(
    index.orderedNodes.map((n) => n.id),
    ["a", "g", "b"],
  );
  for (const direction of ["RIGHT", "DOWN"] as const) {
    content.direction = direction;
    const next = graphInteractionIndex(content);
    for (const edge of content.edges)
      assert.deepEqual(next.handles.get(edge.id), graphEdgeHandles(content, edge));
  }
  delete content.direction;
  assert.equal(JSON.stringify(content), before);
});
test("graph index handles maximum-depth groups without mutating source", () => {
  const nodes = Array.from({ length: 300 }, (_, i) => ({
    id: `n${i}`,
    label: `Node ${i}`,
    x: 0,
    y: 0,
    group: true,
    ...(i ? { parentId: `n${i - 1}` } : {}),
  })).reverse();
  const index = graphInteractionIndex({ nodes, edges: [] });
  assert.equal(index.orderedNodes[0]!.id, "n0");
  assert.equal(index.orderedNodes.at(-1)!.id, "n299");
  assert.equal(nodes[0]!.id, "n299");
});
test("invalid graph hierarchy and absent endpoints are refused", () => {
  assert.throws(() =>
    graphInteractionIndex({
      nodes: [{ id: "a", label: "A", x: 0, y: 0, parentId: "a" }],
      edges: [],
    }),
  );
  const content = graph();
  content.nodes[0]!.parentId = "missing";
  assert.throws(() => graphInteractionIndex(content));
  assert.throws(() => graphInteractionIndex({ nodes: [], edges: graph().edges }));
});
test("indexed route/port lookups preserve reference identity and rebuild for replacement content", () => {
  const content = graph();
  const routing = {
    modelId: "m",
    generation: "g",
    fingerprint: "f",
    edges: [
      {
        id: "b",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
    ],
    ports: [{ nodeId: "b", portId: "two", offset: 0.7 }],
    omitted: [],
  };
  const index = graphInteractionIndex(content, routing);
  assert.equal(index.routes.get("b"), routing.edges[0]);
  assert.equal(index.routePorts.get("b")![0], routing.ports[0]);
  const next = graphInteractionIndex(
    { ...content, nodes: content.nodes.map((n) => ({ ...n, x: 90 })) },
    routing,
  );
  assert.notEqual(index.nodes.get("b"), next.nodes.get("b"));
  assert.equal(index.nodes.get("b")!.x, 0);
});
test("selection touches no geometry and preserves every unaffected renderer item", () => {
  const input = Array.from({ length: 300 }, (_, i) => ({
    id: `n${i}`,
    selected: false,
    data: { label: `N${i}` },
    position: { x: i, y: 0 },
  }));
  const first = graphSelection(input, "n1"),
    second = graphSelection(input, "n2");
  assert.equal(first.filter((x, i) => x !== input[i]).length, 1);
  assert.equal(second.filter((x, i) => x !== first[i]).length, 2);
  assert.equal(first[1]!.data, input[1]!.data);
  assert.equal(first[1]!.position, input[1]!.position);
  assert.ok(graphSelection(input, undefined).every((x, i) => x === input[i]));
  assert.equal(input[1]!.selected, false);
});
test("matrix keeps parallel edge identities, reveals filtered scope, and never changes order in source", () => {
  const content = graph(),
    before = JSON.stringify(content);
  const full = graphMatrix(content, "", "authored");
  assert.equal(full.cells.length, 2);
  assert.deepEqual(full.cells.find((c) => c.count === 2)!.ids, ["b", "same"]);
  assert.deepEqual(
    graphMatrix(content, "", "label").nodes.map((n) => n.label),
    ["Alpha", "Beta", "Group"],
  );
  assert.equal(graphMatrix(content, "beta", "authored").edges.length, 0);
  assert.equal(graphMatrix(content, "no-match", "degree").nodes.length, 0);
  assert.equal(JSON.stringify(content), before);
});
test("matrix rendering tuples omit raw graph payload, remain sparse and do not alias the source", () => {
  const content = graph(),
    before = JSON.stringify(content),
    data = matrixData(graphMatrix(content, "", "authored"), 500);
  assert.deepEqual(Object.keys(data.nodes[0]!).sort(), ["collection", "id", "index", "label"]);
  assert.ok(data.cells.every((c) => !Object.hasOwn(c, "edges")));
  assert.equal(data.cells.length, 2);
  data.nodes[0]!.label = "Changed by renderer";
  assert.equal(JSON.stringify(content), before);
  const max = {
    nodes: Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, x: 0, y: 0 })),
    edges: Array.from({ length: 600 }, (_, i) => ({
      id: `e${i}`,
      label: `E${i}`,
      source: `n${i % 300}`,
      target: `n${(i + 1) % 300}`,
    })),
  };
  const result = matrixData(graphMatrix(max, "", "authored"), 500);
  assert.equal(result.nodes.length, 300);
  assert.equal(result.cells.length, 300);
});
test("all chart columns are reachable in bounded independent row/column pages", () => {
  const rows = Array.from({ length: 31 }, (_, i) =>
    Object.fromEntries(Array.from({ length: 85 }, (_, j) => [`c${j}`, `${i}:${j}`])),
  );
  const columns = chartTableColumns(rows);
  assert.equal(columns.length, 85);
  const visited = [];
  for (let c = 0; c < 3; c++) {
    const page = chartTableWindow(rows, columns, 1, c);
    visited.push(...page.columns);
    assert.equal(page.rows.length, 6);
    assert.ok(page.columns.length <= 40);
    assert.equal(page.start, 25);
  }
  assert.deepEqual(visited, columns);
  assert.equal(chartTablePage(rows, 1, 2).columns[0], "c80");
  const shrunk = chartTableWindow(rows.slice(0, 2), columns.slice(0, 1), 100, 100);
  assert.equal(shrunk.page, 0);
  assert.equal(shrunk.columnPage, 0);
  for (const n of [-1, NaN, Infinity, 1.1])
    assert.throws(() => chartTableWindow(rows, columns, 0, n));
});
test("sparse column metadata is reusable without reenumerating every row on pagination", () => {
  const rows = [{ a: 1 }, { b: 2 }, ...Array.from({ length: 29 }, (_, i) => ({ a: i }))];
  const columns = chartTableColumns(rows);
  assert.deepEqual(columns, ["a", "b"]);
  const protectedRows = rows.map(
    (row) =>
      new Proxy(row, {
        ownKeys() {
          throw new Error("Unexpected schema rescan");
        },
      }),
  );
  assert.equal(chartTableWindow(protectedRows, columns, 1).rows.length, 6);
});
test("full chart values preserve null, missing, false, zero, long strings and inert markup", () => {
  for (const [input, expected] of [
    [undefined, "—"],
    [null, "null"],
    [false, "false"],
    [0, "0"],
    ["", ""],
  ] as const)
    assert.equal(chartCellFullText(input), expected);
  const text = "x".repeat(300) + '<img src="https://example.invalid/not-loaded">';
  assert.equal(chartCellFullText(text), text);
  assert.equal(chartCellFullText({ text }), JSON.stringify({ text }));
});
test("visual selection and transient indexes never change model generations or revisions", () => {
  const model = createModel({
    id: "m",
    title: "Graph",
    renderer: "diagram",
    content: graph() as unknown as Record<string, unknown>,
  });
  const before = JSON.stringify(model);
  graphInteractionIndex(model.content as unknown as GraphContent);
  graphMatrix(model.content as unknown as GraphContent, "a", "label");
  assert.equal(JSON.stringify(model), before);
  const changed = editModel(model, { title: "Renamed" }).model;
  assert.equal(changed.generation, model.generation);
  assert.equal(changed.revision, 2);
});

test("matrix labels reserve measured font width plus a gutter and retain bounded layout", () => {
  const matrix = graphMatrix(graph(), "", "authored");
  assert.equal(matrixData(matrix, 500, 95).layout[0]!.margin, 123);
  assert.equal(matrixData(matrix, 500, 1000).layout[0]!.margin, 200);
  assert.equal(matrixData(matrix, 30, 95).layout[0]!.cell, 16);
  assert.ok(Number.isFinite(matrixData(matrix, 500, NaN).layout[0]!.margin));
});

test("retained matrix scales follow changed rank, not historical domain insertion order", async () => {
  const { View, parse, changeset } = await import("vega");
  const { lightTheme } = await import("../src/react/theme.ts");
  const content = graph();
  const view = new View(parse(matrixSpec(lightTheme)), { renderer: "none" });
  try {
    for (const [query, order] of [
      ["", "authored"],
      ["", "label"],
      ["", "degree"],
      ["beta", "label"],
      ["none", "label"],
      ["", "authored"],
    ] as const) {
      const current = graphMatrix(content, query, order);
      for (const [name, rows] of Object.entries(matrixData(current, 600)))
        view.change(
          name,
          changeset()
            .remove(() => true)
            .insert(structuredClone(rows)),
        );
      await view.runAsync();
      const scale = view.scale("position") as ((id: string) => number) & { domain(): string[] };
      assert.deepEqual(
        scale.domain(),
        current.nodes.map((node) => node.id),
        `${query}/${order}`,
      );
      if (current.nodes.length > 1)
        assert.ok(scale(current.nodes[0]!.id) < scale(current.nodes[1]!.id));
    }
  } finally {
    view.finalize();
  }
});
