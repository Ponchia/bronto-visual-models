import type { GanttContent, GanttTask } from "../semantic.ts";

/** Authored order is retained; percentages describe time, never an inferred schedule. */
export interface GanttRow {
  task: GanttTask;
  left: number;
  width: number;
  depth: number;
}
export function ganttLayout(content: GanttContent): {
  start: number | null;
  end: number | null;
  rows: GanttRow[];
} {
  if (!content.tasks.length) return { start: null, end: null, rows: [] };
  let start = Infinity;
  let end = -Infinity;
  const byId = new Map(content.tasks.map((task) => [task.id, task]));
  for (const task of content.tasks) {
    start = Math.min(start, task.start);
    end = Math.max(end, task.milestone ? task.start : (task.end ?? task.start));
  }
  // A plan containing just one milestone has a meaningful position, not NaN.
  const span = end - start;
  const depths = new Map<string, number>();
  const depth = (task: GanttTask): number => {
    const path: GanttTask[] = [];
    const visited = new Set<string>();
    let current: GanttTask | undefined = task;
    while (current && !depths.has(current.id) && !visited.has(current.id)) {
      visited.add(current.id);
      path.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    let level = current ? (depths.get(current.id) ?? 0) + 1 : 0;
    while (path.length) depths.set(path.pop()!.id, level++);
    return depths.get(task.id) ?? 0;
  };
  return {
    start,
    end,
    rows: content.tasks.map((task) => ({
      task,
      left: span ? ((task.start - start) / span) * 100 : 50,
      width: task.milestone || !span ? 0 : (((task.end ?? task.start) - task.start) / span) * 100,
      depth: depth(task),
    })),
  };
}

/** Explicit UTC dates keep server-rendered and browser text independent of local timezone. */
export const ganttDate = (instant: number): string => new Date(instant).toISOString();
