import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { createModel, editModel, type ModelEdit } from "@ponchia/visual-models";
import { VisualModelView } from "@ponchia/visual-models/react";
import "@ponchia/visual-models/styles.css";
const rows = Array.from({ length: 31 }, (_, i) => ({
  label: `Service ${i + 1}`,
  value: i + 1,
  note: i === 0 ? '<img src="https://example.invalid/tracker" onerror="alert(1)">' : "",
}));
const bar = {
  mark: "bar",
  encoding: {
    x: { field: "label", type: "nominal", axis: { labels: false } },
    y: { field: "value", type: "quantitative" },
    tooltip: [{ field: "label" }, { field: "note" }],
  },
};
/** A single full-plot mark makes a click-selection visually observable. */
const localPoint = {
  mark: "rect",
  params: [{ name: "picked", select: { type: "point", encodings: ["x"], toggle: false } }],
  encoding: {
    x: { field: "category", type: "nominal", axis: null },
    y: { field: "series", type: "nominal", axis: null },
    color: {
      condition: { param: "picked", empty: false, value: "#b30000" },
      value: "#cccccc",
    },
  },
};
const localInterval = {
  mark: "point",
  params: [{ name: "brush", select: { type: "interval", encodings: ["x", "y"] } }],
  encoding: {
    x: { field: "value", type: "quantitative", axis: null },
    y: { field: "point", type: "quantitative", axis: null },
    color: { condition: { param: "brush", empty: false, value: "#b30000" }, value: "#cccccc" },
  },
};
function App() {
  const [model, setModel] = useState(() =>
    createModel({
      id: "chart",
      title: "Inline chart example",
      renderer: "vega-lite",
      content: { spec: bar, values: rows },
    }),
  );
  const [active, setActive] = useState(true);
  const [changingHandler, setChangingHandler] = useState(false);
  const [notifications, setNotifications] = useState(0);
  const [ready, setReady] = useState(0);
  const [readyHistory, setReadyHistory] = useState<number[]>([]);
  const acknowledge = useCallback((identity: { revision: number }) => {
    setReady(identity.revision);
    setReadyHistory((old) => (old.includes(identity.revision) ? old : [...old, identity.revision]));
  }, []);
  const [failures, setFailures] = useState<string[]>([]);
  const [errorHistory, setErrorHistory] = useState<number[]>([]);
  const report = useCallback(
    (message: string) => {
      setFailures((old) => (old.at(-1) === message ? old : [...old, message]));
      setErrorHistory((old) => (old.includes(model.revision) ? old : [...old, model.revision]));
    },
    [model.revision],
  );
  const change = (content: ModelEdit["content"]) =>
    setModel((current) => editModel(current, { ifRevision: current.revision, content }).model);
  return (
    <main style={{ maxWidth: 950, padding: 12, margin: "auto" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          onClick={() => change({ values: rows.map((row) => ({ ...row, value: row.value * 3 })) })}
        >
          Update rows
        </button>
        <button onClick={() => change({ values: rows.slice(0, 3) })}>Fewer rows</button>
        <button onClick={() => change({ values: [] })}>Empty rows</button>
        <button onClick={() => change({ spec: { ...bar, mark: "line" } })}>Line chart</button>
        <button
          onClick={() =>
            change({
              spec: {
                ...bar,
                transform: [{ calculate: "datum.value * 2", as: "double" }],
                encoding: { ...bar.encoding, y: { field: "double", type: "quantitative" } },
              },
            })
          }
        >
          Calculated chart
        </button>
        <button
          onClick={() =>
            change({
              spec: {
                vconcat: [
                  { ...bar, width: 250, height: 120 },
                  { ...bar, mark: "point", width: 250, height: 120 },
                ],
              },
            })
          }
        >
          Composed chart
        </button>
        <button
          onClick={() =>
            change({
              spec: {
                ...bar,
                transform: [{ calculate: "datum.nested.value", as: "computed" }],
                encoding: { ...bar.encoding, y: { field: "computed", type: "quantitative" } },
              },
              values: rows.map((row) => ({ ...row, nested: { value: row.value } })),
            })
          }
        >
          Nested chart
        </button>
        <button onClick={() => change({ values: rows.map((row) => ({ ...row, nested: null })) })}>
          Invalid calculation rows
        </button>
        <button
          onClick={() =>
            change({ values: rows.map((row) => ({ ...row, nested: { value: row.value } })) })
          }
        >
          Restore calculation rows
        </button>
        <button onClick={() => change({ spec: { missingMark: true } })}>Invalid grammar</button>
        <button
          onClick={() =>
            change({
              spec: { layer: [{ ...bar, data: { url: "https://example.invalid/secret" } }] },
            })
          }
        >
          External data
        </button>
        <button
          onClick={() =>
            change({
              spec: {
                mark: "image",
                encoding: { url: { value: "https://example.invalid/tracker" } },
              },
            })
          }
        >
          External image
        </button>
        <button
          onClick={() =>
            change({
              spec: { mark: "point", encoding: { href: { value: "https://example.invalid/" } } },
            })
          }
        >
          External link
        </button>
        <button
          onClick={() =>
            change({
              spec: {
                ...bar,
                params: [{ name: "p", value: 1, bind: { element: "#host-input", input: "text" } }],
              },
            })
          }
        >
          External binding
        </button>
        <button
          onClick={() =>
            change({
              spec: localPoint,
              values: [{ category: "Selected region", series: "One", value: 1 }],
            })
          }
        >
          Local point selection
        </button>
        <button
          onClick={() =>
            change({
              spec: localInterval,
              values: [
                { value: 1, point: 1 },
                { value: 2, point: 2 },
              ],
            })
          }
        >
          Local interval selection
        </button>
        <button onClick={() => change({ spec: bar, values: rows })}>Recover chart</button>
        <button onClick={() => setActive((a) => !a)}>Toggle active</button>
        <button
          onClick={() =>
            setModel(
              (m) =>
                editModel(m, {
                  title: "Renamed chart",
                  description: "Updated accessible chart description",
                }).model,
            )
          }
        >
          Rename chart
        </button>
        <button onClick={() => setModel((m) => editModel(m, { description: "" }).model)}>
          Clear chart description
        </button>
        <button onClick={() => setChangingHandler((v) => !v)}>Toggle changing error handler</button>
      </div>
      <label>
        Host input <input id="host-input" defaultValue="untouched" />
      </label>
      <output data-testid="revision">{model.revision}</output>
      <output data-testid="ready">{ready}</output>
      <output data-testid="notification-count">{notifications}</output>
      <output data-testid="ready-history" style={{ display: "block", overflowWrap: "anywhere" }}>
        {JSON.stringify(readyHistory)}
      </output>
      <output data-testid="error-history" style={{ display: "block", overflowWrap: "anywhere" }}>
        {JSON.stringify(errorHistory)}
      </output>
      <output data-testid="active">{String(active)}</output>
      <VisualModelView
        model={model}
        height={460}
        active={active}
        onReady={acknowledge}
        onError={
          changingHandler
            ? (message) => {
                report(message);
                // Bound a buggy callback feedback loop so the negative test is safe.
                setNotifications((n) => Math.min(8, n + 1));
              }
            : report
        }
      />
      <output data-testid="failures" style={{ overflowWrap: "anywhere" }}>
        {JSON.stringify(failures)}
      </output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
