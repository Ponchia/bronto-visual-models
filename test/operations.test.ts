import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryModelStore,
  createModel,
  editModel,
  undoModel,
  createVisualRegistry,
  VISUAL_FAMILIES,
  VisualModelError,
  type VisualModel,
  type ModelCommand,
  modelTargets,
  resolveModelTarget,
  visualProjectionChoices,
  visualViewCapabilities,
  createVegaLiteFamily,
  createDiagramFamily,
  assertVisualModel,
  visualUndoChanges,
  type VisualFamily,
} from "../src/index.ts";
const content = () => ({
  nodes: [
    { id: "a", label: "App", x: 0, y: 0 },
    { id: "b", label: "Database", x: 300, y: 0 },
  ],
  edges: [{ id: "calls", source: "a", target: "b", label: "reads" }],
});
const create = (): ModelCommand => ({
  type: "create",
  key: "create-graph",
  model: { id: "graph", title: "Architecture", renderer: "diagram", content: content() },
});
const context = { actor: "tester", at: "2026-10-14T10:00:00Z" };
const model = () =>
  createModel(
    { id: "graph", title: "Architecture", renderer: "diagram", content: content() },
    context,
  );
function code(expected: string) {
  return (error: unknown) => error instanceof VisualModelError && error.code === expected;
}
async function store() {
  const store = new MemoryModelStore();
  await store.execute(create(), context);
  return store;
}

