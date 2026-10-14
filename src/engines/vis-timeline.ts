import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { DataSet } from "vis-data";
import {
  type DataGroup,
  type DataItem,
  Timeline,
  type TimelineItem,
  type TimelineOptions,
} from "vis-timeline/peer";
import type { EngineLifecycle } from "./engine-lifecycle.ts";

export interface TimeWindow {
  start: number;
  end: number;
}

export const isTimeWindow = (value: unknown): value is TimeWindow => {
  const window = value as TimeWindow | null;
  return (
    !!window &&
    Number.isFinite(window.start) &&
    Number.isFinite(window.end) &&
    window.end > window.start
  );
};

/** Construction options the adapter chooses; the hook owns the rest. */
type VisTimelineLook = Omit<TimelineOptions, "editable" | "start" | "end" | "onMove" | "rtl">;

export interface VisTimelineOptions extends EngineLifecycle {
  /** Read once, when the engine is built. */
  look: VisTimelineLook;
  /** An item's `title` is text; it is shown as written, with its line breaks. */
  items: DataItem[];
  groups: DataGroup[];
  /** Identifies items and groups: an unchanged key is not applied again. */
  dataKey: string;
  /** Whether a reader may drag items, and whether a drag may change their group. */
  editable: boolean;
  moveBetweenGroups?: boolean;
  /** The data's range with its margin: Fit, and the first window when none was kept. */
  bounds: TimeWindow;
  /** The window this view keeps. Only a reader's pan or zoom, and the toolbar, write it. */
  window: TimeWindow | undefined;
  onWindow(window: TimeWindow): void;
  selection: readonly string[];
  onSelect(ids: string[]): void;
  /** Saves a drag. The engine keeps the moved item when it resolves and puts it back when it rejects. */
  onMove?(item: TimelineItem): Promise<void>;
  /** After each redraw, for overlays measured from the engine's DOM. */
  onChanged?(): void;
}

export interface VisTimeline {
  engine: Timeline | null;
  navigate(action: "fit" | "in" | "out" | "today"): void;
}

/**
 * Replaces a data set's content by id, so rows the reader shaped survive an
 * edit: `keep` names fields that are the reader's once a row exists.
 */
export function applyRows<T extends { id?: string | number }>(
  set: DataSet<T, "id">,
  next: T[],
  keep: ReadonlyArray<keyof T> = [],
): void {
  const ids = new Set(next.map((row) => row.id));
  set.remove(set.getIds().filter((id) => !ids.has(id)));
  const rows = next.map((row) => {
    if (row.id === undefined || !set.get(row.id)) return row;
    const update = { ...row };
    for (const field of keep) delete update[field];
    return update;
  });
  // Every row is a valid partial update; TypeScript cannot prove it for a generic row.
  set.update(rows as Parameters<typeof set.update>[0]);
}

/**
 * vis-timeline shows an item's title as HTML on one line, so a text title is
 * escaped and its line breaks become breaks.
 */
export const titleMarkup = (text: string): string =>
  text.replace(/[&<>]/g, (glyph) => `&#${glyph.charCodeAt(0)};`).replaceAll("\n", "<br>");

/**
 * One owner for a vis-timeline engine, shared by Timeline and Gantt: it builds
 * the engine once, applies items and groups by id, keeps only a reader's own
 * window, and attests a frame once it is settled and measurable.
 */
