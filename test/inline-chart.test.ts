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
