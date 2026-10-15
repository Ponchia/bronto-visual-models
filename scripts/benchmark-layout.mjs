import { performance } from "node:perf_hooks";
import { createModel, editModel } from "../dist/index.js";
import { layoutDiagram } from "../dist/layout/elk.js";
import ELK from "elkjs/lib/elk.bundled.js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const module = await import("@dagrejs/dagre");
const dagre = module.default ?? module;
const elkVersion = require("elkjs/package.json").version;
const dagreVersion = JSON.parse(
  readFileSync(require.resolve("@dagrejs/dagre/package.json")),
).version;
const fixture = (count) => ({
  nodes: Array.from({ length: count }, (_, i) => ({
    id: `n${String(i).padStart(3, "0")}`,
    label: `Component ${i + 1}`,
    x: 0,
    y: 0,
    width: 140 + (i % 3) * 30,
    height: 70 + (i % 2) * 20,
  })),
  edges: Array.from({ length: count }, (_, i) =>
    [10, 11].flatMap((step) =>
      i + step < count
        ? [
            {
              id: `e${i}-${step}`,
              source: `n${String(i).padStart(3, "0")}`,
              target: `n${String(i + step).padStart(3, "0")}`,
              label: "calls",
            },
          ]
        : [],
    ),
  ).flat(),
});
function overlaps(nodes) {
  let count = 0;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i],
        b = nodes[j];
      if (
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height
      )
        count++;
    }
  return count;
}
const results = [];
for (const count of [12, 60, 180, 300]) {
  const content = fixture(count);
  const model = createModel({
    id: "benchmark",
    title: "Synthetic dependency fixture",
    renderer: "diagram",
    content,
  });
  for (const algorithm of ["dagre", "elk-brandes-koepf", "elk-layered"]) {
    const durations = [];
    let nodes;
    // One warmup, then 3 measurements. No performance threshold is a release gate.
    for (let run = 0; run < 4; run++) {
      const start = performance.now();
      if (algorithm !== "dagre") {
        const engine = algorithm === "elk-brandes-koepf" ? new ELK() : undefined;
        const proposal = await layoutDiagram(
          model,
          { spacing: 48, layerSpacing: 88 },
          engine
            ? {
                engine: {
                  layout: (root) =>
                    engine.layout({
                      ...root,
                      layoutOptions: {
                        ...root.layoutOptions,
                        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
                      },
                    }),
                },
              }
            : {},
        );
        nodes = editModel(model, proposal.patch).model.content.nodes;
      } else {
        const g = new dagre.graphlib.Graph({ multigraph: true })
          .setGraph({ rankdir: "LR", nodesep: 48, ranksep: 88 })
          .setDefaultEdgeLabel(() => ({}));
        for (const node of content.nodes)
          g.setNode(node.id, { width: node.width, height: node.height });
        for (const edge of content.edges)
          g.setEdge(edge.source, edge.target, { width: 47, height: 18 }, edge.id);
        dagre.layout(g);
        nodes = content.nodes.map((node) => ({
          ...node,
          x: g.node(node.id).x - node.width / 2,
          y: g.node(node.id).y - node.height / 2,
        }));
      }
      if (run) durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    results.push({
      algorithm,
      nodes: count,
      edges: content.edges.length,
      medianMs: Math.round(durations[1] * 10) / 10,
      overlapPairs: overlaps(nodes),
      width: Math.round(Math.max(...nodes.map((n) => n.x + n.width))),
      height: Math.round(Math.max(...nodes.map((n) => n.y + n.height))),
    });
  }
}
const report = {
  observedAt: new Date().toISOString(),
  node: process.version,
  architecture: process.arch,
  versions: { elkjs: elkVersion, dagre: dagreVersion },
  method:
    "Synthetic flat layered DAGs, variable rectangle sizes, one warmup and three runs. ELK timing includes the public validation/proposal boundary; Dagre is a raw layout baseline. Timings are local diagnostics, not an unbiased engine speed ranking. No browser, memory, crossing-optimality or worker startup performance claim.",
  results,
};
mkdirSync(".tmp", { recursive: true });
writeFileSync(".tmp/layout-benchmark.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
