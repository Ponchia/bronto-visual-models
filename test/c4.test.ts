import assert from "node:assert/strict";
import test from "node:test";
import {
  createModel,
  editModel,
  MemoryModelStore,
  VisualModelError,
  modelTargets,
  resolveModelTarget,
  resolveVisualProjection,
  visualContentAdvice,
  type C4Content,
} from "../src/index.ts";
import { c4Scene, c4RecordEdit, c4PositionEdit } from "../src/render/c4.ts";
import { C4_TEMPLATES } from "../src/c4-templates.ts";
const sample = () => structuredClone(C4_TEMPLATES[0]!.content) as unknown as C4Content;
const model = () => createModel({ id: "architecture", title: "Commerce", template: "c4-commerce" });
const invalid = (error: unknown) => error instanceof VisualModelError && error.code === "invalid";
const conflict = (error: unknown) => error instanceof VisualModelError && error.code === "conflict";
const create = (content: C4Content) =>
  createModel({
    id: "architecture",
    title: "Commerce",
    renderer: "c4",
    content: content as unknown as Record<string, unknown>,
  });

test("C4 has its own family, identified records and scoped diagrams, not matrix coercion", () => {
  const m = model();
  assert.equal(m.renderer, "c4");
  assert.equal(m.modelType, "c4");
  assert.equal(resolveVisualProjection(m), "c4");
  assert.equal(resolveVisualProjection(m, "matrix"), undefined);
  assert.deepEqual(
    new Set(modelTargets(m).map((t) => t.collection)),
    new Set(["elements", "relationships", "views"]),
  );
  const c = m.content as unknown as C4Content;
  const context = c4Scene(c, "context"),
    containers = c4Scene(c, "containers"),
    components = c4Scene(c, "components");
  assert.deepEqual(
    context.elements.map((e) => e.element.id),
    ["customer", "shop", "payments"],
  );
  assert.deepEqual(
    context.relationships.map((r) => r.id),
    ["places", "charges"],
  );
  assert.equal(context.boundary, undefined);
  assert.equal(containers.boundary?.element.id, "shop");
  assert.equal(components.boundary?.element.id, "api");
  assert.ok(components.elements.some((e) => e.element.id === "database"));
  assert.ok(!components.elements.some((e) => e.element.id === "api"));
  assert.throws(() => c4Scene(c, "missing"), /does not exist/);
});

const malformed: Array<[string, (c: C4Content) => void]> = [
  [
    "orphan container",
    (c) => {
      c.elements.find((e) => e.id === "api")!.parentId = "missing";
    },
  ],
  [
    "component directly in system",
    (c) => {
      c.elements.find((e) => e.id === "checkout")!.parentId = "shop";
    },
  ],
  [
    "parent cycle",
    (c) => {
      c.elements.find((e) => e.id === "shop")!.parentId = "api";
    },
  ],
  [
    "missing technology",
    (c) => {
      delete c.elements.find((e) => e.id === "api")!.technology;
    },
  ],
  [
    "blank responsibility",
    (c) => {
      c.elements[0]!.description = " ";
    },
  ],
  [
    "blank relationship",
    (c) => {
      c.relationships[0]!.label = " ";
    },
  ],
  [
    "absent endpoint",
    (c) => {
      c.relationships[0]!.target = "missing";
    },
  ],
  [
    "self relationship",
    (c) => {
      c.relationships[0]!.target = c.relationships[0]!.source;
    },
  ],
  [
    "context including container",
    (c) => {
      c.views[0]!.elementIds.push("api");
    },
  ],
  [
    "context missing scope",
    (c) => {
      c.views[0]!.elementIds = ["customer", "payments"];
    },
  ],
  [
    "wrong component scope",
    (c) => {
      c.views[2]!.scope = "shop";
    },
  ],
  [
    "foreign container",
    (c) => {
      c.elements.find((e) => e.id === "api")!.parentId = "payments";
    },
  ],
  [
    "duplicated inclusion",
    (c) => {
      c.views[0]!.elementIds.push("customer");
    },
  ],
  [
    "unknown inclusion",
    (c) => {
      c.views[0]!.elementIds.push("missing");
    },
  ],
  [
    "relationship outside diagram",
    (c) => {
      c.views[0]!.relationshipIds = ["submits"];
    },
  ],
  [
    "duplicate relationship",
    (c) => {
      c.views[0]!.relationshipIds = ["charges", "charges"];
    },
  ],
  [
    "unknown position",
    (c) => {
      c.views[0]!.positions = [{ elementId: "api", x: 0, y: 0 }];
    },
  ],
  [
    "duplicate position",
    (c) => {
      c.views[0]!.positions = [
        { elementId: "shop", x: 0, y: 0 },
        { elementId: "shop", x: 1, y: 1 },
      ];
    },
  ],
  [
    "nonfinite coordinate",
    (c) => {
      c.views[0]!.positions = [{ elementId: "shop", x: Infinity, y: 0 }];
    },
  ],
  [
    "unknown diagram kind",
    (c) => {
      (c.views[0] as any).kind = "deployment";
    },
  ],
  [
    "unimplemented source execution",
    (c) => {
      (c as any).source = "!include https://example.invalid";
    },
  ],
];
for (const [name, change] of malformed)
  test(`C4 refuses ${name} without mutating input`, () => {
    const content = sample();
    change(content);
    const before = structuredClone(content);
    assert.throws(() => create(content), invalid);
    assert.deepEqual(content, before);
  });

