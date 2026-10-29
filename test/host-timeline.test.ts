import assert from "node:assert/strict";
import test from "node:test";
import {
  chartSourceKey,
  createModel,
  editModel,
  sourceSnapshotKey,
  timelineSourceKey,
  type VisualModel,
  VisualModelError,
} from "../src/index.ts";
import { prepareHostTimeline } from "../src/render/host-timeline.ts";

const mapping = {
  label: "label",
  start: "started",
  end: "ended",
  lane: "stream",
  entity: "entity",
};
const create = () =>
  createModel({
    id: "activity",
    title: "Activity",
    renderer: "timeline",
    content: {
      datasource: "dataset",
      params: { dataset: "events-2026", revision: 1 },
      fields: mapping,
      lanes: [],
      events: [],
    },
  });
const rows = () => [
  {
    rowId: "a",
    label: "Order submitted",
    started: "2026-10-29T11:00:00+01:00",
    ended: "2026-10-29T11:30:00+01:00",
    stream: "Orders",
    entity: "order-123",
  },
  {
    rowId: "b",
    label: "Job completed",
    started: "2026-10-29T12:00:00+01:00",
    stream: "Background",
    entity: "job-456",
  },
];
const resolved = (model: VisualModel) => ({
  sourceKey: timelineSourceKey(model)!,
  revision: "rev-001",
  rows: rows(),
});
const unavailable = (err: unknown) => err instanceof VisualModelError && err.code === "unavailable";

test("host timeline projects identified rows without editing the saved model", () => {
  const model = create();
  const input = resolved(model);
  const before = JSON.stringify(model);
  const projected = prepareHostTimeline(model, input);
  assert.equal(projected.content.events.length, 2);
  assert.equal(projected.content.lanes.length, 2);
  assert.equal(projected.content.events[0]!.start, Date.parse(rows()[0]!.started));
  assert.equal(projected.content.events[0]!.end, Date.parse(rows()[0]!.ended!));
  assert.equal(projected.content.events[0]!.entityId, "order-123");
  assert.equal(projected.content.events[0]!.id.length, 68); // "row-" + SHA-256
  const item = projected.targets.get(projected.content.events[0]!.id)!;
  assert.equal(item.modelId, model.id);
  assert.equal(item.generation, model.generation);
  assert.equal(item.sourceKey, input.sourceKey);
  assert.equal(item.revision, input.revision);
  assert.equal(item.rowId, "a");
  assert.equal(item.entityId, "order-123");
  assert.equal(JSON.stringify(model), before);
  assert.equal(model.content.events.length, 0);
  assert.equal(model.content.lanes.length, 0);
  assert.equal(chartSourceKey(model), undefined);
  assert.equal(sourceSnapshotKey(model), input.sourceKey);
});

test("source refresh changes the digest but retains stable event identity", () => {
  const model = create();
  const first = prepareHostTimeline(model, resolved(model));
  const updated = rows();
  updated[0]!.label = "Order amended";
  const later = prepareHostTimeline(model, {
    ...resolved(model),
    revision: "rev-002",
    rows: updated,
  });
  assert.equal(first.content.events[0]!.id, later.content.events[0]!.id);
  assert.equal(first.source.sourceKey, later.source.sourceKey);
  assert.notEqual(first.source.digest, later.source.digest);
  assert.equal(later.targets.get(later.content.events[0]!.id)!.revision, "rev-002");
  assert.equal(first.targets.get(first.content.events[0]!.id)!.revision, "rev-001");
  assert.equal(model.revision, 1);
});

test("metadata edits keep bound identity, authored source changes invalidate it", () => {
  const model = create();
  const original = resolved(model);
  const renamed = editModel(model, { title: "Activity renamed" }).model;
  assert.equal(timelineSourceKey(renamed), original.sourceKey);
  assert.equal(prepareHostTimeline(renamed, original).content.events.length, 2);
  const changed = editModel(model, {
    ifRevision: model.revision,
    content: { params: { dataset: "events-other", revision: 2 } },
  }).model;
  assert.notEqual(timelineSourceKey(changed), original.sourceKey);
  assert.throws(() => prepareHostTimeline(changed, original), unavailable);
});

test("no implicit source access or source takeover of inline timelines", () => {
  const inline = createModel({
    id: "inline",
    title: "Inline",
    renderer: "timeline",
    content: { lanes: [{ id: "lane", label: "Lane" }], events: [] },
  });
  assert.equal(timelineSourceKey(inline), undefined);
  assert.throws(() => prepareHostTimeline(inline, resolved(create())), unavailable);
  const chart = createModel({
    id: "chart",
    title: "Chart",
    renderer: "vega-lite",
    content: {
      datasource: "dataset",
      params: { dataset: "events-2026" },
      spec: { mark: "point" },
    },
  });
  assert.equal(timelineSourceKey(chart), undefined);
  assert.throws(() => prepareHostTimeline(chart, resolved(create())), unavailable);
});

