import { useMemo, useRef, useState } from "react";
import type { TimelineContent } from "../semantic.ts";
import { modelTargets } from "../targets.ts";
import { useVisTimeline, titleMarkup, type TimeWindow } from "../engines/vis-timeline.ts";
import type { AdapterProps } from "./types.ts";
export default function TimelineView(props: AdapterProps) {
  const target = useRef<HTMLDivElement>(null);
  const [window, setWindow] = useState<TimeWindow | undefined>(undefined);
  const content = props.model.content as unknown as TimelineContent;
  const targets = useMemo(
    () => modelTargets(props.model, props.registry),
    [props.model, props.registry],
  );
  const start = Math.min(...content.events.map((event) => event.start));
  const end = Math.max(...content.events.map((event) => event.end ?? event.start));
  const padding = Math.max(3600000, (end - start) * 0.12);
  const bounds = Number.isFinite(start)
    ? { start: start - padding, end: end + padding }
    : { start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 0, 2) };
  const timeline = useVisTimeline(target, {
    active: props.active !== false,
    editable: !!props.onEdit,
    moveBetweenGroups: false,
    look: {
      height: "100%",
      stack: true,
      showCurrentTime: false,
      margin: { item: 12 },
      template(item) {
        const element = document.createElement("span");
        element.textContent = String(item.content);
        return element;
      },
      groupTemplate(item) {
        const element = document.createElement("span");
        element.textContent = String(item.content);
        return element;
      },
    },
    items: content.events.map((event) => ({
      id: event.id,
      content: event.label,
      title: titleMarkup(event.label),
      start: event.start,
      ...(event.end === undefined ? {} : { end: event.end }),
      group: event.lane,
    })),
    groups: content.lanes.map((lane) => ({ id: lane.id, content: lane.label })),
    dataKey: `${props.model.generation}:${props.model.revision}`,
    bounds,
    window,
    onWindow: setWindow,
    selection: props.selected?.collection === "events" ? [props.selected.elementId] : [],
    onSelect: (ids) =>
      props.onSelect?.(
        targets.find((entry) => entry.collection === "events" && entry.elementId === ids[0]) ??
          null,
      ),
    onMove: async (moved) => {
      const before = content.events.find((event) => event.id === String(moved.id));
      if (!before || !props.onEdit) throw new Error("The event cannot be edited");
      try {
        await props.onEdit({
          generation: props.model.generation,
          items: [
            {
              field: "events",
              set: [
                {
                  id: before.id,
                  start: new Date(moved.start).getTime(),
                  ...(moved.end === undefined ? {} : { end: new Date(moved.end).getTime() }),
                  expect: { start: before.start, end: before.end ?? null },
                },
              ],
            },
          ],
        });
      } catch (error) {
        props.report(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    onReady: props.ready,
  });
  if (props.model.content.datasource)
    return (
      <div className="bvm-notice" role="status">
        Resolve this timeline's dataset in the host. This view does not fetch external data.
      </div>
    );
  return (
    <div className="bvm-timeline">
      <div className="bvm-time-toolbar">
        <button type="button" onClick={() => timeline.navigate("fit")}>
          Fit timeline
        </button>
      </div>
      <div className="bvm-engine" ref={target} />
    </div>
  );
}
