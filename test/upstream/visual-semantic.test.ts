import assert from "node:assert/strict";
import test from "node:test";
import {
  compareVisualModels,
  type GraphContent,
  modelTargets,
  VISUAL_RENDERERS,
  VISUAL_TEMPLATES,
  type VisualModel,
  validateVisualContent,
  visualFamily,
  visualFamilyIdentity,
  visualModelType,
  visualRemoval,
} from "../../src/index.ts";

const content = (id: string) => {
  const template = VISUAL_TEMPLATES.find((entry) => entry.id === id);
  assert.ok(template);
  return structuredClone(template.content);
};
test("semantic families are distinct reviewed renderers and all templates validate", () => {
  for (const renderer of [
    "diagram",
    "timeline",
    "gantt",
    "analysis",
    "geography",
    "source-diagram",
  ])
    assert.ok(VISUAL_RENDERERS.some((entry) => entry.id === renderer));
  assert.equal(new Set<string>(VISUAL_RENDERERS.map((entry) => entry.id)).has("kroki"), false);
  for (const entry of VISUAL_TEMPLATES)
    validateVisualContent(entry.renderer, visualModelType(entry.renderer), entry.content);
});
test("diagram relationships require existing nodes, groups, unique ports and acyclic parents", () => {
  for (const patch of [
    { edges: [{ id: "bad", label: "Bad", source: "client", target: "absent" }] },
    {
      nodes: [
        { id: "a", label: "A", x: 0, y: 0, parentId: "b", group: true },
        { id: "b", label: "B", x: 0, y: 0, parentId: "a", group: true },
      ],
      edges: [],
    },
    {
      nodes: [
        {
          id: "a",
          label: "A",
          x: 0,
          y: 0,
          ports: [
            { id: "out", side: "right" },
            { id: "out", side: "left" },
          ],
        },
      ],
      edges: [],
    },
    {
      nodes: [{ id: "a", label: "A", x: 0, y: 0, ports: [{ id: "custom", side: "right" }] }],
      edges: [{ id: "edge", label: "self", source: "a", target: "a", sourcePort: "right" }],
    },
    { nodes: [{ id: "a", label: "A", x: 0, y: 0, href: "javascript:alert(1)" }], edges: [] },
  ])
    assert.throws(() =>
      validateVisualContent("diagram", "graph", { ...content("architecture"), ...patch }),
    );
});
test("a diagram reports every broken relationship at the record it belongs to", () => {
  const issues = visualFamily("diagram")?.validate?.({
    nodes: [
      { id: "a", label: "A", x: 0, y: 0, parentId: "b", group: true },
      { id: "b", label: "B", x: 0, y: 0, parentId: "a", group: true },
      {
        id: "c",
        label: "C",
        x: 0,
        y: 0,
        parentId: "missing",
        ports: [
          { id: "p", side: "top" },
          { id: "p", side: "left" },
        ],
      },
    ],
    edges: [{ id: "e", label: "E", source: "c", target: "gone", sourcePort: "q" }],
  });
  assert.deepEqual(
    issues?.map((issue) => issue.path.join("/")),
    [
      "nodes/c/parentId",
      "nodes/c/ports/p",
      "nodes/a/parentId",
      "nodes/b/parentId",
      "edges/e/sourcePort",
      "edges/e/target",
    ],
  );
});
test("removing a diagram group takes its descendants and every relationship touching them", () => {
  const graph = {
    nodes: [
      { id: "g", label: "G", x: 0, y: 0, group: true },
      { id: "inner", label: "Inner", x: 0, y: 0, group: true, parentId: "g" },
      { id: "leaf", label: "Leaf", x: 0, y: 0, parentId: "inner" },
      { id: "out", label: "Out", x: 0, y: 0 },
    ],
    edges: [
      { id: "leaf-out", label: "Calls", source: "leaf", target: "out" },
      { id: "loop", label: "Retries", source: "out", target: "out" },
    ],
  };
  const diagram = visualFamily("diagram");
  const group = visualRemoval(diagram, "nodes", graph, ["g"]);
  assert.deepEqual(group, [
    { collection: "nodes", ids: ["g", "inner", "leaf"] },
    { collection: "edges", ids: ["leaf-out"] },
  ]);
  assert.deepEqual(visualRemoval(diagram, "nodes", graph, ["leaf"]), [
    { collection: "nodes", ids: ["leaf"] },
    { collection: "edges", ids: ["leaf-out"] },
  ]);
  // An unconnected node and a relationship leave alone.
  assert.deepEqual(visualRemoval(diagram, "nodes", { ...graph, edges: [] }, ["out"]), [
    { collection: "nodes", ids: ["out"] },
  ]);
  assert.deepEqual(visualRemoval(diagram, "edges", graph, ["loop"]), [
    { collection: "edges", ids: ["loop"] },
  ]);
  // A weighted flow follows the same rule through its links.
  assert.deepEqual(
    visualRemoval(visualFamily("analysis"), "nodes", content("weighted-flow"), ["supply"]).map(
      (entry) => entry.collection,
    ),
    ["nodes", "links"],
  );
});
test("a new diagram node lands clear of the drawing, or where a person asked", () => {
  const graph = content("architecture") as unknown as GraphContent;
  const newItem = visualFamily("diagram")?.collections.nodes?.newItem;
  assert.ok(newItem);
  const placed = newItem(graph as never, { id: "new" });
  validateVisualContent("diagram", "graph", { ...graph, nodes: [...graph.nodes, placed] });
  for (const node of graph.nodes)
    assert.ok(Number(placed.x) >= node.x + (node.width ?? 180), `clear of ${node.id}`);
  assert.deepEqual(newItem(graph as never, { id: "g", near: { x: 5, y: 6 }, group: true }), {
    id: "g",
    label: "New group",
    x: 5,
    y: 6,
    width: 420,
    height: 300,
    group: true,
  });
  assert.deepEqual(newItem({ nodes: [], edges: [] }, { id: "first" }), {
    id: "first",
    label: "New entity",
    x: 0,
    y: 0,
    width: 180,
    height: 90,
  });
});
test("a relationship target is named by what it joins", () => {
  const graph = content("architecture") as unknown as GraphContent;
  const edge = graph.edges[0];
  assert.ok(edge);
  const label = (id: string) => graph.nodes.find((node) => node.id === id)?.label;
  const targets = modelTargets({
    id: "architecture",
    generation: "g",
    revision: 1,
    renderer: "diagram",
    content: graph,
  } as unknown as VisualModel);
  assert.equal(
    targets.find((target) => target.collection === "edges" && target.elementId === edge.id)?.label,
    `${label(edge.source)} → ${label(edge.target)} · ${edge.label}`,
  );
  assert.equal(
    targets.find((target) => target.collection === "nodes")?.label,
    graph.nodes[0]?.label,
  );
});
test("timeline ranges and lanes are validated, not silently treated as a schedule", () => {
  for (const event of [
    { id: "a", label: "A", start: 0, end: -1, lane: "work" },
    { id: "a", label: "A", start: 0, lane: "missing" },
    { id: "a", label: "A", start: 9e16, lane: "work" },
  ])
    assert.throws(() =>
      validateVisualContent("timeline", "timeline", { ...content("timeline"), events: [event] }),
    );
});
test("gantt validates schedule semantics, hierarchy and dependency graphs", () => {
  const base = content("gantt");
  validateVisualContent("gantt", "gantt", base);
  for (const patch of [
    { tasks: [{ id: "bad", label: "Bad", workstream: "missing", start: 1, end: 2 }] },
    { tasks: [{ id: "bad", label: "Bad", workstream: "delivery", start: 2, end: 1 }] },
    { tasks: [{ id: "bad", label: "Bad", workstream: "delivery", start: 1 }] },
    {
      tasks: [
        { id: "a", label: "A", workstream: "delivery", start: 1, end: 2, parentId: "b" },
        { id: "b", label: "B", workstream: "delivery", start: 1, end: 2, parentId: "a" },
      ],
    },
  ])
    assert.throws(() => validateVisualContent("gantt", "gantt", { ...base, ...patch }));
  assert.throws(() =>
    validateVisualContent("gantt", "gantt", {
      ...base,
      dependencies: [
        { id: "x", label: "X", source: "baseline", target: "implement", type: "finish-to-start" },
        { id: "y", label: "Y", source: "implement", target: "baseline", type: "finish-to-start" },
      ],
    }),
  );
});

