import assert from "node:assert/strict";
import test from "node:test";
import { validateVisualContent, withAuthoredTimes } from "../../src/index.ts";

const lanes = [{ id: "ops", label: "Operations" }];
const event = (start: unknown, end?: unknown) => ({
  id: "cutover",
  label: "Cutover",
  lane: "ops",
  start,
  ...(end === undefined ? {} : { end }),
});

test("an authored time may be an ISO timestamp with its offset, stored as the instant it names", () => {
  const content = {
    lanes,
    events: [event("2026-10-01T09:00:00+02:00", "2026-10-01T08:30:00Z")],
  };
  const stored = withAuthoredTimes("timeline", content);
  assert.deepEqual(stored.events, [event(Date.UTC(2026, 9, 1, 7), Date.UTC(2026, 9, 1, 8, 30))]);
  validateVisualContent("timeline", "timeline", stored);
  // The request is not rewritten in place.
  assert.equal((content.events[0] as { start: unknown }).start, "2026-10-01T09:00:00+02:00");
  const plan = withAuthoredTimes("gantt", {
    workstreams: [{ id: "build", label: "Build" }],
    tasks: [
      {
        id: "ship",
        label: "Ship",
        workstream: "build",
        start: "2026-10-05T00:00:00+02:00",
        end: Date.UTC(2026, 9, 9),
        progress: 0,
        status: "planned",
      },
    ],
    dependencies: [],
  });
  assert.equal((plan.tasks as Array<{ start: unknown }>)[0]?.start, Date.UTC(2026, 9, 4, 22));
});

test("text without an offset is refused, naming the record, the field and the form it needs", () => {
  for (const start of ["2026-10-01T09:00:00", "2026-10-01", "yesterday", "2026-13-01T00:00:00Z"])
    assert.throws(
      () => withAuthoredTimes("timeline", { lanes, events: [event(start)] }),
      /^VisualModelError: events cutover: start must be epoch milliseconds or an ISO timestamp with a timezone/,
    );
});

test("content with nothing to convert is answered unchanged, and other text is not a time", () => {
  const content = { lanes, events: [event(Date.UTC(2026, 9, 1))] };
  assert.equal(withAuthoredTimes("timeline", content), content);
  const graph = { nodes: [{ id: "a", label: "2026-10-01T09:00:00+02:00", x: 0, y: 0 }], edges: [] };
  assert.equal(withAuthoredTimes("diagram", graph), graph);
  assert.equal(withAuthoredTimes("nonesuch", graph), graph);
});
