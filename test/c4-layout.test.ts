import assert from "node:assert/strict";
import test from "node:test";
import type { ElkNode } from "elkjs";
import {
  createModel,
  editModel,
  MemoryModelStore,
  VisualModelError,
  type C4Content,
} from "../src/index.ts";
import { layoutC4 } from "../src/layout/c4-elk.ts";
import { layoutC4 as withEngine, c4LayoutCandidate } from "../src/layout/c4.ts";
import { c4Scene } from "../src/render/c4.ts";
import { c4RoutingMatches, c4RoutingLabels } from "../src/render/c4-routing.ts";
const model = () =>
  createModel({ id: "architecture", title: "Private architecture", template: "c4-commerce" });
for (const view of ["context", "containers", "components", "landscape"]) {
  for (const direction of ["RIGHT", "DOWN"] as const) {
    test(`C4 ${view} ${direction} keeps semantics, identities and other diagrams`, async () => {
      const before = model(),
        bytes = JSON.stringify(before);
      const proposal = await layoutC4(before, view, { direction });
      assert.equal(JSON.stringify(before), bytes);
      const candidate = c4LayoutCandidate(before, proposal),
        old = before.content as unknown as C4Content,
        next = candidate.content as unknown as C4Content;
      assert.deepEqual(next.elements, old.elements);
      assert.deepEqual(next.relationships, old.relationships);
      assert.deepEqual(
        next.views.filter((v) => v.id !== view),
        old.views.filter((v) => v.id !== view),
      );
      assert.deepEqual(candidate.elementIncarnations, before.elementIncarnations);
      assert.equal(proposal.nodeCount, old.views.find((v) => v.id === view)!.elementIds.length);
      assert.ok(c4RoutingMatches(candidate, view, proposal.routing));
      assert.equal(
        proposal.routing.omitted.length,
        0,
        `routes omitted for ${view}: ${proposal.routing.omitted}`,
      );
      const scene = c4Scene(next, view),
        labels = c4RoutingLabels(scene, proposal.routing);
      assert.equal(labels.unplaced.length, 0, `labels not placed for ${view}: ${labels.unplaced}`);
      if (view === "containers" || view === "components") assert.ok(scene.boundary);
      assert.ok(proposal.bounds.width > 0 && proposal.bounds.height > 0);
    });
  }
}
test("C4 layout has preview/replay/undo with one diagram-only patch", async () => {
  const store = new MemoryModelStore();
  await store.execute({
    type: "create",
    key: "c",
    model: { id: "a", title: "A", template: "c4-commerce" },
  });
  const before = store.get("a")!,
    proposal = await layoutC4(before, "containers");
  const command = { type: "edit" as const, id: "a", key: "layout", patch: proposal.patch };
  const preview = await store.preview(command);
  assert.equal(preview.effect, "none");
  assert.deepEqual(store.get("a"), before);
  await store.execute(command);
  assert.equal((await store.execute(command)).replayed, true);
  const persisted = new MemoryModelStore({ initial: store.snapshot() });
  await persisted.execute({ type: "undo", id: "a", key: "undo", operation: "layout" });
  assert.deepEqual(persisted.get("a")!.content, before.content);
  assert.throws(() => c4LayoutCandidate(store.get("a")!, proposal), /changed/);
});
test("a proposed layout cannot smuggle changes to elements, relations or other diagrams", async () => {
  const m = model(),
    proposal = await layoutC4(m, "context");
  proposal.patch.items!.push({ field: "elements", set: [{ id: "shop", label: "Hidden rename" }] });
  assert.throws(() => c4LayoutCandidate(m, proposal), /only update/);
});
test("routes are lifetime/diagram/geometry bound; malformed geometry never reaches the renderer", async () => {
  const m = model(),
    p = await layoutC4(m, "context"),
    candidate = c4LayoutCandidate(m, p);
  assert.equal(c4RoutingMatches(candidate, "containers", p.routing), false);
  assert.equal(c4RoutingMatches(m, "context", p.routing), false);
  const changed = editModel(candidate, {
    items: [{ field: "elements", set: [{ id: "shop", label: "Changed" }] }],
  }).model;
  assert.equal(c4RoutingMatches(changed, "context", p.routing), false);
  const bad = structuredClone(p.routing);
  bad.edges[0]!.points[0]!.x += 50;
  assert.equal(c4RoutingMatches(candidate, "context", bad), false);
  const replacement = editModel(candidate, {
    ifRevision: candidate.revision,
    items: [{ field: "elements", replace: ["shop"], set: [{ id: "shop" }] }],
  }).model;
  assert.equal(c4RoutingMatches(replacement, "context", p.routing), false);
  let touched = false;
  const getter = Object.defineProperty({}, "fingerprint", {
    enumerable: true,
    get() {
      touched = true;
      throw new Error("getter");
    },
  });
  assert.equal(c4RoutingMatches(candidate, "context", getter as any), false);
  assert.equal(touched, false);
});
test("runner receives only opaque geometry and output is owned", async () => {
  const m = model();
  let sent = "";
  await assert.rejects(
    withEngine(
      m,
      "context",
      {},
      {
        engine: {
          async layout(graph) {
            sent = JSON.stringify(graph);
            return { ...graph, children: [], width: 1, height: 1 };
          },
        },
      },
    ),
    VisualModelError,
  );
  for (const text of [
    "Private architecture",
    "Customer",
    "Order platform",
    "Payments",
    "Places",
    "PostgreSQL",
  ])
    assert.ok(!sent.includes(text));
  assert.ok(sent.includes('"n0"'));
});
test("cancelled and missing runners produce no proposal or source writes", async () => {
  const m = model(),
    before = JSON.stringify(m),
    controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    withEngine(
      m,
      "context",
      {},
      {
        signal: controller.signal,
        engine: {
          async layout(graph) {
            called = true;
            return graph;
          },
        },
      },
    ),
  );
  assert.equal(called, false);
  assert.equal(JSON.stringify(m), before);
  await assert.rejects(withEngine(m, "context"), /host-owned/);
  await assert.rejects(layoutC4(m, "absent"), /does not exist/);
  await assert.rejects(layoutC4(m, "context", { direction: "UP" as any }), /RIGHT\/DOWN/);
  await assert.rejects(layoutC4(m, "context", { spacing: Infinity }), VisualModelError);
  const snapshot = createModel({ id: "s", title: "S", template: "c4-commerce", role: "snapshot" });
  await assert.rejects(layoutC4(snapshot, "context"), /Fork/);
});