test("weighted flow rejects cycles, zero weights and absent endpoints", () => {
  const base = content("weighted-flow");
  for (const links of [
    [
      { id: "x", label: "X", source: "supply", target: "use", value: 1 },
      { id: "y", label: "Y", source: "use", target: "supply", value: 1 },
    ],
    [{ id: "x", label: "X", source: "supply", target: "use", value: 0 }],
    [{ id: "x", label: "X", source: "supply", target: "missing", value: 1 }],
  ])
    assert.throws(() => validateVisualContent("analysis", "analysis", { ...base, links }));
});
test("hierarchies and multivariable rows require valid structural data", () => {
  assert.throws(() =>
    validateVisualContent("analysis", "analysis", {
      layout: "treemap",
      nodes: [
        { id: "a", label: "A", parentId: "b", value: 1 },
        { id: "b", label: "B", parentId: "a", value: 1 },
      ],
    }),
  );
  assert.throws(() =>
    validateVisualContent("analysis", "analysis", {
      ...content("parallel"),
      dimensions: ["cost", "absent"],
    }),
  );
});
test("geography accepts local bounded geometry and refuses URLs, unclosed rings and invalid coordinates", () => {
  validateVisualContent("geography", "geography", content("geography"));
  for (const geometry of [
    { type: "Point", coordinates: [200, 0] },
    { type: "Point", coordinates: [0, 90] },
    {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ],
    },
    { type: "LineString", coordinates: [[0, 0]] },
  ])
    assert.throws(() =>
      validateVisualContent("geography", "geography", {
        features: [{ id: "x", label: "X", geometry }],
      }),
    );
  assert.throws(() =>
    validateVisualContent("geography", "geography", {
      ...content("geography"),
      url: "https://tiles.example",
    }),
  );
});
test("every semantic family reports each broken rule at the record it belongs to", () => {
  const paths = (renderer: string, content: Record<string, unknown>) =>
    visualFamily(renderer)
      ?.validate?.(content)
      .map((issue) => issue.path.join("/"));
  assert.deepEqual(
    paths("timeline", {
      lanes: [{ id: "work", label: "Work" }],
      events: [
        { id: "lost", label: "Lost", lane: "gone", start: 0 },
        { id: "backwards", label: "Backwards", lane: "work", start: 10, end: 5 },
      ],
      fields: { start: "at" },
    }),
    ["fields", "events/lost/lane", "events/backwards/end"],
  );
  const gantt = content("gantt");
  assert.deepEqual(
    paths("gantt", {
      ...gantt,
      tasks: [
        ...(gantt.tasks as unknown[]),
        { id: "stray", label: "Stray", workstream: "gone", start: 1, end: 2 },
        {
          id: "sub",
          label: "Sub",
          workstream: "assurance",
          start: 1,
          end: 2,
          parentId: "baseline",
        },
      ],
      dependencies: [
        { id: "x", label: "X", source: "implement", target: "review", type: "finish-to-start" },
        { id: "y", label: "Y", source: "review", target: "implement", type: "finish-to-start" },
      ],
    }),
    ["tasks/stray/workstream", "tasks/sub/parentId", "dependencies/x", "dependencies/y"],
  );
  assert.deepEqual(
    paths("analysis", {
      ...content("weighted-flow"),
      links: [
        { id: "there", label: "There", source: "supply", target: "use", value: 1 },
        { id: "back", label: "Back", source: "use", target: "supply", value: 1 },
        { id: "nowhere", label: "Nowhere", source: "supply", target: "gone", value: 1 },
      ],
    }),
    ["links/there", "links/back", "links/nowhere/target"],
  );
  assert.deepEqual(
    paths("analysis", {
      layout: "treemap",
      nodes: [
        { id: "root", label: "Root" },
        { id: "leaf", label: "Leaf", parentId: "gone", value: 1 },
      ],
    }),
    ["nodes/root/value", "nodes/leaf/parentId"],
  );
  assert.deepEqual(
    paths("geography", {
      center: [200, 0],
      features: [
        { id: "far", label: "Far", geometry: { type: "Point", coordinates: [0, 89] } },
        {
          id: "open",
          label: "Open",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
              ],
            ],
          },
        },
      ],
    }),
    ["center", "features/far/geometry", "features/open/geometry"],
  );
});
test("new items follow each family's rules, or say what the content needs first", () => {
  const add = (renderer: string, collection: string, base: Record<string, unknown>) => {
    const item = visualFamily(renderer)?.collections[collection]?.newItem?.(base, { id: "new" });
    assert.ok(item);
    validateVisualContent(renderer, visualModelType(renderer), {
      ...base,
      [collection]: [...((base[collection] as unknown[]) ?? []), item],
    });
    return item;
  };
  assert.throws(() => add("timeline", "events", { lanes: [], events: [] }), /Add a lane/);
  const timeline = content("timeline");
  const event = add("timeline", "events", timeline);
  const last = (timeline.events as Array<{ start: number; end?: number }>).at(-1);
  assert.equal(event.start, last?.end ?? last?.start);
  assert.throws(
    () => add("gantt", "tasks", { workstreams: [], tasks: [], dependencies: [] }),
    /Add a workstream/,
  );
  add("gantt", "tasks", content("gantt"));
  add("gantt", "workstreams", content("gantt"));
  assert.deepEqual(
    visualFamily("gantt")?.collections.dependencies?.newItem?.(content("gantt"), {
      id: "d",
      values: { source: "review", target: "baseline", label: "Signs off" },
    }),
    { id: "d", label: "Signs off", source: "review", target: "baseline", type: "finish-to-start" },
  );
  assert.deepEqual(
    Object.keys(add("analysis", "nodes", content("parallel")).metrics as object),
    content("parallel").dimensions as string[],
  );
  add("analysis", "nodes", content("hierarchy"));
  add("geography", "features", content("geography"));
});
test("removing a Gantt task takes its subtasks and their dependencies", () => {
  const gantt = content("gantt");
  const tasks = [
    ...(gantt.tasks as unknown[]),
    { id: "sub", label: "Sub", workstream: "delivery", start: 1, end: 2, parentId: "implement" },
  ];
  assert.deepEqual(
    visualRemoval(visualFamily("gantt"), "tasks", { ...gantt, tasks }, ["implement"]),
    [
      { collection: "tasks", ids: ["implement", "sub"] },
      { collection: "dependencies", ids: ["baseline-implement", "implement-review"] },
    ],
  );
});
test("each semantic family summarizes what it holds", () => {
  const summary = (renderer: string, id: string) =>
    visualFamilyIdentity(renderer)?.summary?.(content(id));
  assert.match(summary("timeline", "timeline") ?? "", /^\d+ events? in \d+ lanes?$/);
  assert.match(summary("gantt", "gantt") ?? "", /^3 tasks in 2 workstreams · 2 dependencies$/);
  assert.match(summary("analysis", "weighted-flow") ?? "", /^\d+ entit(y|ies) · \d+ flows?$/);
  assert.match(summary("analysis", "parallel") ?? "", /^\d+ rows? across \d+ dimensions?$/);
  assert.match(summary("geography", "geography") ?? "", /^\d+ features?$/);
  assert.equal(
    visualFamilyIdentity("timeline")?.source?.kind({ datasource: "dataset" }),
    "dataset",
  );
});
test("saved model comparison names identified changes and order without fetching any source", () => {
  const a = {
    id: "a",
    renderer: "diagram",
    modelType: "graph",
    title: "A",
    description: "",
    content: content("architecture"),
  } as VisualModel;
  const b = structuredClone(a);
  b.id = "b";
  const nodes = b.content.nodes as Array<{ id: string; label: string }>;
  nodes.reverse();
  assert.ok(nodes[0]);
  nodes[0].label = "Changed";
  const result = compareVisualModels(a, b);
  assert.ok(result.changes.some((x) => x.path.endsWith(".$order")));
  assert.ok(result.changes.some((x) => x.path.includes("[storage].label")));
  assert.equal(compareVisualModels(a, a).changes.length, 0);
  assert.equal(compareVisualModels(a, b, 1).truncated, true);
});

