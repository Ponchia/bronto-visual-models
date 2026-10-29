import assert from "node:assert/strict";
import test from "node:test";
import { prepareInlineChart, inlineChartLoader } from "../src/render/inline-chart.ts";
import { chartCellText, chartTablePage } from "../src/render/chart-table.ts";
import { VisualModelError } from "../src/model.ts";
const base = () => ({
  spec: {
    mark: "bar",
    encoding: {
      x: { field: "label", type: "nominal" },
      y: { field: "value", type: "quantitative" },
    },
  },
  values: [{ label: "A", value: 2 }],
});
const unavailable = (error: unknown) =>
  error instanceof VisualModelError && error.code === "unavailable";

test("inline chart preparation owns spec and rows without altering saved content", () => {
  const content = base(),
    before = JSON.stringify(content);
  const ready = prepareInlineChart(content);
  assert.equal(ready.fill, "fit");
  ready.values[0]!.value = 99;
  ready.spec.title = "Changed by compiler";
  assert.equal(JSON.stringify(content), before);
});
test("empty inline rows and inert URL/HTML text remain valid data", () => {
  assert.deepEqual(prepareInlineChart({ ...base(), values: [] }).values, []);
  const values = [
    {
      label: '<img src="https://example.invalid/image">',
      link: "https://example.invalid/",
      value: 1,
    },
  ];
  assert.deepEqual(prepareInlineChart({ ...base(), values }).values, values);
});
test("fitted layers and independently sized compositions are distinguished", () => {
  assert.equal(
    prepareInlineChart({ values: [], spec: { layer: [{ mark: "bar" }, { mark: "point" }] } }).fill,
    "fit",
  );
  assert.equal(
    prepareInlineChart({
      values: [],
      spec: {
        hconcat: [
          { mark: "bar", width: 200 },
          { mark: "point", width: 200 },
        ],
      },
    }).fill,
    "composed",
  );
});
for (const [name, spec] of [
  ["top-level URL", { ...base().spec, data: { url: "https://example.invalid/data.json" } }],
  [
    "nested layer",
    { layer: [{ mark: "bar", data: { url: "https://example.invalid/layer.json" } }] },
  ],
  ["composed source", { hconcat: [{ mark: "point", data: { values: [] } }] }],
  ["named data", { ...base().spec, datasets: { other: [] } }],
  [
    "lookup data",
    { ...base().spec, transform: [{ lookup: "key", from: { data: { url: "file:///secret" } } }] },
  ],
  ["image mark", { mark: "image" }],
  ["object image mark", { mark: { type: "image" } }],
  ["href encoding", { mark: "point", encoding: { href: { field: "url" } } }],
  [
    "external element binding",
    { mark: "point", params: [{ name: "p", value: 1, bind: { element: "#host" } }] },
  ],
  ["legacy selection", { mark: "point", selection: { picked: { type: "single" } } }],
] as const) {
  test(`reference chart refuses ${name} without rewriting it`, () => {
    const content = { spec, values: [] },
      original = JSON.stringify(content);
    assert.throws(() => prepareInlineChart(content), unavailable);
    assert.equal(JSON.stringify(content), original);
  });
}
for (const field of ["datasource", "params", "connection"]) {
  test(`a host ${field} is never silently ignored`, () => {
    const hostField =
      field === "datasource"
        ? "dataset"
        : field === "params"
          ? {}
          : {
              instanceId: "00000000-0000-0000-0000-000000000000",
              connectionId: "00000000-0000-0000-0000-000000000001",
            };
    assert.throws(() => prepareInlineChart({ ...base(), [field]: hostField }), unavailable);
  });
}
test("authored annotation loss is refused, not rendered as a complete chart", () => {
  assert.throws(
    () =>
      prepareInlineChart({
        ...base(),
        annotations: [{ id: "note", note: { title: "Keep this" } }],
      }),
    unavailable,
  );
  assert.equal(prepareInlineChart({ ...base(), annotations: [] }).values.length, 1);
});
test("the underlying row and JSON resource bounds are retained", () => {
  assert.throws(
    () =>
      prepareInlineChart({ ...base(), values: Array.from({ length: 2001 }, () => ({ value: 1 })) }),
    VisualModelError,
  );
  let accessed = false;
  const content = {
    get spec() {
      accessed = true;
      return {};
    },
    values: [],
  };
  assert.throws(() => prepareInlineChart(content), VisualModelError);
  assert.equal(accessed, false);
  assert.throws(() => prepareInlineChart({ values: [] }), VisualModelError);
});
test("every loader entry point refuses rather than performing a network or filesystem read", async () => {
  for (const entry of Object.values(inlineChartLoader()))
    await assert.rejects(
      entry(),
      (error: unknown) => error instanceof VisualModelError && error.code === "forbidden",
    );
});
test("table pages retain row order, union sparse columns and clamp after row count shrinks", () => {
  const rows = Array.from({ length: 31 }, (_, index) => ({
    label: `Row ${index + 1}`,
    ...(index === 30 ? { last: true } : {}),
  }));
  const page = chartTablePage(rows, 1);
  assert.deepEqual(page.columns, ["label", "last"]);
  assert.equal(page.start, 25);
  assert.equal(page.rows.length, 6);
  assert.equal(page.total, 31);
  assert.equal(page.rows[0]!.label, "Row 26");
  assert.equal(chartTablePage(rows.slice(0, 3), 1).page, 0);
  assert.equal(chartTablePage([], 999).pageCount, 1);
  for (const bad of [-1, 0.5, Infinity, NaN])
    assert.throws(() => chartTablePage(rows, bad), VisualModelError);
});
test("table display truncation is bounded and disclosed, not lost from stored rows", () => {
  const rows = [
    Object.fromEntries(Array.from({ length: 45 }, (_, index) => [`col-${index}`, index])),
  ];
  const page = chartTablePage(rows);
  assert.equal(page.columns.length, 40);
  assert.equal(page.omittedColumns, 5);
  assert.equal(Object.keys(rows[0]!).length, 45);
  assert.equal(chartCellText(undefined), "—");
  assert.equal(chartCellText(null), "null");
  assert.equal(chartCellText(0), "0");
  assert.equal(chartCellText(false), "false");
  assert.equal(chartCellText("x".repeat(300)).length, 240);
  assert.equal(chartCellText("<script>alert(1)</script>"), "<script>alert(1)</script>");
});

