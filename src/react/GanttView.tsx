import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { GanttContent, GanttTask } from "../semantic.ts";
import { modelTargets } from "../targets.ts";
import { ganttDate, ganttLayout } from "../render/gantt-layout.ts";
import type { AdapterProps } from "./types.ts";

function ProgressEditor({ task, props }: { task: GanttTask; props: AdapterProps }) {
  const id = useId();
  const [value, setValue] = useState(String(task.progress ?? 0));
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = async () => {
    if (inFlight.current || !props.onEdit || props.active === false) return;
    const progress = Number(value);
    if (!value.trim() || !Number.isFinite(progress) || progress < 0 || progress > 100) {
      props.report("Progress must be a number from 0 to 100.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      await props.onEdit({
        generation: props.model.generation,
        ifRevision: props.model.revision,
        items: [
          {
            field: "tasks",
            set: [{ id: task.id, progress, expect: { progress: task.progress ?? null } }],
          },
        ],
      });
    } catch (error) {
      if (mounted.current) props.report(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <form
      className="bvm-progress-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={id}>Progress for {task.label} (%)</label>
      <input
        id={id}
        type="number"
        min="0"
        max="100"
        step="any"
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={busy || props.active === false}
      />
      <button type="submit" disabled={busy || props.active === false}>
        {busy ? "Saving progress…" : "Save progress"}
      </button>
    </form>
  );
}

/** Native, lazy-loaded schedule: no timeline engine, automatic scheduling or network I/O. */
export default function GanttView(props: AdapterProps) {
  const content = props.model.content as unknown as GanttContent;
  const layout = useMemo(() => ganttLayout(content), [content]);
  const targets = useMemo(
    () => modelTargets(props.model, props.registry),
    [props.model, props.registry],
  );
  const selectedTask =
    props.selected?.collection === "tasks"
      ? content.tasks.find((task) => task.id === props.selected?.elementId)
      : undefined;
  const taskNames = useMemo(
    () => new Map(content.tasks.map((task) => [task.id, task.label])),
    [content.tasks],
  );
  const rowsByStream = useMemo(() => {
    const groups = new Map<string, typeof layout.rows>();
    for (const row of layout.rows) {
      const rows = groups.get(row.task.workstream) ?? [];
      rows.push(row);
      groups.set(row.task.workstream, rows);
    }
    return groups;
  }, [layout]);
  const select = (collection: string, id: string) =>
    props.onSelect?.(
      targets.find((target) => target.collection === collection && target.elementId === id) ?? null,
    );
  useEffect(() => {
    if (props.active === false) return;
    const frame = requestAnimationFrame(props.ready);
    return () => cancelAnimationFrame(frame);
  }, [props.active, props.ready]);
  return (
    <div
      className="bvm-gantt"
      tabIndex={0}
      role="region"
      aria-label={`${props.model.title} schedule`}
    >
      <p className="bvm-gantt-range">
        {layout.start === null ? (
          "No scheduled tasks."
        ) : (
          <>
            <time dateTime={ganttDate(layout.start)}>{ganttDate(layout.start).split("T")[0]}</time>
            {" to "}
            <time dateTime={ganttDate(layout.end!)}>{ganttDate(layout.end!).split("T")[0]}</time>
            {" · UTC · select a task to inspect its progress"}
          </>
        )}
      </p>
      {content.workstreams.map((stream) => (
        <section key={stream.id} aria-label={stream.label} className="bvm-gantt-stream">
          <h4>{stream.label}</h4>
          <ul className="bvm-gantt-tasks">
            {(rowsByStream.get(stream.id) ?? []).map(({ task, left, width, depth }) => (
              <li key={task.id} className="bvm-gantt-row" data-model-element={task.id}>
                <button
                  type="button"
                  className="bvm-task-label"
                  aria-pressed={
                    props.selected?.collection === "tasks" && props.selected.elementId === task.id
                  }
                  onClick={() => select("tasks", task.id)}
                  disabled={!props.onSelect}
                  style={{ paddingInlineStart: 10 + Math.min(depth, 8) * 10 }}
                >
                  {task.label}
                  {task.milestone ? " · Milestone" : ""}
                  <span className="bvm-task-meta">
                    {task.owner ? `${task.owner} · ` : ""}
                    {task.status ?? "No status"}
                    {" · "}
                    {task.progress ?? 0}%
                  </span>
                </button>
                <div className="bvm-gantt-track" aria-hidden="true">
                  <span
                    className={task.milestone ? "bvm-gantt-milestone" : "bvm-gantt-bar"}
                    style={{
                      left: `${left}%`,
                      width: task.milestone ? undefined : `${width}%`,
                      background: props.tokens.accent,
                    }}
                  >
                    {!task.milestone && (
                      <span
                        className="bvm-gantt-progress"
                        style={{ width: `${task.progress ?? 0}%` }}
                      />
                    )}
                  </span>
                </div>
                <span className="bvm-task-dates">
                  <time dateTime={ganttDate(task.start)}>{ganttDate(task.start)}</time>
                  {!task.milestone && task.end !== undefined && (
                    <>
                      {" "}
                      — <time dateTime={ganttDate(task.end)}>{ganttDate(task.end)}</time>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {!rowsByStream.get(stream.id)?.length && <p>No tasks in this workstream.</p>}
        </section>
      ))}
      {selectedTask && props.onEdit && props.model.role === "model" && (
        <ProgressEditor
          key={`${props.model.generation}:${props.model.revision}:${selectedTask.id}`}
          task={selectedTask}
          props={props}
        />
      )}
      {content.dependencies.length > 0 && (
        <section aria-label="Finish-to-start dependencies">
          <h4>Finish-to-start dependencies</h4>
          <ul className="bvm-dependencies">
            {content.dependencies.map((dependency) => (
              <li key={dependency.id}>
                <button
                  type="button"
                  onClick={() => select("dependencies", dependency.id)}
                  disabled={!props.onSelect}
                  aria-pressed={
                    props.selected?.collection === "dependencies" &&
                    props.selected.elementId === dependency.id
                  }
                >
                  {taskNames.get(dependency.source)} → {taskNames.get(dependency.target)}:{" "}
                  {dependency.label}
                </button>
              </li>
            ))}
          </ul>
          <p>
            Dependencies are authored relationships; this view does not reschedule tasks
            automatically.
          </p>
        </section>
      )}
    </div>
  );
}