test("compatible projections preserve graph facts and hierarchy semantics", async () => {
  const { resolveVisualProjection, visualProjectionChoices, visualViewIdentity } = await import(
    "../../src/projections.ts"
  );
  const graph = { renderer: "diagram", content: content("architecture") };
  const before = structuredClone(graph);
  assert.deepEqual(
    visualProjectionChoices(graph).map((entry) => entry.id),
    ["diagram", "network", "matrix"],
  );
  assert.equal(resolveVisualProjection(graph, "matrix"), "matrix");
  assert.equal(resolveVisualProjection(graph, "sunburst"), undefined);
  assert.deepEqual(graph, before);
  const hierarchy = { renderer: "analysis", content: content("hierarchy") };
  assert.equal(resolveVisualProjection(hierarchy, "sunburst"), "sunburst");
  assert.equal(
    resolveVisualProjection(
      { renderer: "analysis", content: content("weighted-flow") },
      "sunburst",
    ),
    undefined,
  );
  assert.notEqual(
    visualViewIdentity({ projection: "diagram" }),
    visualViewIdentity({ projection: "matrix" }),
  );
});

test("dataset timelines require explicit sources, stable row identities and qualified instants", async () => {
  const { timelineFromRows } = await import("../../src/families/timeline.ts");
  const binding = {
    lanes: [],
    events: [],
    datasource: "dataset",
    params: { dataset: "bronto/events", revision: 2 },
    fields: { label: "name", start: "at", end: "until", lane: "team" },
  };
  validateVisualContent("timeline", "timeline", binding);
  for (const bad of [
    { ...binding, fields: undefined },
    { ...binding, events: [{ id: "a", label: "Old", start: 0, lane: "old" }] },
    { ...binding, datasource: "arbitrary-provider" },
    { ...binding, params: { dataset: "bronto/events", revision: 0 } },
  ])
    assert.throws(() => validateVisualContent("timeline", "timeline", bad));
  const rows = [
    {
      rowId: "source:id/1",
      name: "Deploy",
      at: "2026-09-24T12:00:00Z",
      until: null,
      team: "Delivery",
    },
  ];
  const first = rows[0];
  assert.ok(first);
  const before = structuredClone(rows);
  const resolved = timelineFromRows(rows, binding.fields);
  assert.equal(resolved.events[0]?.start, Date.parse("2026-09-24T12:00:00Z"));
  assert.equal(resolved.events[0]?.end, undefined);
  assert.equal(resolved.lanes[0]?.label, "Delivery");
  assert.equal(
    timelineFromRows([{ ...first, name: "New label" }], binding.fields).events[0]?.id,
    resolved.events[0]?.id,
  );
  assert.deepEqual(rows, before);
  // A derivation stops where the schema does: a full timeline still validates as authored content.
  const full = timelineFromRows(
    Array.from({ length: 1000 }, (_, i) => ({ ...first, rowId: String(i) })),
    binding.fields,
  );
  validateVisualContent("timeline", "timeline", { lanes: full.lanes, events: full.events });
  for (const bad of [
    [{ ...first, at: "2026-09-24T12:00:00" }],
    [{ ...first, at: null }],
    [{ ...first, until: "2026-09-24T11:00:00Z" }],
    [{ ...first, rowId: "" }],
    [first, first],
    [{ ...first, team: null }],
    Array.from({ length: 1001 }, (_, i) => ({ ...first, rowId: String(i) })),
    Array.from({ length: 33 }, (_, i) => ({ ...first, rowId: String(i), team: String(i) })),
  ])
    assert.throws(() => timelineFromRows(bad, binding.fields));
});