test("bounded Vega-Lite point and interval selections remain local and preserve source", () => {
  const spec = {
    mark: "point",
    params: [
      { name: "picked", select: { type: "point", encodings: ["x"], toggle: false } },
      { name: "brush", select: { type: "interval", encodings: ["x", "y"], clear: false } },
    ],
    encoding: {
      x: { field: "label", type: "nominal" },
      y: { field: "value", type: "quantitative" },
      opacity: { condition: { param: "picked", empty: false, value: 1 }, value: 0.25 },
    },
  };
  const content = { spec, values: [{ label: "Alpha", value: 2 }] };
  const before = JSON.stringify(content);
  const prepared = prepareInlineChart(content);
  assert.deepEqual(prepared.spec.params, spec.params);
  assert.equal(JSON.stringify(content), before);
  (prepared.spec.params as Array<Record<string, unknown>>)[0]!.name = "changed";
  prepared.values[0]!.value = 99;
  assert.equal(JSON.stringify(content), before);
});

test("simple shorthand local selections are available without event bindings", () => {
  for (const kind of ["point", "interval"] as const) {
    const content = {
      ...base(),
      spec: { ...base().spec, params: [{ name: "sel", select: kind }] },
    };
    assert.deepEqual(prepareInlineChart(content).spec.params, content.spec.params);
  }
  const content = {
    ...base(),
    spec: {
      ...base().spec,
      params: [
        {
          name: "sel",
          select: {
            type: "point",
            fields: ["Field with spaces", "metric.value"],
            nearest: false,
            clear: false,
            resolve: "global",
          },
        },
      ],
    },
  };
  assert.deepEqual(prepareInlineChart(content).spec.params, content.spec.params);
});

