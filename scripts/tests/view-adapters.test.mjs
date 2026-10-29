import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createModel, createVisualRegistry, VISUAL_FAMILIES } from "../../dist/index.js";
import { createVisualViewAdapters, VisualModelView } from "../../dist/react/index.js";

const scorecardFamily = {
  id: "scorecard",
  label: "Scorecard",
  category: "Analysis",
  description: "One identified score",
  modelType: "scorecard",
  version: 1,
  environment: "dom",
  records: ["items"],
  adapters: [{ adapter: "scorecard", capabilities: ["select", "edit"] }],
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,127}$" },
            label: { type: "string", minLength: 1, maxLength: 100 },
          },
          required: ["id", "label"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
  collections: { items: { search: ["label"] } },
};
const registry = createVisualRegistry([...VISUAL_FAMILIES, scorecardFamily]);
const model = createModel(
  {
    id: "scorecard",
    title: "Independent report",
    renderer: "scorecard",
    content: { items: [{ id: "quality", label: "Review" }] },
  },
  {},
  registry,
);
const Scorecard = ({ model }) =>
  createElement(
    "output",
    { "data-testid": "custom-scorecard" },
    model.content.items?.[0]?.label ?? "Graph override",
  );

test("custom families render through an instance-local trusted adapter registry", () => {
  const adapters = createVisualViewAdapters([{ id: "scorecard", component: Scorecard }]);
  assert.deepEqual(adapters.ids, ["scorecard"]);
  assert.ok(Object.isFrozen(adapters.ids));
  assert.equal(adapters.get("scorecard"), Scorecard);
  assert.equal(adapters.get("not-installed"), undefined);
  const view = renderToStaticMarkup(
    createElement(VisualModelView, { model, registry, viewAdapters: adapters }),
  );
  assert.match(view, /data-testid="custom-scorecard"/);
  assert.match(view, /Review/);
  const unsupported = renderToStaticMarkup(createElement(VisualModelView, { model, registry }));
  assert.match(unsupported, /no interactive adapter/);
  assert.doesNotMatch(unsupported, /data-testid="custom-scorecard"/);
});

test("adapters are declared by the model family, not selected by untrusted content", () => {
  const adapters = createVisualViewAdapters([{ id: "not-declared", component: Scorecard }]);
  const unsupported = renderToStaticMarkup(
    createElement(VisualModelView, { model, registry, viewAdapters: adapters }),
  );
  assert.match(unsupported, /no interactive adapter/);
  assert.doesNotMatch(unsupported, /data-testid="custom-scorecard"/);
});

test("host overrides a built-in visualization without changing the model grammar", () => {
  const builtin = createModel({
    id: "diagram",
    title: "Architecture",
    renderer: "diagram",
    content: { nodes: [{ id: "api", label: "API", x: 0, y: 0 }], edges: [] },
  });
  const adapters = createVisualViewAdapters([{ id: "diagram", component: Scorecard }]);
  const view = renderToStaticMarkup(
    createElement(VisualModelView, { model: builtin, viewAdapters: adapters }),
  );
  assert.match(view, /data-testid="custom-scorecard"/);
});

test("a lazy loader is stored once, not invoked by registry creation or lookup", () => {
  let calls = 0;
  const adapters = createVisualViewAdapters([
    {
      id: "scorecard",
      load: async () => {
        calls++;
        return { default: Scorecard };
      },
    },
  ]);
  assert.equal(adapters.get("scorecard"), adapters.get("scorecard"));
  assert.equal(calls, 0);
});

test("registry rejects ambiguous adapter identities and definitions", () => {
  assert.throws(
    () =>
      createVisualViewAdapters([
        { id: "scorecard", component: Scorecard },
        { id: "scorecard", component: Scorecard },
      ]),
    /unique/,
  );
  assert.throws(() => createVisualViewAdapters([{ id: "../bad", component: Scorecard }]), /unique/);
  assert.throws(() => createVisualViewAdapters([{ id: "broken" }]), /exactly one/);
  assert.throws(
    () =>
      createVisualViewAdapters([
        { id: "broken", component: Scorecard, load: async () => ({ default: Scorecard }) },
      ]),
    /exactly one/,
  );
});
