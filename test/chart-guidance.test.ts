import assert from "node:assert/strict";
import test from "node:test";
import { chartEncodingGuidance, chartMarkChoices } from "../src/chart-guidance.ts";
const example = (spec: Record<string, unknown>) => ({
  spec,
  values: [{ category: "one", value: 10, date: "2026-01-01" }],
});
const codes = (spec: Record<string, unknown>) =>
  chartEncodingGuidance(example(spec)).notes.map((n) => n.code);

test("unordered connected categories receive guidance, not rewritten input", () => {
  const c = example({
    mark: "line",
    encoding: {
      x: { field: "category", type: "nominal" },
      y: { field: "value", type: "quantitative" },
    },
  });
  const before = JSON.stringify(c);
  assert(codes(c.spec).includes("nominal-path"));
  assert.equal(JSON.stringify(c), before);
  assert.deepEqual(chartMarkChoices("nominal"), ["bar", "point"]);
});
test("temporal, intentional ordinal and explicit order paths are accepted without nominal warning", () => {
  for (const type of ["temporal", "ordinal", "quantitative"])
    assert(
      !codes({
        mark: "line",
        encoding: { x: { field: "value", type }, y: { field: "value", type: "quantitative" } },
      }).includes("nominal-path"),
    );
  assert(
    !codes({
      mark: "line",
      encoding: {
        x: { field: "category", type: "nominal" },
        y: { field: "value", type: "quantitative" },
        order: { field: "value" },
      },
    }).includes("nominal-path"),
  );
});
test("nonzero magnitude baselines and logarithmic lengths are disclosed, not fixed", () => {
  for (const scale of [{ zero: false }, { domain: [90, 100] }])
    assert(
      codes({
        mark: "bar",
        encoding: {
          x: { field: "category", type: "nominal" },
          y: { field: "value", type: "quantitative", scale },
        },
      }).includes("truncated-baseline"),
    );
  assert(
    codes({
      mark: "bar",
      encoding: { y: { field: "value", type: "quantitative", scale: { type: "log" } } },
    }).includes("log-magnitude"),
  );
  assert(
    !codes({
      mark: "line",
      encoding: { y: { field: "value", type: "quantitative", scale: { zero: false } } },
    }).includes("truncated-baseline"),
  );
  assert(
    !codes({
      mark: "bar",
      encoding: {
        y: { field: "value", type: "quantitative", scale: { zero: false } },
        y2: { value: 95 },
      },
    }).includes("truncated-baseline"),
  );
});
test("layered inherited encodings and facet child specs are inspected", () => {
  assert(
    codes({
      encoding: {
        x: { field: "category", type: "nominal" },
        y: { field: "value", type: "quantitative" },
      },
      layer: [{ mark: "line" }],
    }).includes("nominal-path"),
  );
  assert(
    codes({
      facet: { row: { field: "category" } },
      spec: {
        mark: "area",
        encoding: {
          x: { field: "category", type: "nominal" },
          y: { field: "value", type: "quantitative" },
        },
      },
    }).includes("nominal-path"),
  );
  assert(
    codes({
      resolve: { scale: { y: "independent" } },
      layer: [{ mark: "line" }, { mark: "bar" }],
    }).includes("independent-scales"),
  );
});
test("missing raw fields warn but transforms and count aggregates are not false positives", () => {
  assert(
    codes({ mark: "bar", encoding: { y: { field: "absent", type: "quantitative" } } }).includes(
      "missing-field",
    ),
  );
  assert(
    !codes({
      transform: [{ calculate: "datum.value * 2", as: "derived" }],
      mark: "bar",
      encoding: { y: { field: "derived", type: "quantitative" } },
    }).includes("missing-field"),
  );
  assert(
    !codes({ mark: "bar", encoding: { y: { aggregate: "count", type: "quantitative" } } }).includes(
      "missing-field",
    ),
  );
});
test("empty rows are not interpreted as zero and warnings are bounded", () => {
  assert.equal(
    chartEncodingGuidance({ spec: { mark: "bar" }, values: [] }).notes[0]?.code,
    "empty-data",
  );
  const result = chartEncodingGuidance(
    example({
      concat: Array.from({ length: 40 }, () => ({
        mark: "line",
        encoding: {
          x: { field: "category", type: "nominal" },
          y: { field: "value", type: "quantitative" },
        },
      })),
    }),
  );
  assert.equal(result.notes.length, 24);
  assert.equal(result.truncated, true);
});

test("numeric horizontal domain is not mistaken for the bar's magnitude baseline", () => {
  assert(
    !codes({
      mark: "bar",
      encoding: {
        x: { field: "value", type: "quantitative", scale: { domain: [1990, 2020], zero: false } },
        y: { field: "value", type: "quantitative" },
      },
    }).includes("truncated-baseline"),
  );
  assert(
    !codes({
      mark: "line",
      encoding: {
        x: { field: "category", type: "nominal", sort: ["one", "two"] },
        y: { field: "value", type: "quantitative" },
      },
    }).includes("nominal-path"),
  );
});
