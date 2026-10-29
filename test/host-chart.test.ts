import assert from "node:assert/strict";
import test from "node:test";
import {
  chartSourceKey,
  createModel,
  editModel,
  createVisualRegistry,
  createVegaLiteFamily,
  VISUAL_FAMILIES,
  type VisualModel,
  VisualModelError,
} from "../src/index.ts";
import { prepareHostChart, prepareInlineChart } from "../src/render/inline-chart.ts";

const spec = {
  mark: "bar",
  encoding: {
    x: { field: "service", type: "nominal" },
    y: { field: "count", type: "quantitative" },
  },
};
const model = () =>
  createModel({
    id: "throughput",
    title: "Requests",
    renderer: "vega-lite",
    content: { datasource: "metrics", params: { scope: "services" }, spec },
  });
const rows = () => [
  { service: "API", count: 17 },
  { service: "Worker", count: 8 },
];
const resolved = (chart: VisualModel) => ({
  sourceKey: chartSourceKey(chart)!,
  revision: "snapshot-42",
  rows: rows(),
});
const unavailable = (error: unknown) =>
  error instanceof VisualModelError && error.code === "unavailable";

test("host-resolved rows are only presentation inputs, not committed model content", () => {
  const chart = model();
  const source = resolved(chart);
  assert.match(source.sourceKey, /^[a-f0-9]{64}$/);
  assert.equal(chart.content.values, undefined);
  const input = prepareHostChart(chart, source);
  assert.deepEqual(input.input.values, source.rows);
  assert.equal(input.source.sourceKey, source.sourceKey);
  assert.equal(input.source.revision, "snapshot-42");
  assert.match(input.source.digest, /^[a-f0-9]{64}$/);
  input.input.values[0]!.count = 99;
  input.input.spec.mark = "line";
  assert.equal(source.rows[0]!.count, 17, "consumer mutations leaked into host-owned rows");
  assert.equal(chart.content.spec, chart.content.spec);
  assert.deepEqual(chart.content.spec, spec);
  assert.equal(chart.content.values, undefined);
});

test("row source key follows the model lifetime and source inputs, but not metadata", () => {
  const chart = model();
  const source = resolved(chart);
  const renamed = editModel(chart, { title: "New label" }).model;
  assert.equal(chartSourceKey(renamed), source.sourceKey);
  assert.equal(prepareHostChart(renamed, source).source.revision, "snapshot-42");
  const changed = editModel(chart, {
    ifRevision: chart.revision,
    content: { params: { scope: "databases" } },
  }).model;
  assert.notEqual(chartSourceKey(changed), source.sourceKey);
  assert.throws(() => prepareHostChart(changed, source), unavailable);
  const generation = { ...chart, generation: "different-generation-000000000000" };
  assert.notEqual(chartSourceKey(generation), source.sourceKey);
  assert.throws(() => prepareHostChart(generation, source), VisualModelError);
});

test("source revisions and row digests describe independently changing data", () => {
  const chart = model(),
    source = resolved(chart);
  const first = prepareHostChart(chart, source);
  const second = prepareHostChart(chart, { ...source, rows: [{ service: "API", count: 25 }] });
  assert.notEqual(first.source.digest, second.source.digest);
  const third = prepareHostChart(chart, { ...source, revision: "snapshot-43" });
  assert.equal(first.source.digest, third.source.digest);
  assert.notEqual(first.source.revision, third.source.revision);
  assert.equal(first.source.sourceKey, third.source.sourceKey);
});

test("unbound and unrelated families cannot receive chart data", () => {
  const inline = createModel({
    id: "inline",
    title: "Inline",
    renderer: "vega-lite",
    content: { spec, values: rows() },
  });
  assert.equal(chartSourceKey(inline), undefined);
  assert.throws(() => prepareHostChart(inline, resolved(model())), unavailable);
  const diagram = createModel({
    id: "diagram",
    title: "Graph",
    renderer: "diagram",
    content: { nodes: [], edges: [] },
  });
  assert.equal(chartSourceKey(diagram), undefined);
  assert.throws(() => prepareHostChart(diagram, resolved(model())), unavailable);
  assert.throws(
    () => prepareInlineChart({ spec, datasource: "metrics", params: {}, values: rows() }),
    unavailable,
  );
});