test("explicit relation inclusion never invents or rolls up a relationship", () => {
  const c = sample();
  c.views[0]!.relationshipIds = [];
  const m = create(c);
  assert.deepEqual(c4Scene(m.content as unknown as C4Content, "context").relationships, []);
  assert.equal((m.content.relationships as unknown[]).length, c.relationships.length);
  delete c.views[0]!.relationshipIds;
  c.relationships = c.relationships.filter((r) => r.id !== "charges");
  assert.deepEqual(
    c4Scene(c, "context").relationships.map((r) => r.id),
    ["places"],
  );
});

test("protocol advice is semantic guidance, not a schema or network side effect", () => {
  const c = sample();
  delete c.relationships.find((r) => r.id === "submits")!.technology;
  const m = create(c);
  const before = JSON.stringify(m);
  assert.ok(
    visualContentAdvice("c4", m.content).some(
      (i) => i.path.join(".") === "relationships.submits.technology",
    ),
  );
  assert.equal(JSON.stringify(m), before);
});

test("C4 preview, replay, undo and restart preserve model and element identities", async () => {
  const store = new MemoryModelStore();
  await store.execute({
    type: "create",
    key: "create",
    model: { id: "architecture", title: "C4", template: "c4-commerce" },
  });
  const before = store.get("architecture")!;
  const target = modelTargets(before).find(
    (t) => t.collection === "elements" && t.elementId === "api",
  )!;
  const command = {
    type: "edit" as const,
    key: "rename",
    id: before.id,
    patch: c4RecordEdit(before, "elements", "api", { label: "Checkout API" }),
  };
  const preview = await store.preview(command);
  assert.equal(preview.effect, "none");
  assert.deepEqual(store.get(before.id), before);
  await store.execute(command);
  assert.equal((await store.execute(command)).replayed, true);
  const changed = store.get(before.id)!;
  assert.equal(resolveModelTarget(changed, target).state, "changed");
  const restored = new MemoryModelStore({ initial: store.snapshot() });
  assert.deepEqual(restored.snapshot(), store.snapshot());
  await restored.execute({ type: "undo", key: "undo", id: before.id, operation: "rename" });
  assert.deepEqual(restored.get(before.id)!.content, before.content);
  assert.deepEqual(restored.get(before.id)!.elementIncarnations, before.elementIncarnations);
});

test("view-local layout edits leave other diagrams and architecture semantics unchanged", () => {
  const m = model(),
    before = JSON.stringify(m);
  const positions = [{ elementId: "shop", x: 123, y: 456 }];
  const patch = c4PositionEdit(m, "context", positions);
  positions[0]!.x = 999;
  const changed = editModel(m, patch).model;
  const old = m.content as unknown as C4Content,
    next = changed.content as unknown as C4Content;
  assert.deepEqual(next.elements, old.elements);
  assert.deepEqual(next.relationships, old.relationships);
  assert.deepEqual(next.views.slice(1), old.views.slice(1));
  assert.equal(c4Scene(next, "context").elements.find((e) => e.element.id === "shop")!.x, 123);
  assert.equal(JSON.stringify(m), before);
  assert.throws(() => editModel(changed, patch), conflict);
});

test("stale details and replaced identities refuse writes, never resurrect old targets", () => {
  const m = model(),
    patch = c4RecordEdit(m, "elements", "api", { label: "Draft" });
  const other = editModel(m, { title: "Other writer" }).model;
  assert.throws(() => editModel(other, patch), conflict);
  const target = modelTargets(m).find((t) => t.collection === "elements" && t.elementId === "api")!;
  const replaced = editModel(m, {
    ifRevision: m.revision,
    items: [{ field: "elements", replace: ["api"], set: [{ id: "api", label: "Replacement" }] }],
  }).model;
  assert.equal(resolveModelTarget(replaced, target).state, "stale");
  assert.throws(() => editModel(replaced, patch), conflict);
});

test("referenced removals refuse atomically instead of deleting diagrams or leaving dangling data", () => {
  const m = model(),
    before = JSON.stringify(m);
  assert.throws(
    () =>
      editModel(m, { ifRevision: m.revision, items: [{ field: "elements", remove: ["shop"] }] }),
    invalid,
  );
  assert.equal(JSON.stringify(m), before);
});

test("empty and explicitly unknown views are distinct; schema bounds remain enforced", () => {
  const c = sample();
  c.views = [];
  assert.doesNotThrow(() => create(c));
  assert.throws(() => c4Scene(c, "context"), /does not exist/);
  c.views = Array.from({ length: 65 }, (_, i) => ({
    id: `v${i}`,
    kind: "landscape",
    label: "Landscape",
    elementIds: [],
  }));
  assert.throws(() => create(c), invalid);
});
