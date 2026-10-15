import assert from "node:assert/strict";
import test from "node:test";
import {
  assertVisualJson,
  assertVisualModel,
  createModel,
  createVisualRegistry,
  editModel,
  MemoryModelStore,
  VISUAL_FAMILIES,
  VisualModelError,
  type ModelCommand,
  type ModelStoreSnapshot,
  type VisualModel,
} from "../src/index.ts";

const context = { actor: "roundtrip", at: "2026-10-15T12:00:00Z" };
const invalid = (error: unknown) => error instanceof VisualModelError && error.code === "invalid";

test("generated metadata cannot turn an admitted create into an unreloadable model", async () => {
  const registry = createVisualRegistry([
    {
      ...VISUAL_FAMILIES.find((family) => family.id === "diagram")!,
      id: "payload",
      modelType: "payload",
      records: [],
      collections: {},
      validate: () => [],
      schema: {
        type: "object",
        properties: { payload: { type: "string", maxLength: 2_000_000 } },
        required: ["payload"],
        additionalProperties: false,
      },
    },
  ]);
  const input = {
    id: "large",
    title: "Large",
    renderer: "payload",
    content: { payload: "x".repeat(1_999_700) },
  };
  assert.doesNotThrow(() => assertVisualJson(input));
  assert.throws(() => createModel(input, context, registry), invalid);
  const store = new MemoryModelStore({ registry });
  await assert.rejects(
    store.preview({ type: "create", key: "oversize", model: input }, context),
    invalid,
  );
  await assert.rejects(
    store.execute({ type: "create", key: "oversize", model: input }, context),
    invalid,
  );
  assert.equal(store.getReceipt("oversize"), undefined);
  assert.equal(store.get("large"), undefined);
});

test("an envelope-growing edit fails atomically even when the content itself is small", async () => {
  const base = createModel(
    { id: "large", title: "A", renderer: "diagram", content: { nodes: [], edges: [] } },
    context,
  );
  const extended = { ...base, hostNote: "" };
  extended.hostNote = "x".repeat(2_000_000 - Buffer.byteLength(JSON.stringify(extended)) - 10);
  assertVisualModel(extended);
  const initial: ModelStoreSnapshot = {
    version: 1,
    models: [extended],
    receipts: [],
    inverses: [],
  };
  const store = new MemoryModelStore({ initial });
  assert.throws(() => editModel(extended, { title: "y".repeat(240) }, context), invalid);
  await assert.rejects(
    store.execute(
      { type: "edit", key: "too-large", id: "large", patch: { title: "y".repeat(240) } },
      context,
    ),
    invalid,
  );
  assert.deepEqual(store.snapshot(), initial);
  assert.equal(store.getReceipt("too-large"), undefined);
});

test("list clones only summaries and still owns nested host metadata", (t) => {
  const model = createModel(
    { id: "list", title: "Summary", renderer: "diagram", content: { nodes: [], edges: [] } },
    context,
  );
  const host = { ...model, metadata: { owner: "test" } };
  const store = new MemoryModelStore({
    initial: { version: 1, models: [host], receipts: [], inverses: [] },
  });
  const clone = globalThis.structuredClone;
  let bodies = 0;
  globalThis.structuredClone = ((value: unknown) => {
    if (value && typeof value === "object" && Object.hasOwn(value, "content")) bodies++;
    return clone(value);
  }) as typeof structuredClone;
  t.after(() => {
    globalThis.structuredClone = clone;
  });
  const summary = store.list()[0] as unknown as { metadata: { owner: string } };
  summary.metadata.owner = "changed by reader";
  assert.equal(bodies, 0);
  assert.equal((store.list()[0] as unknown as typeof summary).metadata.owner, "test");
});

function random(seed: number) {
  let value = seed;
  return () => (value = (Math.imul(1664525, value) + 1013904223) >>> 0) / 2 ** 32;
}
for (const seed of [7, 31, 101, 997, 2026]) {
  test(`seed ${seed}: mixed edits, undo, replacement and restart preserve identity and receipts`, async () => {
    const rng = random(seed);
    let store = new MemoryModelStore();
    await store.execute(
      {
        type: "create",
        key: "seed",
        model: {
          id: "graph",
          title: "Seeded model",
          renderer: "diagram",
          content: {
            nodes: [
              { id: "a", label: "A", x: 0, y: 0 },
              { id: "b", label: "B", x: 200, y: 0 },
            ],
            edges: [{ id: "ab", label: "A to B", source: "a", target: "b" }],
          },
        },
      },
      context,
    );
    let lastEdit: string | undefined;
    for (let step = 0; step < 60; step++) {
      const model = store.get("graph")!;
      const key = `seed-${seed}-${step}`;
      const choice = Math.floor(rng() * 7);
      let command: ModelCommand;
      if (choice === 0 && lastEdit)
        command = { type: "undo", id: "graph", key, operation: lastEdit };
      else if (choice === 1)
        command = {
          type: "edit",
          id: "graph",
          key,
          patch: { ifRevision: model.revision + 10, title: "Must be refused" },
        };
      else if (choice === 2)
        command = {
          type: "edit",
          id: "graph",
          key,
          patch: {
            ifRevision: model.revision,
            items: [
              { field: "nodes", replace: ["a"], set: [{ id: "a", label: `Lifetime ${step}` }] },
            ],
          },
        };
      else if (choice === 3)
        command = {
          type: "edit",
          id: "graph",
          key,
          patch: {
            ifRevision: model.revision,
            items: [{ field: "nodes", order: rng() > 0.5 ? ["b", "a"] : ["a", "b"] }],
          },
        };
      else if (choice === 4)
        command = {
          type: "edit",
          id: "graph",
          key,
          patch: {
            items: [
              {
                field: "nodes",
                set: [
                  {
                    id: "a",
                    x: step * 3,
                    expect: {
                      x: (model.content.nodes as { x: number }[]).find(
                        (_row, i) => (model.content.nodes as { id: string }[])[i].id === "a",
                      )!.x,
                    },
                  },
                ],
              },
            ],
          },
        };
      else
        command = {
          type: "edit",
          id: "graph",
          key,
          patch: { title: `Seed ${seed}, revision ${step}: ☃` },
        };
      const before = store.snapshot();
      try {
        const outcome = await store.execute(command, context);
        if (command.type === "edit") lastEdit = key;
        assert.equal(outcome.replayed, false);
        for (const stored of store.snapshot().models) assertVisualModel(stored);
        const committed = store.snapshot();
        store = new MemoryModelStore({ initial: JSON.parse(JSON.stringify(committed)) });
        assert.deepEqual(store.snapshot(), committed);
        assert.equal((await store.execute(command, context)).replayed, true);
        assert.deepEqual(store.snapshot(), committed);
      } catch (error) {
        assert.ok(error instanceof VisualModelError, `seed=${seed} step=${step}: ${String(error)}`);
        assert.ok(
          ["conflict", "not-found"].includes(error.code),
          `seed=${seed} step=${step}: ${error.message}`,
        );
        assert.deepEqual(store.snapshot(), before);
        assert.equal(store.getReceipt(key), undefined);
      }
    }
  });
}