test("explanations expand stable flat identities into a bounded tree without changing the model", async () => {
  const {
    infographicTree,
    infographicAtPath,
    infographicIndexPath,
    modelTargets,
    validateInfographicStructure,
  } = await import("../../src/index.ts");
  const tree = content("mind-map") as import("../../src/infographic.ts").InfographicContent;
  const before = structuredClone(tree);
  const expanded = infographicTree(tree);
  assert.equal(infographicAtPath(expanded, infographicIndexPath("0,1,0"))?.id, "observations");
  assert.equal(infographicAtPath(expanded, [0, 99]), undefined);
  for (const path of ["-1", "x", "0,100", "0,0,0,0,0,0,0", "0.1"])
    assert.equal(infographicIndexPath(path), undefined);
  const variant = { ...tree, template: "hierarchy-tree-lr-curved-line-rounded-rect-node" };
  validateInfographicStructure(variant);
  assert.equal(infographicAtPath(infographicTree(variant), [0, 1, 0])?.id, "observations");
  const model = {
    id: "tree",
    generation: "g",
    revision: 1,
    renderer: "infographic",
    content: tree,
  } as unknown as VisualModel;
  assert.ok(
    modelTargets(model).some(
      (target) => target.elementId === "observations" && target.collection === "items",
    ),
  );
  assert.deepEqual(tree, before);
  for (const bad of [
    { ...tree, items: [...tree.items, { id: "orphan", parentId: "absent", label: "Orphan" }] },
    {
      ...tree,
      items: tree.items.map((item) =>
        item.id === "question" ? { ...item, parentId: "observations" } : item,
      ),
    },
    { ...tree, template: "sequence-circular-simple" },
    {
      ...tree,
      items: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    },
    {
      ...tree,
      items: Array.from({ length: 7 }, (_, i) => ({
        id: `n${i}`,
        label: `Level ${i}`,
        ...(i ? { parentId: `n${i - 1}` } : {}),
      })),
    },
  ])
    assert.throws(() => validateVisualContent("infographic", "infographic", bad));
});

test("relationship recipes preserve real endpoints and cannot hide links through incompatible layouts", async () => {
  const { modelTargets, INFOGRAPHIC_RECIPES } = await import("../../src/index.ts");
  const flow = content("relationship-explanation");
  validateVisualContent("infographic", "infographic", flow);
  const model = {
    id: "flow",
    generation: "g",
    revision: 1,
    renderer: "infographic",
    content: flow,
  } as unknown as VisualModel;
  assert.equal(modelTargets(model).filter((target) => target.collection === "relations").length, 3);
  assert.ok(!INFOGRAPHIC_RECIPES.some((recipe) => recipe.id.includes("relation-network")));
  for (const bad of [
    { ...flow, template: "sequence-steps-simple" },
    { ...flow, relations: [{ id: "bad", from: "evidence", to: "missing", label: "Bad" }] },
    {
      ...flow,
      relations: [
        { id: "bad", from: "evidence", to: "review", label: "Bad", direction: "invented" },
      ],
    },
    { ...flow, items: [{ id: "a", label: "A", icon: "https://unreviewed.example/icon.svg" }] },
  ])
    assert.throws(() => validateVisualContent("infographic", "infographic", bad));
});
