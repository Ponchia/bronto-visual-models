import { VisualModelError } from "../model.ts";
import { GANTT_SCHEMA, type GanttContent } from "../semantic.ts";
import { cycleComponents } from "./cycles.ts";
import { defineVisualFamily, nestedCascade, SEMANTIC_FIELDS, type VisualIssue } from "./family.ts";

const WEEK = 7 * 86_400_000;
const instant = (value: unknown) => Number.isFinite(new Date(value as number).getTime());

function ganttIssues(content: Record<string, unknown>): VisualIssue[] {
  const gantt = content as unknown as GanttContent;
  const issues: VisualIssue[] = [];
  const at = (path: string[], message: string) => issues.push({ path, message });
  const workstreams = new Set(gantt.workstreams.map((workstream) => workstream.id));
  const tasks = new Map(gantt.tasks.map((task) => [task.id, task]));
  const nesting = cycleComponents(
    [...tasks.keys()],
    gantt.tasks.flatMap((task) => (task.parentId ? [[task.parentId, task.id] as const] : [])),
  );
  for (const task of gantt.tasks) {
    const path = (field: string) => ["tasks", task.id, field];
    if (!workstreams.has(task.workstream))
      at(path("workstream"), "Every Gantt task needs an existing workstream");
    if (!instant(task.start)) at(path("start"), "Gantt task start must be valid");
    else if (task.milestone) {
      if (task.end !== undefined && task.end < task.start)
        at(path("end"), "Gantt milestone end cannot precede its start");
    } else if (task.end === undefined || !instant(task.end) || task.end <= task.start)
      at(path("end"), "Gantt tasks require an end after their start");
    if (task.parentId) {
      const parent = tasks.get(task.parentId);
      if (!parent) at(path("parentId"), "A Gantt task parent must exist");
      else if (nesting.has(task.id))
        at(path("parentId"), "Gantt task hierarchy must not contain a cycle");
      else if (parent.workstream !== task.workstream)
        at(path("parentId"), "A Gantt task parent must be in the same workstream");
    }
  }
  const order = cycleComponents(
    [...tasks.keys()],
    gantt.dependencies.map((dependency) => [dependency.source, dependency.target] as const),
  );
  for (const dependency of gantt.dependencies) {
    const path = (field: string) => ["dependencies", dependency.id, field];
    for (const end of ["source", "target"] as const)
      if (!tasks.has(dependency[end])) at(path(end), "A Gantt dependency refers to an absent task");
    const loop = order.get(dependency.source);
    if (loop !== undefined && loop === order.get(dependency.target))
      at(["dependencies", dependency.id], "Gantt dependencies must not contain a cycle");
  }
  return issues;
}

const time = (label: string) => ({ label, control: "time", format: "epoch-ms" }) as const;
const planned = ["label", "description", "entityId", "owner", "status"] as const;

export const ganttFamily = defineVisualFamily("gantt", {
  schema: GANTT_SCHEMA,
  validate: ganttIssues,
  additions: () => [
    { label: "Add task", collection: "tasks" },
    { label: "Add workstream", collection: "workstreams" },
    { label: "Add finish-to-start dependency", collection: "dependencies", relation: true },
  ],
  collections: {
    workstreams: {
      search: planned,
      fields: SEMANTIC_FIELDS,
      newItem: (_content, { id }) => ({ id, label: "New workstream" }),
      removalNote: "Move or remove the tasks in this workstream before removing it.",
    },
    tasks: {
      search: planned,
      fields: {
        ...SEMANTIC_FIELDS,
        workstream: { label: "Workstream", control: "ref", ref: "workstreams", order: 2 },
        start: { ...time("Start"), order: 3 },
        end: { ...time("End"), order: 4 },
        progress: { label: "Progress", control: "number", section: "Status" },
        status: { label: "Status", control: "choice", section: "Status" },
        owner: { label: "Owner", control: "text", section: "Status" },
        milestone: { label: "Milestone", section: "Structure" },
        parentId: { label: "Parent task", control: "ref", ref: "tasks", section: "Structure" },
      },
      // A new task follows the last one, for a week, in the first workstream.
      newItem: (content, { id }) => {
        const gantt = content as unknown as GanttContent;
        const workstream = gantt.workstreams[0];
        if (!workstream)
          throw new VisualModelError("invalid", "Add a workstream before creating tasks.");
        const last = gantt.tasks.at(-1);
        const start = last?.end ?? last?.start ?? Date.now();
        return {
          id,
          label: "New task",
          workstream: workstream.id,
          start,
          end: start + WEEK,
          progress: 0,
          status: "planned",
        };
      },
      cascade: nestedCascade("tasks", "dependencies"),
      removalNote: "Removing this task also removes its subtasks and their dependencies.",
    },
    dependencies: {
      search: planned,
      fields: {
        label: { label: "Dependency label", control: "text", order: 2 },
        source: { label: "Depends from", control: "ref", ref: "tasks", order: 0 },
        target: { label: "Then", control: "ref", ref: "tasks", order: 1 },
        description: SEMANTIC_FIELDS.description,
        entityId: SEMANTIC_FIELDS.entityId,
        type: { label: "Kind", readOnly: true },
      },
      newItem: (_content, { id, values }) => ({
        label: "Depends on",
        ...values,
        id,
        type: "finish-to-start",
      }),
    },
  },
});