export function useVisTimeline(
  target: RefObject<HTMLElement | null>,
  options: VisTimelineOptions,
): VisTimeline {
  const latest = useRef(options);
  latest.current = options;
  const items = useRef(new DataSet<DataItem, "id">());
  const groups = useRef(new DataSet<DataGroup, "id">());
  const [engine, setEngine] = useState<Timeline | null>(null);
  /** The acknowledgement of the frame being drawn; cleared while it changes. */
  const ready = useRef<(() => void) | undefined>(undefined);
  const paint = useRef(() => {});
  const applied = useRef<string | null>(null);
  const framed = useRef(false);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const initial = latest.current;
    const opening = initial.window ?? initial.bounds;
    const timeline = new Timeline(element, items.current, groups.current, {
      ...initial.look,
      // Left undefined, vis-timeline hides its root until its initial draw
      // completes, and that needs a redraw after the first settled range.
      // Naming the direction the page already has keeps drawn frames visible.
      rtl: getComputedStyle(element).direction === "rtl",
      editable: false,
      start: new Date(opening.start),
      end: new Date(opening.end),
      onMove(item, callback) {
        const save = latest.current.onMove;
        if (!save) {
          callback(null);
          return;
        }
        save(item).then(
          () => callback(item),
          () => callback(null),
        );
      },
    });
    const release = initial.onAcquire?.() ?? (() => {});
    let frame = 0;
    let disposed = false;
    // Native changed events can fire halfway through a group/data update.
    // Acknowledgement belongs to the settled, measurable browser frame.
    const changed = () => {
      latest.current.onChanged?.();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (!disposed && latest.current.active && element.clientWidth && element.clientHeight)
            ready.current?.();
        });
      });
    };
    paint.current = changed;
    const size = new ResizeObserver(() => {
      if (!latest.current.active) return;
      latest.current.onInvalidate?.();
      timeline.redraw();
      changed();
    });
    size.observe(element);
    void document.fonts.ready.then(() => {
      if (!disposed) {
        timeline.redraw();
        changed();
      }
    });
    timeline.on("changed", changed);
    // The library redraws on a pan or zoom only once its initial draw is
    // complete: a redraw after the first settled range, 200 ms after
    // construction. Every redraw of an authored timeline lands sooner.
    const settled = () => {
      timeline.off("rangechanged", settled);
      timeline.redraw();
    };
    timeline.on("rangechanged", settled);
    timeline.on(
      "rangechanged",
      ({ start, end, byUser }: { start: Date; end: Date; byUser: boolean }) => {
        // Library initialization is not a reader's chosen window. Persisting
        // that provisional range strands asynchronously loaded data in 1970.
        if (byUser) latest.current.onWindow({ start: start.getTime(), end: end.getTime() });
      },
    );
    timeline.on("select", ({ items: ids }: { items: Array<string | number> }) =>
      latest.current.onSelect(ids.map(String)),
    );
    setEngine(timeline);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      size.disconnect();
      paint.current = () => {};
      ready.current = undefined;
      applied.current = null;
      framed.current = false;
      setEngine(null);
      timeline.destroy();
      release();
    };
  }, [target]);

  const { active, dataKey, editable, onReady } = options;
  useEffect(() => {
    if (!engine || !active) return;
    const current = latest.current;
    current.onInvalidate?.();
    ready.current = undefined;
    if (applied.current !== dataKey) {
      applied.current = dataKey;
      // A group's expansion is the reader's: an edit never re-expands it.
      applyRows(groups.current, current.groups, ["showNested"]);
      applyRows(
        items.current,
        current.items.map((item) =>
          item.title ? { ...item, title: titleMarkup(item.title) } : item,
        ),
      );
    }
    engine.setOptions({
      editable: editable
        ? { updateTime: true, updateGroup: !!current.moveBetweenGroups, add: false, remove: false }
        : false,
    });
    if (!framed.current && current.items.length) {
      // Explicit data bounds, not fit() against a still-unmeasured item set.
      const opening = current.window ?? current.bounds;
      engine.setWindow(opening.start, opening.end, { animation: false });
      framed.current = true;
    }
    ready.current = onReady;
    engine.redraw();
    paint.current();
    return () => {
      ready.current = undefined;
    };
  }, [engine, active, dataKey, editable, onReady]);

  const selectionKey = options.selection.join("\u0000");
  useEffect(() => {
    engine?.setSelection(selectionKey ? selectionKey.split("\u0000") : []);
  }, [engine, selectionKey]);

  const navigate = useCallback(
    (action: "fit" | "in" | "out" | "today") => {
      if (!engine) return;
      const { bounds } = latest.current;
      if (action === "fit") engine.setWindow(bounds.start, bounds.end, { animation: false });
      else if (action === "today") engine.moveTo(new Date(), { animation: false });
      else if (action === "in") engine.zoomIn(0.4, { animation: false });
      else engine.zoomOut(0.4, { animation: false });
      const window = engine.getWindow();
      latest.current.onWindow({ start: window.start.getTime(), end: window.end.getTime() });
      paint.current();
    },
    [engine],
  );
  return { engine, navigate };
}