test("portable model has no required Spatial estate, canvas, transport or storage", () => {
  const value = model();
  assertVisualModel(value);
  assert.equal(Object.hasOwn(value, "estate"), false);
  assert.equal(value.renderer, "diagram");
  assert.equal(value.modelType, "graph");
  assert.deepEqual(
    visualProjectionChoices(value).map((view) => view.id),
    ["diagram", "network", "matrix"],
  );
  assert.equal(modelTargets(value).length, 3);
});
test("edits retain host extensions without learning their policy", () => {
  const host = { ...model(), estate: "private-host-scope", metadata: { owner: "alice" } };
  const result = editModel(host, { title: "Renamed" }, context);
  assert.equal(result.model.estate, host.estate);
  assert.deepEqual(result.model.metadata, host.metadata);
  assert.equal(host.title, "Architecture");
});
test("expectations preserve unrelated manual layout while an agent renames a node", () => {
  const original = model();
  const manual = editModel(
    original,
    { items: [{ field: "nodes", set: [{ id: "a", x: 44, expect: { x: 0 } }] }] },
    context,
  ).model;
  const agent = editModel(
    manual,
    { items: [{ field: "nodes", set: [{ id: "a", label: "Web", expect: { label: "App" } }] }] },
    context,
  ).model;
  assert.equal((agent.content.nodes as any[])[0].x, 44);
  assert.equal((agent.content.nodes as any[])[0].label, "Web");
});
test("stale field edit is refused and input stays byte-for-byte unchanged", () => {
  const original = model();
  const before = JSON.stringify(original);
  assert.throws(
    () =>
      editModel(
        original,
        { items: [{ field: "nodes", set: [{ id: "a", x: 44, expect: { x: 99 } }] }] },
        context,
      ),
    code("conflict"),
  );
  assert.equal(JSON.stringify(original), before);
});
test("later collection error cannot leak an earlier partial edit", () => {
  const original = model();
  const before = JSON.stringify(original);
  assert.throws(
    () =>
      editModel(
        original,
        {
          items: [
            { field: "nodes", set: [{ id: "a", label: "Would leak" }] },
            { field: "edges", set: [{ id: "calls", target: "missing" }] },
          ],
        },
        context,
      ),
    code("invalid"),
  );
  assert.equal(JSON.stringify(original), before);
});
test("content replacement, collection order and subject replacement require revision guards", () => {
  const original = model();
  assert.throws(
    () => editModel(original, { content: content() }, context),
    code("precondition-required"),
  );
  assert.throws(
    () => editModel(original, { items: [{ field: "nodes", order: ["b", "a"] }] }, context),
    code("precondition-required"),
  );
  assert.throws(
    () => editModel(original, { ifRevision: 9, title: "Stale" }, context),
    code("conflict"),
  );
  assert.throws(
    () => editModel(original, { generation: "different-lifetime", title: "Stale" }, context),
    code("conflict"),
  );
});
test("removal cascades preserve graph integrity", () => {
  const result = editModel(model(), { items: [{ field: "nodes", remove: ["a"] }] }, context);
  assert.deepEqual(result.model.content.edges, []);
  assert.equal(
    result.removed.some((entry) => entry.collection === "edges" && entry.ids.includes("calls")),
    true,
  );
});
test("undo preserves a disjoint later edit", () => {
  const original = model();
  const first = editModel(original, { title: "Changed" }, context);
  const later = editModel(first.model, { description: "Unrelated later work" }, context);
  const inverse = {
    key: "first",
    id: original.id,
    generation: original.generation,
    at: context.at,
    identityVersion: 2 as const,
    changes: first.changes,
  };
  const result = undoModel(later.model, inverse, context);
  assert.equal(result.model.title, original.title);
  assert.equal(result.model.description, "Unrelated later work");
});
test("undo refuses a superseding edit instead of reverting it", () => {
  const original = model();
  const first = editModel(original, { title: "First" }, context);
  const later = editModel(first.model, { title: "Second" }, context);
  assert.throws(
    () =>
      undoModel(
        later.model,
        {
          key: "first",
          id: original.id,
          generation: original.generation,
          at: context.at,
          identityVersion: 2,
          changes: first.changes,
        },
        context,
      ),
    code("conflict"),
  );
});
test("replaced element does not inherit a captured subject identity", () => {
  const original = model();
  const target = modelTargets(original).find((entry) => entry.elementId === "a")!;
  const replaced = editModel(
    original,
    {
      ifRevision: 1,
      items: [{ field: "nodes", replace: ["a"], set: [{ id: "a", label: "New subject" }] }],
    },
    context,
  ).model;
  assert.equal(resolveModelTarget(replaced, target).state, "stale");
});
test("timeline timestamps are normalized and ambiguous local time is refused", () => {
  const createTimeline = (start: unknown) =>
    createModel(
      {
        id: "time",
        title: "Timeline",
        renderer: "timeline",
        content: {
          lanes: [{ id: "lane", label: "Work" }],
          events: [{ id: "event", label: "Start", lane: "lane", start }],
        },
      },
      context,
    );
  assert.equal(
    (createTimeline("2026-10-14T12:00:00+02:00").content.events as any[])[0].start,
    Date.parse(context.at),
  );
  assert.throws(() => createTimeline("2026-10-14T12:00:00"), code("invalid"));
});
test("immutable templates and snapshots must be forked before editing", () => {
  for (const role of ["template", "snapshot"] as const)
    assert.throws(
      () => editModel({ ...model(), role }, { title: "No" }, context),
      code("forbidden"),
    );
});
test("same key, same command replays once, including after snapshot restoration", async () => {
  const initial = await store();
  const replay = await initial.execute(create(), context);
  assert.equal(replay.replayed, true);
  assert.equal(initial.get("graph")?.revision, 1);
  assert.equal(replay.receipt.changes, undefined);
  const restored = new MemoryModelStore({ initial: initial.snapshot() });
  assert.deepEqual(await restored.execute(create(), context), replay);
});
test("same key with another request or actor is a conflict", async () => {
  const initial = await store();
  const another = create();
  if (another.type === "create") another.model.title = "Another";
  await assert.rejects(initial.execute(another, context), code("conflict"));
  await assert.rejects(
    initial.execute(create(), { ...context, actor: "intruder" }),
    code("conflict"),
  );
});
test("replays recheck current authorization", async () => {
  const initial = await store();
  let checked = 0;
  await assert.rejects(
    initial.execute(create(), {
      ...context,
      authorize() {
        checked++;
        throw new VisualModelError("forbidden", "Access revoked");
      },
    }),
    code("forbidden"),
  );
  assert.equal(checked, 1);
  assert.equal(initial.get("graph")?.revision, 1);
});
test("simultaneous disjoint edits serialize without lost updates", async () => {
  const initial = await store();
  await Promise.all([
    initial.execute(
      {
        type: "edit",
        key: "a",
        id: "graph",
        patch: {
          items: [
            { field: "nodes", set: [{ id: "a", label: "Frontend", expect: { label: "App" } }] },
          ],
        },
      },
      context,
    ),
    initial.execute(
      {
        type: "edit",
        key: "b",
        id: "graph",
        patch: {
          items: [
            { field: "nodes", set: [{ id: "b", label: "Storage", expect: { label: "Database" } }] },
          ],
        },
      },
      context,
    ),
  ]);
  assert.deepEqual(
    (initial.get("graph")!.content.nodes as any[]).map((node) => node.label),
    ["Frontend", "Storage"],
  );
  assert.equal(initial.get("graph")?.revision, 3);
});
test("simultaneous same-field edits cannot both pass the same expectation", async () => {
  const initial = await store();
  const results = await Promise.allSettled(
    ["A", "B"].map((label) =>
      initial.execute(
        {
          type: "edit",
          key: label,
          id: "graph",
          patch: {
            items: [{ field: "nodes", set: [{ id: "a", label, expect: { label: "App" } }] }],
          },
        },
        context,
      ),
    ),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(initial.get("graph")?.revision, 2);
});
test("input mutation during an awaited authorizer cannot change the committed request", async () => {
  const initial = new MemoryModelStore();
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const command = create();
  const pending = initial.execute(command, { ...context, authorize: () => paused });
  if (command.type === "create") command.model.title = "Changed outside";
  release();
  await pending;
  assert.equal(initial.get("graph")?.title, "Architecture");
});
test("failed authorization leaves no receipt and does not poison the next transaction", async () => {
  const initial = new MemoryModelStore();
  await assert.rejects(
    initial.execute(create(), {
      ...context,
      authorize: async () => {
        throw new Error("no");
      },
    }),
  );
  assert.equal(initial.snapshot().receipts.length, 0);
  assert.equal((await initial.execute(create(), context)).replayed, false);
});
test("listener failures and mutated read snapshots cannot affect stored data", async () => {
  const initial = new MemoryModelStore();
  initial.subscribe(() => {
    throw new Error("observer");
  });
  await initial.execute(create(), context);
  const read = initial.get("graph")!;
  read.title = "Mutated";
  (read.content.nodes as any[])[0].x = 999;
  assert.equal(initial.get("graph")?.title, "Architecture");
  assert.equal((initial.get("graph")!.content.nodes as any[])[0].x, 0);
});
test("receipt capacity refuses new writes but never discards retry history", async () => {
  const initial = new MemoryModelStore({ maxReceipts: 1 });
  await initial.execute(create(), context);
  await assert.rejects(
    initial.execute(
      { type: "edit", key: "full", id: "graph", patch: { title: "No room" } },
      context,
    ),
    code("unavailable"),
  );
  assert.equal((await initial.execute(create(), context)).replayed, true);
  assert.equal(initial.get("graph")?.revision, 1);
});
test("fork creates independent identity and preserves source provenance", async () => {
  const initial = await store();
  await initial.execute(
    { type: "fork", key: "fork", id: "graph", fork: { id: "copy", ifRevision: 1 } },
    context,
  );
  const copy = initial.get("copy")!;
  assert.notEqual(copy.generation, initial.get("graph")!.generation);
  assert.deepEqual(copy.source, { id: "graph", revision: 1 });
  assert.notEqual(
    copy.elementIncarnations!.nodes!.a,
    initial.get("graph")!.elementIncarnations!.nodes!.a,
  );
});
test("custom registries are instance-local, including targets, edits and projections", () => {
  const builtin = VISUAL_FAMILIES.find((family) => family.id === "diagram")!;
  const custom: VisualFamily = {
    ...builtin,
    id: "dependency-map",
    modelType: "dependencies",
    adapters: [
      {
        adapter: "external",
        projection: { id: "custom-view", label: "Custom", requirement: "graph" },
        capabilities: ["select"],
      },
    ],
  };
  const registry = createVisualRegistry([custom]);
  const value = createModel(
    { id: "custom", title: "External", renderer: custom.id, content: content() },
    context,
    registry,
  );
  assert.equal(modelTargets(value, registry).length, 3);
  assert.equal(editModel(value, { title: "Updated" }, context, registry).model.title, "Updated");
  assert.deepEqual(
    visualProjectionChoices(value, registry).map((view) => view.id),
    ["custom-view"],
  );
  assert.deepEqual(visualViewCapabilities(value, "custom-view", registry), ["select"]);
  assert.throws(
    () =>
      createModel(
        { id: "missing", title: "Missing", renderer: custom.id, content: content() },
        context,
      ),
    code("invalid"),
  );
});
test("host source allowlist stays stricter than the portable grammar", () => {
  const registry = createVisualRegistry([createVegaLiteFamily({ datasources: ["dataset"] })]);
  const value = { spec: { mark: "bar" }, datasource: "unknown-service" };
  assert.throws(() => registry.validate("vega-lite", "chart", value), code("invalid"));
});
test("host link policy is supplied, not bypassed by extraction", () => {
  const registry = createVisualRegistry([createDiagramFamily({ linkPattern: "^/c/[a-z]+$" })]);
  const value = content();
  (value.nodes[0] as any).href = "https://example.org";
  assert.throws(() => registry.validate("diagram", "graph", value), code("invalid"));
});
test("duplicate family registration is refused, caller definitions remain unfrozen", () => {
  const family = { ...VISUAL_FAMILIES[0] };
  assert.throws(() => createVisualRegistry([family, family]), code("invalid"));
  createVisualRegistry([family]);
  assert.equal(Object.isFrozen(family), false);
});
test("malformed command envelopes fail as structured validation errors", async () => {
  for (const input of [
    null,
    [],
    3,
    { type: "create", key: "x" },
    { type: "edit", key: "x", id: "graph" },
    { type: "oops", key: "x" },
  ])
    await assert.rejects(new MemoryModelStore().execute(input as ModelCommand), code("invalid"));
});
test("missing timestamps cannot be silently replaced on stored documents", () => {
  const value = model();
  delete (value as any).createdAt;
  assert.throws(() => assertVisualModel(value), code("invalid"));
});
test("portable links permit explicit HTTP or local paths, never script or protocol-relative URLs", () => {
  for (const href of [
    "https://external.example",
    "http://localhost/path",
    "/docs/item",
    "#chapter",
  ]) {
    const value = content();
    (value.nodes[0] as any).href = href;
    assert.doesNotThrow(() =>
      createModel({ id: "linked", title: "Linked", renderer: "diagram", content: value }, context),
    );
  }
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//external.example",
    "https://bad host.example",
  ]) {
    const value = content();
    (value.nodes[0] as any).href = href;
    assert.throws(
      () =>
        createModel(
          { id: "linked", title: "Linked", renderer: "diagram", content: value },
          context,
        ),
      code("invalid"),
    );
  }
});
test("validation rejects executable object accessors without invoking them", () => {
  let reads = 0;
  const unsafe = {
    get title() {
      reads++;
      return "Unexpected";
    },
  };
  assert.throws(() => createModel(unsafe as any), code("invalid"));
  assert.equal(reads, 0);
  assert.throws(() => createModel(new Date() as any), code("invalid"));
});
test("imported inverse cannot rewrite model IDs or prototype-bearing fields", () => {
  const original = model();
  for (const field of ["id", "generation", "renderer", "__proto__", "constructor"]) {
    const record = {
      key: "unsafe",
      id: original.id,
      generation: original.generation,
      at: context.at,
      identityVersion: 2 as const,
      changes: [
        {
          field,
          before: { present: true, value: "other" },
          after: { present: true, value: (original as any)[field] ?? null },
        },
      ],
    };
    assert.throws(() => undoModel(original, record, context), code("invalid"));
  }
});
test("array validation does not execute accessors or inherited serializers", () => {
  let reads = 0;
  const nodes: unknown[] = [];
  Object.defineProperty(nodes, "0", {
    get() {
      reads++;
      return {};
    },
    enumerable: true,
  });
  assert.throws(
    () =>
      createModel({
        id: "unsafe",
        title: "Unsafe",
        renderer: "diagram",
        content: { nodes, edges: [] },
      }),
    code("invalid"),
  );
  assert.equal(reads, 0);
  const named: unknown[] = [];
  Object.defineProperty(named, "toJSON", {
    value() {
      reads++;
      return [];
    },
    enumerable: false,
  });
  assert.throws(
    () =>
      createModel({
        id: "unsafe",
        title: "Unsafe",
        renderer: "diagram",
        content: { nodes: named, edges: [] },
      }),
    code("invalid"),
  );
  assert.equal(reads, 0);
});