test("duplicate or missing source identities, malformed timestamps and invalid rows refuse", () => {
  const model = create(),
    good = resolved(model);
  assert.throws(
    () =>
      prepareHostTimeline(model, { ...good, rows: [rows()[0]!, { ...rows()[1]!, rowId: "a" }] }),
    unavailable,
  );
  assert.throws(
    () => prepareHostTimeline(model, { ...good, rows: [{ ...rows()[0]!, rowId: "" }] }),
    unavailable,
  );
  assert.throws(
    () =>
      prepareHostTimeline(model, {
        ...good,
        rows: [{ ...rows()[0]!, started: "2026-10-29 12:00:00" }],
      }),
    unavailable,
  );
  assert.throws(
    () =>
      prepareHostTimeline(model, {
        ...good,
        rows: [{ ...rows()[0]!, ended: "2026-10-29T10:00:00Z" }],
      }),
    unavailable,
  );
  assert.throws(
    () =>
      prepareHostTimeline(model, { ...good, rows: [{ ...rows()[0]!, stream: "x".repeat(1000) }] }),
    unavailable,
  );
});

test("stale bindings, non-revision strings and malformed source records are refused", () => {
  const model = create(),
    good = resolved(model);
  assert.throws(
    () =>
      prepareHostTimeline(model, {
        ...good,
        sourceKey: "f".repeat(64),
      }),
    unavailable,
  );
  assert.throws(
    () =>
      prepareHostTimeline(model, {
        ...good,
        revision: "https://example.invalid",
      }),
    unavailable,
  );
  assert.throws(
    () =>
      prepareHostTimeline(model, {
        ...good,
        revision: "",
      }),
    unavailable,
  );
  assert.throws(
    () =>
      prepareHostTimeline(model, {
        ...good,
        revision: "x".repeat(129),
      }),
    unavailable,
  );
  const replacement = { ...model, generation: "a-different-model-generation" };
  assert.notEqual(timelineSourceKey(replacement), good.sourceKey);
  assert.throws(() => prepareHostTimeline(replacement, good), VisualModelError);
});

test("private row contents and getters cannot leak through refused source data", () => {
  const model = create(),
    good = resolved(model);
  const secret = "CONFIDENTIAL-DATA-SHOULD-NEVER-APPEAR";
  let invoked = false;
  const row = { ...rows()[0]! };
  Object.defineProperty(row, "stream", {
    enumerable: true,
    get() {
      invoked = true;
      return secret;
    },
  });
  assert.throws(() => prepareHostTimeline(model, { ...good, rows: [row] }), unavailable);
  assert.equal(invoked, false);
  assert.throws(
    () => prepareHostTimeline(model, { ...good, rows: [{ ...rows()[0]!, started: secret }] }),
    (error: unknown) => unavailable(error) && !String(error).includes(secret),
  );
  assert.throws(
    () =>
      prepareHostTimeline(model, {
        ...good,
        rows: Array.from({ length: 1001 }, (_, i) => ({
          ...rows()[0]!,
          rowId: "row-" + i,
        })),
      }),
    unavailable,
  );
});

test("authoritative dataset field mappings project source facts only", () => {
  const model = create();
  const mappingChanged = editModel(model, {
    ifRevision: model.revision,
    content: { fields: { label: "label", start: "started", lane: "stream" } },
  }).model;
  const newKey = timelineSourceKey(mappingChanged)!;
  assert.notEqual(newKey, timelineSourceKey(model));
  const projected = prepareHostTimeline(mappingChanged, {
    sourceKey: newKey,
    revision: "new-fields",
    rows: rows(),
  });
  assert.equal(projected.content.events[0]!.end, undefined);
  assert.equal(projected.content.events[0]!.entityId, undefined);
  assert.equal(projected.content.lanes.length, 2);
});

test("generalized source fingerprint retains the existing chart API", () => {
  const chart = createModel({
    id: "sales",
    title: "Sales",
    renderer: "vega-lite",
    content: {
      datasource: "dataset",
      params: { dataset: "revenue", revision: 3 },
      spec: { mark: "bar" },
    },
  });
  assert.equal(sourceSnapshotKey(chart), chartSourceKey(chart));
  assert.match(chartSourceKey(chart)!, /^[a-f0-9]{64}$/);
  const inline = createModel({
    id: "inline-chart",
    title: "Inline chart",
    renderer: "vega-lite",
    content: { spec: { mark: "point" }, values: [] },
  });
  assert.equal(sourceSnapshotKey(inline), undefined);
  assert.equal(chartSourceKey(inline), undefined);
});

test("source fingerprint validation rejects accessor-bearing model content without evaluating it", () => {
  const source = create();
  let executed = false;
  const malicious = {
    ...source,
    content: {
      ...source.content,
      get fields() {
        executed = true;
        return mapping;
      },
    },
  };
  assert.throws(
    () => sourceSnapshotKey(malicious),
    (error: unknown) => error instanceof VisualModelError && error.code === "invalid",
  );
  assert.equal(executed, false);
});
