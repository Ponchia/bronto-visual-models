import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { graphInteractionIndex, graphSelection } from "../src/render/graph-index.ts";
import { graphEdgeHandles } from "../src/render/graph-ports.ts";
import { graphMatrix, matrixData } from "../src/render/graph-matrix.ts";
const output = [];
function timed(work, iterations = 40) {
  for (let i = 0; i < 10; i++) work();
  const samples = [];
  for (let round = 0; round < 3; round++) {
    const t = performance.now();
    for (let i = 0; i < iterations; i++) work();
    samples.push((performance.now() - t) / iterations);
  }
  return Math.round(samples.sort((a, b) => a - b)[1] * 1000) / 1000;
}
for (const count of [30, 150, 300]) {
  const content = {
    nodes: Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      label: `Node ${i}`,
      x: (i % 10) * 220,
      y: Math.floor(i / 10) * 130,
      description: "Authored prose. ".repeat(25),
      ports: Array.from({ length: 16 }, (_, j) => ({
        id: `p${j}`,
        side: ["top", "right", "bottom", "left"][j % 4],
      })),
    })),
    edges: Array.from({ length: count * 2 }, (_, i) => ({
      id: `e${i}`,
      label: `Edge ${i}`,
      description: "Edge provenance. ".repeat(25),
      source: `n${i % count}`,
      target: `n${(i + 1) % count}`,
    })),
  };
  const routes = {
    modelId: "m",
    generation: "g",
    fingerprint: "test",
    omitted: [],
    edges: content.edges.map((e) => ({
      id: e.id,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    })),
    ports: content.nodes.flatMap((n) =>
      n.ports.map((p, j) => ({ nodeId: n.id, portId: p.id, offset: (j + 1) / 17 })),
    ),
  };
  const scan = () => ({
    nodes: content.nodes.map((n) => ({
      id: n.id,
      ports: routes.ports.filter((p) => p.nodeId === n.id),
    })),
    edges: content.edges.map((e) => ({
      id: e.id,
      handles: graphEdgeHandles(content, e),
      route: routes.edges.find((r) => r.id === e.id),
    })),
  });
  const indexed = () => {
    const index = graphInteractionIndex(content, routes);
    return {
      nodes: content.nodes.map((n) => ({ id: n.id, ports: index.routePorts.get(n.id) })),
      edges: content.edges.map((e) => ({
        id: e.id,
        handles: index.handles.get(e.id),
        route: index.routes.get(e.id),
      })),
    };
  };
  assert.deepEqual(indexed(), scan());
  const graph = graphMatrix(content, "", "authored");
  const oldData = { nodes: graph.nodes, cells: graph.cells, layout: matrixData(graph, 800).layout },
    newData = matrixData(graph, 800);
  const base = content.nodes.map((n) => ({
    id: n.id,
    selected: false,
    data: { label: n.label },
    position: { x: n.x, y: n.y },
  }));
  const a = graphSelection(base, "n0"),
    b = graphSelection(base, "n1");
  output.push({
    nodes: count,
    edges: content.edges.length,
    routePorts: routes.ports.length,
    scanMilliseconds: timed(scan),
    indexedMilliseconds: timed(indexed),
    selectionChangedObjects: b.filter((x, i) => x !== a[i]).length,
    retainedSelectionObjects: b.filter((x, i) => x === a[i]).length,
    matrixPayloadBytesBefore: Buffer.byteLength(JSON.stringify(oldData)),
    matrixPayloadBytesAfter: Buffer.byteLength(JSON.stringify(newData)),
  });
}
const report = {
  observedAt: new Date().toISOString(),
  node: process.version,
  architecture: process.arch,
  method:
    "Same synthetic valid-bounds graphs; equal route/port/handle results. Ten warmups and three rounds of 40 full preparations. Baseline reproduces prior per-node port filtering and per-edge scans; indexed path includes index construction. Selection counts compare successive selections. Byte figures compare exact renderer data tuple serialization. Not a browser frame-rate, memory or whole-application benchmark.",
  results: output,
};
mkdirSync(".tmp", { recursive: true });
writeFileSync(".tmp/benchmark-exploration.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
