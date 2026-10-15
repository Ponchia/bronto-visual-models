import React, { useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { parse, View, logger, None } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import { useVisTimeline, type VisTimeline } from "@ponchia/visual-models/engines/vis-timeline";
import "@ponchia/visual-models/styles.css";
import { lightTheme } from "@ponchia/visual-models/react";
import { useVegaSurface, type VegaSurface } from "@ponchia/visual-models/engines/vega-surface";

/** Test-only controls, never included in the published demo or a host model. */
type Input = { revision: number; value: number; active: boolean; ready: boolean; mounted: boolean };
type Point = "run" | "settle";
const root = createRoot(document.getElementById("root")!);
let input: Input = {
  engine: "vega",
  revision: 1,
  value: 1,
  active: true,
  ready: true,
  mounted: false,
};
let serial = 0;
let surface: VegaSurface | undefined;
let timeline: VisTimeline | undefined;
let lastDrawn: number | null = null;
const events: Array<Record<string, unknown>> = [];
let barrier: {
  point: Point;
  entered: boolean;
  reject: boolean;
  promise: Promise<void>;
  release(): void;
} | null = null;
const record = (kind: string, details: Record<string, unknown> = {}) =>
  events.push({ kind, mounted: input.mounted, active: input.active, ...details });
async function pause(point: Point) {
  const owned = barrier;
  if (!owned || owned.point !== point || owned.entered) return;
  owned.entered = true;
  await owned.promise;
  if (owned.reject) throw new Error("Synthetic settled-frame failure");
}
function Surface(props: Input) {
  const container = useRef<HTMLDivElement>(null);
  const held = useVegaSurface(container, {
    identity: "controlled-surface",
    active: props.active,
    tokens: lightTheme,
    data: { key: String(props.revision), sets: () => ({ rows: [{ value: props.value }] }) },
    create: async ({ container: element, size, data }) => {
      const id = ++serial;
      record("create", { engine: id });
      const spec = {
        width: size.width,
        height: size.height,
        data: [{ name: "rows", values: data.rows }],
        marks: [
          {
            type: "text",
            from: { data: "rows" },
            encode: {
              update: {
                x: { value: 30 },
                y: { value: 45 },
                text: { field: "value" },
                fontSize: { value: 24 },
              },
            },
          },
        ],
      };
      const diagnostics = logger(None);
      diagnostics.error = () => {
        throw new Error("Synthetic view evaluation failure");
      };
      const view = new View(parse(spec, undefined, { ast: true }), {
        renderer: "canvas",
        container: element,
        expr: expressionInterpreter,
        logger: diagnostics,
      });
      const run = view.runAsync.bind(view);
      view.runAsync = async (...args) => {
        record("run", { engine: id });
        await pause("run");
        return run(...args);
      };
      const finalize = view.finalize.bind(view);
      view.finalize = () => {
        record("finalize", { engine: id });
        return finalize();
      };
      return view;
    },
    settle: async () => {
      await pause("settle");
      return undefined;
    },
    onAcquire: () => {
      const id = serial;
      record("acquire", { engine: id });
      return () => record("release", { engine: id });
    },
    onInvalidate: () => record("invalidate"),
    onDrawn: (view) => {
      lastDrawn = view.data("rows")[0]?.value ?? null;
      record("drawn", { value: lastDrawn });
    },
    onReady: props.ready
      ? () => record("ready", { revision: props.revision, value: lastDrawn })
      : undefined,
    onError: (message) => record("error", { revision: props.revision, message }),
  });
  useLayoutEffect(() => {
    surface = held;
  });
  return (
    <main>
      <h1>Controlled render lifecycle</h1>
      <p>
        Revision {props.revision} · requested value {props.value} ·{" "}
        {props.active ? "active" : "inactive"}
      </p>
      <div
        ref={container}
        style={{ width: 620, height: 200, visibility: props.active ? "visible" : "hidden" }}
      />
    </main>
  );
}
function TimelineSurface(props: Input) {
  const container = useRef<HTMLDivElement>(null);
  const held = useVisTimeline(container, {
    active: props.active,
    dataKey: String(props.revision),
    editable: false,
    look: { height: "100%", showCurrentTime: false },
    items: [
      {
        id: "item",
        group: "group",
        content: String(props.value),
        start: Date.UTC(2026, 9, 15, 12),
      },
    ],
    groups: [{ id: "group", content: "Synthetic timeline" }],
    bounds: { start: Date.UTC(2026, 9, 15), end: Date.UTC(2026, 9, 17) },
    window: undefined,
    selection: [],
    onWindow: (window) => record("window", { ...window }),
    onSelect: (ids) => record("select", { ids }),
    onAcquire: () => {
      record("acquire");
      return () => record("release");
    },
    onChanged: () => record("changed"),
    onReady: props.ready ? () => record("ready", { revision: props.revision }) : undefined,
  });
  useLayoutEffect(() => {
    timeline = held;
    surface = undefined;
  });
  return (
    <main>
      <h1>Timeline lifecycle</h1>
      <div
        ref={container}
        style={{ width: 620, height: 220, visibility: props.active ? "visible" : "hidden" }}
      />
    </main>
  );
}

const harness = {
  events,
  redrawTimeline: () => timeline?.engine?.redraw(),
  navigateTimeline: () => timeline?.navigate("in"),
  timelineWindow: () => {
    const value = timeline?.engine?.getWindow();
    return value ? [value.start.getTime(), value.end.getTime()] : null;
  },
  configure(patch: Partial<Input>) {
    input = { ...input, ...patch };
    flushSync(() =>
      root.render(
        input.mounted ? (
          <React.StrictMode>
            {input.engine === "timeline" ? <TimelineSurface {...input} /> : <Surface {...input} />}
          </React.StrictMode>
        ) : null,
      ),
    );
  },
  arm(point: Point, reject = false) {
    if (barrier) throw new Error("Release the previous test barrier first");
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    barrier = { point, entered: false, reject, promise, release };
  },
  waiting: () => barrier?.entered ?? false,
  release() {
    const owned = barrier;
    barrier = null;
    owned?.release();
  },
  idle: () => surface?.idle(),
  attest: () => surface?.attest(),
};
Object.assign(window, { surfaceHarness: harness });
