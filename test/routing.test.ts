import assert from "node:assert/strict";
import test from "node:test";
import { createModel, editModel } from "../src/index.ts";
import type { GraphContent } from "../src/semantic.ts";
import { layoutDiagram } from "../src/layout/elk.ts";
import {
  diagramRoutingMatches,
  diagramNodeBoxes,
  placeDiagramLabels,
  boxesOverlap,
  diagramRoutePath,
} from "../src/render/diagram-routing.ts";

const content = (): GraphContent => ({
  nodes: [
    { id: "a", label: "A", x: 0, y: 0 },
    { id: "b", label: "B", x: 0, y: 0 },
    { id: "c", label: "C", x: 0, y: 0 },
  ],
  edges: [
    { id: "ab", source: "a", target: "b", label: "A deliberately rather long relationship label" },
    { id: "ac", source: "a", target: "c", label: "second link" },
  ],
});
const model = (graph = content()) =>
  createModel({ id: "route-model", title: "Routes", renderer: "diagram", content: graph as any });

test("routes are ROOT-space derived data, absent from the guarded patch and saved model", async () => {
  const source = model(),
    before = JSON.stringify(source);
  const proposal = await layoutDiagram(source);
  const candidate = editModel(source, proposal.patch).model;
  assert.equal(JSON.stringify(source), before);
  assert.equal(proposal.routing.edges.length, 2);
  assert.equal(proposal.routing.omitted.length, 0);
  assert.equal(diagramRoutingMatches(candidate, proposal.routing), true);
  assert.equal(diagramRoutingMatches(source, proposal.routing), false);
  assert.equal(JSON.stringify(proposal.patch).includes("points"), false);
  assert.equal(JSON.stringify(candidate.content).includes("fingerprint"), false);
  const boxes = diagramNodeBoxes(candidate.content as unknown as GraphContent);
  for (const route of proposal.routing.edges) {
    const edge = content().edges.find((e) => e.id === route.id)!,
      a = boxes.get(edge.source)!,
      b = boxes.get(edge.target)!;
    assert(Math.abs(route.points[0]!.x - (a.x + a.width)) < 0.01);
    assert(Math.abs(route.points.at(-1)!.x - b.x) < 0.01);
    assert(!diagramRoutePath(route.points).includes("NaN"));
  }
});

test("cross-group routes use root coordinates while child nodes remain parent-relative", async () => {
  const graph = content();
  graph.nodes.push({ id: "group", label: "Group", x: 0, y: 0, group: true });
  graph.nodes[0]!.parentId = "group";
  graph.nodes[1]!.parentId = "group";
  const source = model(graph),
    proposal = await layoutDiagram(source),
    candidate = editModel(source, proposal.patch).model;
  const boxes = diagramNodeBoxes(candidate.content as unknown as GraphContent);
  assert.equal(proposal.routing.edges.length, 2);
  for (const route of proposal.routing.edges) {
    const edge = graph.edges.find((e) => e.id === route.id)!,
      a = boxes.get(edge.source)!;
    assert(
      Math.abs(route.points[0]!.x - a.x - a.width) < 0.01,
      `${route.id} has a double or missing parent offset`,
    );
  }
});

test("parallel relationships and self-loops keep distinct routed identities", async () => {
  const graph = content();
  graph.edges.push(
    { id: "ab2", source: "a", target: "b", label: "parallel" },
    { id: "aa", source: "a", target: "a", label: "retry" },
  );
  const result = await layoutDiagram(model(graph));
  assert.deepEqual(
    new Set(result.routing.edges.map((e) => e.id)),
    new Set(graph.edges.map((e) => e.id)),
  );
  assert.notDeepEqual(
    result.routing.edges.find((e) => e.id === "ab")!.points,
    result.routing.edges.find((e) => e.id === "ab2")!.points,
  );
  assert(result.routing.edges.find((e) => e.id === "aa")!.points.length > 2);
});

test("all route-invalidating content changes and element replacements reject old cache", async () => {
  const source = model(),
    proposal = await layoutDiagram(source),
    candidate = editModel(source, proposal.patch).model;
  for (const change of [
    (m: any) => m.content.nodes[0].x++,
    (m: any) => (m.content.nodes[0].width = 250),
    (m: any) => (m.content.edges[0].label = "new label"),
    (m: any) => (m.content.edges[0].target = "c"),
    (m: any) => (m.content.nodes[0].ports = [{ id: "out", side: "bottom" }]),
    (m: any) => (m.elementIncarnations.nodes.a = "replacement-000000000"),
    (m: any) => (m.generation = "another-generation-00000"),
  ]) {
    const m = structuredClone(candidate);
    change(m);
    assert.equal(diagramRoutingMatches(m, proposal.routing), false);
  }
  const unrelated = editModel(candidate, { title: "Different title" }).model;
  assert.equal(
    diagramRoutingMatches(unrelated, proposal.routing),
    true,
    "Title edits do not change geometry",
  );
});

test("cache cannot smuggle SVG commands, diagonal segments, duplicate IDs or nonfinite coordinates", async () => {
  const source = model(),
    proposal = await layoutDiagram(source),
    candidate = editModel(source, proposal.patch).model;
  for (const change of [
    (r: any) => (r.edges[0].points[0].x = "0 L 999 999"),
    (r: any) => (r.edges[0].points[0].x = Infinity),
    (r: any) => r.edges.push(r.edges[0]),
    (r: any) =>
      (r.edges[0].points[1] = { x: r.edges[0].points[0].x + 5, y: r.edges[0].points[0].y + 5 }),
    (r: any) => (r.ports[0].offset = 2),
    (r: any) => r.ports.push(r.ports[0]),
    (r: any) => r.edges.pop(),
  ]) {
    const r = structuredClone(proposal.routing);
    change(r);
    assert.equal(diagramRoutingMatches(candidate, r), false);
  }
});

test("measured labels avoid nodes and one another, retaining full labels for the reading view", async () => {
  const source = model(),
    p = await layoutDiagram(source),
    candidate = editModel(source, p.patch).model;
  const graph = candidate.content as unknown as GraphContent;
  const plan = placeDiagramLabels(
    graph,
    p.routing.edges,
    new Map(graph.edges.map((e) => [e.id, { width: 190, height: 24 }])),
  );
  assert(plan.labels.size > 0);
  const boxes = [...diagramNodeBoxes(graph).values()],
    labels = [...plan.labels.values()];
  for (const label of labels)
    for (const box of boxes) assert.equal(boxesOverlap(label, box), false);
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++)
      assert.equal(boxesOverlap(labels[i]!, labels[j]!), false);
  assert.equal(plan.labels.size + plan.unplaced.length, graph.edges.length);
});

test("impossible label placement is explicit instead of overlapping an obstacle", () => {
  const graph: GraphContent = {
    nodes: [{ id: "n", label: "blocker", x: -1000, y: -1000, width: 2000, height: 2000 }],
    edges: [],
  };
  const plan = placeDiagramLabels(
    graph,
    [
      {
        id: "blocked",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ],
    new Map([["blocked", { width: 200, height: 24 }]]),
  );
  assert.equal(plan.labels.size, 0);
  assert.deepEqual(plan.unplaced, ["blocked"]);
});
