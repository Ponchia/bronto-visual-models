import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MemoryModelStore,
  assertVisualJson,
  chartSourceKey,
  timelineSourceKey,
} from "@ponchia/visual-models";
import { prepareHostChart } from "@ponchia/visual-models/render/inline-chart";
import { prepareHostTimeline } from "@ponchia/visual-models/render/host-timeline";

// A host chooses, authorizes and resolves its own data. This example accepts
// a trusted local JSON file; the library never interprets a URL or fetches a
// connection. In a real application, check authorization before the read.
const dataFile = process.argv[2] ?? new URL("./host-source.json", import.meta.url);
const input = await readFile(dataFile);
assert.ok(input.byteLength <= 128 * 1024, "Local input exceeds the example's 128 KiB limit");
const rows = JSON.parse(input.toString("utf8"));
assertVisualJson(rows);
assert.ok(Array.isArray(rows), "Local data must be an array of records");
assert.ok(rows.length >= 1 && rows.length <= 1_000, "Expected 1–1,000 local source records");
assert.ok(
  rows.every((row) => typeof row.requests === "number" && Number.isFinite(row.requests)),
  "The requests column must contain finite numbers",
);

// Keep the example's no-fetch claim executable: the test fails if any model
// helper unexpectedly tries to request a resource. No private data is sent.
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls++;
  throw new Error("Unexpected library network access");
};

const store = new MemoryModelStore();
await store.execute({
  type: "create",
  key: "create-host-chart",
  model: {
    id: "service-activity",
    renderer: "vega-lite",
    title: "Service activity",
    // A binding describes the source, not its rows or access credentials.
    content: {
      datasource: "dataset",
      params: { dataset: "local-activity", revision: 1 },
      spec: {
        mark: "bar",
        encoding: {
          x: { field: "service", type: "nominal" },
          y: { field: "requests", type: "quantitative" },
        },
      },
    },
  },
});
await store.execute({
  type: "create",
  key: "create-host-timeline",
  model: {
    id: "activity-timeline",
    renderer: "timeline",
    title: "Activity over time",
    content: {
      datasource: "dataset",
      params: { dataset: "local-activity", revision: 1 },
      fields: {
        label: "label",
        start: "started",
        end: "ended",
        lane: "team",
        entity: "entity",
      },
      lanes: [],
      events: [],
    },
  },
});
const chart = store.get("service-activity");
const timeline = store.get("activity-timeline");
assert.ok(chart && timeline);
const snapshotRevision = "source-snapshot-1";
const chartBinding = chartSourceKey(chart);
const timelineBinding = timelineSourceKey(timeline);
assert.ok(chartBinding && timelineBinding, "Both models must have bound data sources");
const chartSnapshot = {
  sourceKey: chartBinding,
  revision: snapshotRevision,
  rows,
};
const timelineSnapshot = {
  sourceKey: timelineBinding,
  revision: snapshotRevision,
  rows,
};
const preparedChart = prepareHostChart(chart, chartSnapshot);
const preparedTimeline = prepareHostTimeline(timeline, timelineSnapshot);

// The records remain in host memory. The model store holds no private
// dataset rows, no projected timeline events and no invented incarnations.
assert.equal(chart.content.values, undefined);
assert.deepEqual(timeline.content.events, []);
assert.deepEqual(timeline.content.lanes, []);
assert.equal(preparedChart.input.values.length, rows.length);
assert.equal(preparedTimeline.content.events.length, rows.length);
assert.equal(chart.revision, 1);
assert.equal(timeline.revision, 1);

const sourceEvent = preparedTimeline.content.events[0];
const sourceSelection = preparedTimeline.targets.get(sourceEvent.id);
assert.equal(sourceSelection.rowId, rows[0].rowId);
assert.equal(sourceSelection.entityId, rows[0].entity);
assert.equal(sourceSelection.sourceKey, timelineBinding);

// A data refresh does not edit either visual model. The renderer can
// acknowledge this new snapshot after drawing it; a headless consumer merely
// prepares the revision and digest without falsely claiming to have drawn it.
const updated = rows.map((row, index) =>
  index === 0 ? { ...row, requests: row.requests + 1, label: row.label + " · updated" } : row,
);
const nextChart = prepareHostChart(chart, {
  ...chartSnapshot,
  revision: "source-snapshot-2",
  rows: updated,
});
const nextTimeline = prepareHostTimeline(timeline, {
  ...timelineSnapshot,
  revision: "source-snapshot-2",
  rows: updated,
});
assert.notEqual(nextChart.source.digest, preparedChart.source.digest);
assert.notEqual(nextTimeline.source.digest, preparedTimeline.source.digest);
assert.equal(nextTimeline.content.events[0].id, sourceEvent.id);
assert.equal(nextTimeline.targets.get(sourceEvent.id).revision, "source-snapshot-2");
assert.equal(store.get(chart.id).revision, 1);
assert.equal(store.get(timeline.id).revision, 1);

await assert.rejects(
  async () => prepareHostChart(chart, { ...chartSnapshot, sourceKey: "f".repeat(64) }),
  { code: "unavailable" },
);
await assert.rejects(
  async () => prepareHostTimeline(timeline, { ...timelineSnapshot, sourceKey: "f".repeat(64) }),
  { code: "unavailable" },
);
assert.equal(store.get(chart.id).content.values, undefined);
assert.deepEqual(store.get(timeline.id).content.events, []);
assert.equal(networkCalls, 0, "Visual model helpers must never fetch host data");
globalThis.fetch = originalFetch;

console.log(
  JSON.stringify(
    {
      sourceReadBy: "host",
      rowsPersistedInModels: false,
      chartRows: preparedChart.input.values.length,
      timelineEvents: preparedTimeline.content.events.length,
      timelineLanes: preparedTimeline.content.lanes.length,
      sourceRowSelection: sourceSelection.rowId,
      dataRefreshDoesNotEditModels: true,
      refreshChangedDataDigests: true,
      staleSourceRefused: true,
      networkRequestedByLibrary: networkCalls > 0,
    },
    null,
    2,
  ),
);