for (const [reason, params] of [
  ["no selections", []],
  [
    "too many selections",
    Array.from({ length: 5 }, (_, i) => ({ name: "sel_" + i, select: "point" })),
  ],
  ["non-selection parameter", [{ name: "x", value: 1 }]],
  ["parameter bound to input", [{ name: "bound", select: "point", bind: { element: "#control" } }]],
  ["selection initialized from data", [{ name: "picked", select: "point", value: [1] }]],
  [
    "duplicate selection names",
    [
      { name: "picked", select: "point" },
      { name: "picked", select: "interval" },
    ],
  ],
  ["reserved selection name", [{ name: "__proto__", select: "point" }]],
  ["reserved internal selection name", [{ name: "bvm_rows", select: "point" }]],
  ["unsafe selection name", [{ name: "bad-name", select: "point" }]],
  [
    "arbitrary selection event stream",
    [{ name: "picked", select: { type: "point", on: "pointerover" } }],
  ],
  [
    "event callback object",
    [{ name: "picked", select: { type: "point", on: { source: "window", type: "click" } } }],
  ],
  ["custom clear event stream", [{ name: "picked", select: { type: "point", clear: "click" } }]],
  ["expression toggle", [{ name: "picked", select: { type: "point", toggle: "event.altKey" } }]],
  [
    "expression-based selection",
    [{ name: "picked", select: { type: "point", toggle: { expr: "true" } } }],
  ],
  [
    "unrecognized selection config",
    [{ name: "picked", select: { type: "interval", bind: "scales" } }],
  ],
  ["unrecognized selection type", [{ name: "picked", select: { type: "multi" } }]],
  ["nonnumeric selection name", [{ name: 42, select: "point" }]],
  [
    "unsupported interval projection",
    [{ name: "brushed", select: { type: "interval", encodings: ["color"] } }],
  ],
  ["empty selection fields", [{ name: "picked", select: { type: "point", fields: [] } }]],
  [
    "oversized field projection",
    [{ name: "picked", select: { type: "point", fields: ["a", "b", "c", "d", "e"] } }],
  ],
  [
    "duplicate field projection",
    [{ name: "picked", select: { type: "point", fields: ["a", "a"] } }],
  ],
  [
    "invalid field control character",
    [{ name: "picked", select: { type: "point", fields: ["value\n"] } }],
  ],
  ["unsafe resolve", [{ name: "picked", select: { type: "point", resolve: "javascript:bad" } }]],
  ["incorrect boolean nearest", [{ name: "picked", select: { type: "point", nearest: "true" } }]],
] as const) {
  test("reference chart refuses " + reason + " without mutating the stored grammar", () => {
    const content = { ...base(), spec: { ...base().spec, params } };
    const before = JSON.stringify(content);
    assert.throws(() => prepareInlineChart(content), unavailable);
    assert.equal(JSON.stringify(content), before);
  });
}
test("local selections in layers and nested branches cannot escape the top-level policy", () => {
  for (const spec of [
    { layer: [{ mark: "bar", params: [{ name: "nested", select: "point" }] }] },
    { hconcat: [{ mark: "bar", params: [{ name: "nested", select: "point" }] }] },
    { mark: "bar", encoding: { condition: { params: [{ name: "nested", select: "point" }] } } },
  ])
    assert.throws(() => prepareInlineChart({ spec, values: [] }), unavailable);
});
test("local selection does not allow data/image/url access through nearby spec properties", () => {
  for (const spec of [
    {
      ...base().spec,
      params: [{ name: "local", select: "point" }],
      data: { url: "https://example.invalid/tracker" },
    },
    {
      ...base().spec,
      params: [{ name: "local", select: "interval" }],
      encoding: {
        href: { field: "link", type: "nominal" },
      },
    },
    {
      ...base().spec,
      params: [{ name: "local", select: "point" }],
      layer: [
        {
          mark: "image",
          encoding: { url: { field: "logo", type: "nominal" } },
        },
      ],
    },
  ])
    assert.throws(() => prepareInlineChart({ spec, values: [] }), unavailable);
});
