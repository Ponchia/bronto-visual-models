import assert from "node:assert/strict";
import test from "node:test";
import { ganttLayout, ganttDate, ganttDateLabel } from "../src/render/gantt-layout.ts";
import { createModel, VISUAL_TEMPLATES } from "../src/index.ts";
import type { GanttContent } from "../src/semantic.ts";

test("Gantt layout retains authored order, UTC time and identified milestone positions", () => {
  const content = createModel({ id: "schedule", title: "Plan", template: "gantt" })
    .content as unknown as GanttContent;
  const before = structuredClone(content);
  const layout = ganttLayout(content);
  assert.deepEqual(content, before);
  assert.deepEqual(
    layout.rows.map((row) => row.task.id),
    content.tasks.map((task) => task.id),
  );
  assert.equal(layout.rows[0].left, 0);
  assert.equal(layout.rows.at(-1)!.width, 0);
  assert.equal(layout.rows.at(-1)!.left, 100);
  assert.match(ganttDate(layout.start!), /Z$/);
  assert.ok(VISUAL_TEMPLATES.some((template) => template.id === "gantt"));
});
test("empty and milestone-only plans do not fabricate a duration", () => {
  assert.deepEqual(ganttLayout({ tasks: [], dependencies: [], workstreams: [] }), {
    start: null,
    end: null,
    rows: [],
  });
  const layout = ganttLayout({
    workstreams: [{ id: "one", label: "One" }],
    dependencies: [],
    tasks: [{ id: "m", label: "Milestone", milestone: true, start: 0, workstream: "one" }],
  });
  assert.equal(layout.rows[0].left, 50);
  assert.equal(layout.rows[0].width, 0);
});
test("hierarchy depths are independent of task order and stay bounded for malformed cycles", () => {
  const base = { workstream: "one", start: 0, end: 100 };
  const tasks = [
    { ...base, id: "child", label: "Child", parentId: "root" },
    { ...base, id: "root", label: "Root" },
    { ...base, id: "grandchild", label: "Grandchild", parentId: "child" },
  ];
  assert.deepEqual(
    ganttLayout({ tasks, workstreams: [], dependencies: [] }).rows.map((r) => r.depth),
    [1, 0, 2],
  );
  tasks[1].parentId = "child";
  assert.ok(
    ganttLayout({ tasks, workstreams: [], dependencies: [] }).rows.every((r) =>
      Number.isFinite(r.depth),
    ),
  );
});

test("readable date labels retain non-midnight instants and subsecond precision", () => {
  assert.equal(ganttDateLabel(0), "1970-01-01");
  assert.equal(ganttDateLabel(1000), "1970-01-01 00:00:01Z");
  assert.equal(ganttDateLabel(1001), "1970-01-01 00:00:01.001Z");
});