function flatReply(root: ElkNode): ElkNode {
  return {
    ...root,
    width: 2000,
    height: 400,
    children: root.children!.map((node, i) => ({ ...node, x: 32 + i * 600, y: 32 })),
  };
}
const malformed: Array<[string, (result: ElkNode) => ElkNode]> = [
  ["missing card", (r) => ({ ...r, children: r.children!.slice(1) })],
  [
    "duplicate card",
    (r) => ({ ...r, children: [r.children![0]!, r.children![0]!, ...r.children!.slice(2)] }),
  ],
  [
    "unknown card",
    (r) => ({ ...r, children: [{ ...r.children![0]!, id: "unknown" }, ...r.children!.slice(1)] }),
  ],
  [
    "wrong card dimensions",
    (r) => {
      r.children![0]!.width = 10;
      return r;
    },
  ],
  [
    "NaN coordinate",
    (r) => {
      r.children![0]!.x = NaN;
      return r;
    },
  ],
  [
    "overlarge coordinate",
    (r) => {
      r.children![0]!.x = 1e9;
      return r;
    },
  ],
  [
    "overlapping cards",
    (r) => {
      r.children![1]!.x = r.children![0]!.x;
      return r;
    },
  ],
  [
    "malformed children",
    (r) => {
      r.children![0]!.children = {} as any;
      return r;
    },
  ],
  [
    "unexpected nested cards",
    (r) => {
      r.children![0]!.children = [{ id: "extra", width: 260, height: 216, x: 0, y: 0 }];
      return r;
    },
  ],
  ["wrong root", (r) => ({ ...r, id: "other" })],
  ["unbounded root", (r) => ({ ...r, width: 1e9 })],
];
for (const [name, change] of malformed)
  test(`C4 refuses runner ${name} before changing source`, async () => {
    const m = model(),
      before = JSON.stringify(m);
    await assert.rejects(
      withEngine(
        m,
        "context",
        {},
        {
          engine: {
            async layout(root) {
              return change(flatReply(root));
            },
          },
        },
      ),
      VisualModelError,
    );
    assert.equal(JSON.stringify(m), before);
  });
test("absent routes are explicitly disclosed; layout positions remain usable", async () => {
  const m = model(),
    proposal = await withEngine(
      m,
      "context",
      {},
      {
        engine: {
          async layout(root) {
            return flatReply(root);
          },
        },
      },
    );
  assert.deepEqual(proposal.routing.edges, []);
  assert.equal(proposal.routing.omitted.length, 2);
  assert.ok(c4RoutingMatches(c4LayoutCandidate(m, proposal), "context", proposal.routing));
});
test("late abort and caller mutation cannot change the captured layout proposal", async () => {
  const m = model(),
    original = JSON.stringify(m),
    controller = new AbortController();
  let release!: (value: ElkNode) => void, input!: ElkNode;
  const pending = withEngine(
    m,
    "context",
    {},
    {
      signal: controller.signal,
      engine: {
        layout(root) {
          input = root;
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      },
    },
  );
  controller.abort();
  release(flatReply(input));
  await assert.rejects(pending);
  assert.equal(JSON.stringify(m), original);
  const source = model();
  const owned = withEngine(
    source,
    "context",
    {},
    {
      engine: {
        layout(root) {
          input = root;
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      },
    },
  );
  source.title = "Caller changed the envelope";
  source.revision = 8;
  (source.content.elements as any[])[0].label = "Caller mutation";
  release(flatReply(input));
  const proposal = await owned;
  assert.equal(proposal.base.revision, 1);
  assert.equal(proposal.patch.ifRevision, 1);
});
test("getters in layout output are refused before reading them", async () => {
  let touched = false;
  const result = Object.defineProperty({}, "children", {
    enumerable: true,
    get() {
      touched = true;
      return [];
    },
  });
  await assert.rejects(
    withEngine(
      model(),
      "context",
      {},
      {
        engine: {
          async layout() {
            return result as ElkNode;
          },
        },
      },
    ),
    VisualModelError,
  );
  assert.equal(touched, false);
});
test("parallel relationships retain separate routes and complete labels", async () => {
  let m = model();
  m = editModel(m, {
    items: [
      {
        field: "relationships",
        set: [
          {
            id: "second",
            source: "customer",
            target: "shop",
            label: "Checks order status",
            technology: "HTTPS",
          },
        ],
      },
    ],
  }).model;
  const p = await layoutC4(m, "context"),
    candidate = c4LayoutCandidate(m, p);
  assert.equal(p.edgeCount, 3);
  assert.equal(p.routing.edges.length, 3);
  const a = p.routing.edges.find((r) => r.id === "places")!,
    b = p.routing.edges.find((r) => r.id === "second")!;
  assert.notDeepEqual(a.points, b.points);
  assert.equal(
    c4RoutingLabels(c4Scene(candidate.content as unknown as C4Content, "context"), p.routing)
      .unplaced.length,
    0,
  );
});
