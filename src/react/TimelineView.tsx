import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TimelineContent } from "../semantic.ts";
import { modelTargets } from "../targets.ts";
import { useVisTimeline, type TimeWindow } from "../engines/vis-timeline.ts";
import { prepareHostTimeline, type PreparedHostTimeline } from "../render/host-timeline.ts";
import type { SourceRowTarget } from "../source-snapshot.ts";
import type { AdapterProps } from "./types.ts";

type Accepted = {
  readonly content: TimelineContent;
  readonly source?: PreparedHostTimeline["source"];
  readonly targets?: PreparedHostTimeline["targets"];
};

function TimelineSurface(props: AdapterProps & { view: Accepted }) {
  const target = useRef<HTMLDivElement>(null);
  const [window, setWindow] = useState<TimeWindow | undefined>(undefined);
  const [localSourceSelection, setLocalSourceSelection] = useState<SourceRowTarget | null>(null);
  const { model, view } = props;
  const { content, source } = view;
  const targets = useMemo(
    () => (source ? [] : modelTargets(model, props.registry)),
    [model, props.registry, source],
  );
  const sourceId = source ? `${source.sourceKey}:${source.revision}:${source.digest}` : undefined;
  const sourceEventIds = useMemo(
    () =>
      new Map(
        [...(view.targets?.entries() ?? [])].map(
          ([eventId, selected]) => [selected.rowId, eventId] as const,
        ),
      ),
    [view.targets],
  );
  const selectedSource =
    props.sourceSelected === undefined ? localSourceSelection : props.sourceSelected;
  const selectedSourceId =
    source &&
    selectedSource &&
    selectedSource.modelId === model.id &&
    selectedSource.generation === model.generation &&
    selectedSource.sourceKey === source.sourceKey &&
    selectedSource.revision === source.revision
      ? sourceEventIds.get(selectedSource.rowId)
      : undefined;
  const start = Math.min(...content.events.map((event) => event.start));
  const end = Math.max(...content.events.map((event) => event.end ?? event.start));
  const padding = Math.max(3600000, (end - start) * 0.12);
  const bounds = Number.isFinite(start)
    ? { start: start - padding, end: end + padding }
    : { start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 0, 2) };
  const dataKey = source
    ? `${model.generation}:${model.revision}:${sourceId}`
    : `${model.generation}:${model.revision}`;
  // A changing host onReady handler is not a reason to redraw the timeline.
  // Keep the handler live, but capture the exact source snapshot in the
  // acknowledgement for the frame associated with this dataKey.
  const liveReady = useRef(props.ready);
  // A concurrent render may be abandoned while an older frame is still
  // painting. Update the callback only after the new React commit so the
  // old frame cannot acknowledge itself using an uncommitted model revision.
  useLayoutEffect(() => {
    liveReady.current = props.ready;
  }, [props.ready]);
  const acknowledge = useMemo(() => () => liveReady.current(source), [dataKey, source]);
  const onSelect = useCallback(
    (ids: string[]) => {
      if (source) {
        const chosen = view.targets?.get(ids[0] ?? "") ?? null;
        if (props.sourceSelected === undefined) setLocalSourceSelection(chosen);
        props.onSourceSelect?.(chosen);
      } else {
        props.onSelect?.(
          targets.find((entry) => entry.collection === "events" && entry.elementId === ids[0]) ??
            null,
        );
      }
    },
    [props.onSourceSelect, props.onSelect, props.sourceSelected, source, view.targets, targets],
  );
  const timeline = useVisTimeline(target, {
    active: props.active !== false,
    editable: !source && !!props.onEdit,
    moveBetweenGroups: false,
    look: {
      height: "100%",
      stack: true,
      showCurrentTime: false,
      margin: { item: 12 },
      template(item) {
        const element = document.createElement("span");
        // vis-timeline may call templates with null when removing a selected
        // item or tearing down a source snapshot; never crash during cleanup.
        element.textContent = String(item?.content ?? "");
        return element;
      },
      groupTemplate(item) {
        const element = document.createElement("span");
        // vis-timeline may call templates with null when removing a selected
        // item or tearing down a source snapshot; never crash during cleanup.
        element.textContent = String(item?.content ?? "");
        return element;
      },
    },
    items: content.events.map((event) => ({
      id: event.id,
      content: event.label,
      // useVisTimeline escapes this text once. Pre-escaping would render
      // literal HTML entities in tooltips (including ampersands and line breaks).
      title: event.label,
      start: event.start,
      ...(event.end === undefined ? {} : { end: event.end }),
      group: event.lane,
    })),
    groups: content.lanes.map((lane) => ({ id: lane.id, content: lane.label })),
    dataKey,
    bounds,
    window,
    onWindow: setWindow,
    selection: source
      ? selectedSourceId
        ? [selectedSourceId]
        : []
      : props.selected?.collection === "events"
        ? [props.selected.elementId]
        : [],
    onSelect,
    onMove: source
      ? undefined
      : async (moved) => {
          const before = content.events.find((event) => event.id === String(moved.id));
          if (!before || !props.onEdit) throw new Error("The event cannot be edited");
          try {
            await props.onEdit({
              generation: model.generation,
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
    onReady: acknowledge,
  });
  return (
    <div className="bvm-timeline">
      <div className="bvm-time-toolbar">
        {source && (
          <span role="status" style={{ marginRight: "auto" }}>
            {content.events.length} host-resolved events
          </span>
        )}
        <button type="button" onClick={() => timeline.navigate("fit")}>
          Fit timeline
        </button>
      </div>
      <div className="bvm-engine" ref={target} />
    </div>
  );
}

/** Inline authoring remains guarded; dataset facts are temporary, read-only views. */
export default function TimelineView(props: AdapterProps) {
  const prepared = useMemo<Accepted | { error: string; report: boolean }>(() => {
    if (!props.model.content.datasource)
      return { content: props.model.content as unknown as TimelineContent };
    if (!props.timelineRows)
      return {
        error: "Resolve this timeline's dataset in the host; no source rows were supplied.",
        // An unresolved datasource was previously an informational notice,
        // not a host error. Preserve that embedding behavior.
        report: false,
      };
    try {
      return prepareHostTimeline(props.model, props.timelineRows, props.registry);
    } catch {
      return {
        error:
          "The host's timeline snapshot is missing, stale or invalid; source rows were not displayed.",
        report: true,
      };
    }
  }, [
    props.model,
    props.registry,
    props.timelineRows?.sourceKey,
    props.timelineRows?.revision,
    props.timelineRows?.rows,
  ]);
  const error = "error" in prepared && prepared.report ? prepared.error : undefined;
  const reported = useRef<{ key: string; error: string } | null>(null);
  const frame = `${props.model.id}:${props.model.generation}:${props.model.revision}:${props.timelineRows?.sourceKey ?? ""}:${props.timelineRows?.revision ?? ""}`;
  useEffect(() => {
    if (!error) {
      reported.current = null;
      return;
    }
    if (
      props.active === false ||
      (reported.current?.key === frame && reported.current.error === error)
    )
      return;
    reported.current = { key: frame, error };
    props.report(error);
  }, [error, props.report, props.active, frame]);
  if ("error" in prepared)
    return (
      <div className="bvm-notice" role="status">
        {prepared.error} The saved timeline content is unchanged.
      </div>
    );
  return (
    <TimelineSurface
      key={`${props.model.id}:${props.model.generation}:${prepared.source?.sourceKey ?? "inline"}`}
      {...props}
      view={prepared}
    />
  );
}