test("source conflicts, arbitrary revision strings and stale keys refuse without loading", () => {
  const chart = model(),
    source = resolved(chart);
  const different = { ...source, sourceKey: "f".repeat(64) };
  assert.throws(() => prepareHostChart(chart, different), unavailable);
  assert.throws(() => prepareHostChart(chart, { ...source, revision: " " }), unavailable);
  assert.throws(
    () => prepareHostChart(chart, { ...source, revision: "x".repeat(129) }),
    unavailable,
  );
  assert.throws(
    () => prepareHostChart(chart, { ...source, revision: "http://other" }),
    unavailable,
  );
  const competing = createModel({
    id: "both",
    title: "Conflicting sources",
    renderer: "vega-lite",
    content: {
      spec,
      datasource: "metrics",
      values: [{ service: "A", count: 1 }],
    },
  });
  assert.throws(() => prepareHostChart(competing, resolved(competing)), unavailable);
});

test("host input uses the same strict spec policy and resource limits", () => {
  const chart = model(),
    source = resolved(chart);
  let accessed = false;
  const getter = { service: "secret" };
  Object.defineProperty(getter, "count", {
    enumerable: true,
    get() {
      accessed = true;
      return 99;
    },
  });
  assert.throws(() => prepareHostChart(chart, { ...source, rows: [getter] }), unavailable);
  assert.equal(accessed, false, "host row getter was invoked during validation");
  const secret = "CONFIDENTIAL-NEVER-REPORT";
  assert.throws(
    () => prepareHostChart(chart, { ...source, rows: [{ service: secret, count: Infinity }] }),
    (error: unknown) => unavailable(error) && !String(error).includes(secret),
  );
  assert.throws(
    () =>
      prepareHostChart(chart, {
        ...source,
        rows: Array.from({ length: 2001 }, (_, i) => ({ service: String(i), count: i })),
      }),
    unavailable,
  );
  const external = createModel({
    id: "invalid-source",
    title: "Invalid external spec",
    renderer: "vega-lite",
    content: {
      datasource: "metrics",
      params: {},
      spec: { ...spec, data: { url: "https://example.invalid/private" } },
    },
  });
  assert.throws(() => prepareHostChart(external, resolved(external)), unavailable);
});

test("host-bound connection references have their own opaque source identity", () => {
  const connected = createModel({
    id: "connected",
    title: "Connected data",
    renderer: "vega-lite",
    content: {
      spec,
      connection: {
        instanceId: "00000000-0000-0000-0000-000000000001",
        connectionId: "00000000-0000-0000-0000-000000000002",
      },
    },
  });
  const source = resolved(connected);
  assert.match(source.sourceKey, /^[a-f0-9]{64}$/);
  assert.deepEqual(prepareHostChart(connected, source).input.values, rows());
});

test("host source allowlists remain strict when a custom family registry is supplied", () => {
  const registry = createVisualRegistry(
    VISUAL_FAMILIES.map((family) =>
      family.id === "vega-lite"
        ? createVegaLiteFamily({ datasources: ["approved-metrics"] })
        : family,
    ),
  );
  const allowed = createModel(
    {
      id: "allowed",
      title: "Allowed",
      renderer: "vega-lite",
      content: { datasource: "approved-metrics", spec, params: { group: "a" } },
    },
    {},
    registry,
  );
  assert.deepEqual(prepareHostChart(allowed, resolved(allowed), registry).input.values, rows());
  assert.throws(
    () =>
      createModel(
        {
          id: "not-allowed",
          title: "Not allowed",
          renderer: "vega-lite",
          content: { datasource: "unapproved", spec, params: {} },
        },
        {},
        registry,
      ),
    (error: unknown) => error instanceof VisualModelError && error.code === "invalid",
  );
});
