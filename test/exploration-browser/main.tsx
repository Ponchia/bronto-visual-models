import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createModel, editModel, modelTargets, type VisualTarget } from "@ponchia/visual-models";
import { VisualModelView } from "@ponchia/visual-models/react";
import "@ponchia/visual-models/styles.css";
let reads = 0;
const events: Array<Record<string, unknown>> = [];
const rawGraph = createModel({
  id: "explore",
  title: "Service dependencies",
  renderer: "diagram",
  content: {
    nodes: Array.from({ length: 60 }, (_, i) => ({
      id: `node-${String(i).padStart(3, "0")}`,
      label: `Component ${String(60 - i).padStart(3, "0")}`,
      x: (i % 10) * 260,
      y: Math.floor(i / 10) * 160,
      ports: Array.from({ length: 8 }, (_, j) => ({
        id: `port-${j}`,
        side: ["top", "right", "bottom", "left"][j % 4],
      })),
    })),
    edges: [
      ...Array.from({ length: 60 }, (_, i) => ({
        id: `edge-${String(i).padStart(3, "0")}`,
        label: `Connect ${i}`,
        source: `node-${String(i).padStart(3, "0")}`,
        target: `node-${String((i + 1) % 60).padStart(3, "0")}`,
      })),
      { id: "node-000", label: "Parallel contract", source: "node-000", target: "node-001" },
    ],
  },
});
const original = JSON.stringify(rawGraph);
const watchedGraph = {
  ...rawGraph,
  content: {
    ...rawGraph.content,
    nodes: (rawGraph.content.nodes as Record<string, unknown>[]).map(
      (node) =>
        new Proxy(node, {
          get(target, prop, receiver) {
            if (["x", "y", "ports"].includes(String(prop))) reads++;
            return Reflect.get(target, prop, receiver);
          },
        }),
    ),
  },
};
const longValue =
  "Full original value " +
  "x".repeat(300) +
  '<img src="https://example.invalid/data-is-not-an-image"> END';
const rawRows = Array.from({ length: 31 }, (_, i) =>
  Object.fromEntries(
    Array.from({ length: 45 }, (_, j) => [
      `column-${String(j).padStart(2, "0")}`,
      j === 0
        ? `Row ${i + 1}`
        : j === 1
          ? i + 1
          : j === 44 && i === 25
            ? longValue
            : `${i + 1}:${j}`,
    ]),
  ),
);
const rawChart = createModel({
  id: "wide",
  title: "Complete source data",
  renderer: "vega-lite",
  content: {
    spec: {
      mark: "bar",
      encoding: {
        x: { field: "column-00", type: "nominal" },
        y: { field: "column-01", type: "quantitative" },
      },
    },
    values: rawRows,
  },
});
function App() {
  const [model, setModel] = useState(watchedGraph);
  const [projection, setProjection] = useState("diagram");
  const [selected, setSelected] = useState<VisualTarget | null>(null);
  const [active, setActive] = useState(true);
  const targets = useMemo(() => modelTargets(model), [model]);
  const select = (target: VisualTarget | null) => {
    setSelected(target);
    events.push({ kind: "selection", target });
  };
  Object.assign(window, {
    exploration: {
      events,
      longValue,
      original,
      source: () => JSON.stringify(rawGraph),
      reads: () => reads,
      resetReads: () => {
        reads = 0;
      },
      select: (id: string) =>
        flushSync(() =>
          select(targets.find((t) => t.collection === "nodes" && t.elementId === id) ?? null),
        ),
    },
  });
  return (
    <main style={{ maxWidth: 1100, margin: "auto", padding: 12 }}>
      <h1>Graph and data exploration</h1>
      <nav aria-label="Test examples" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          onClick={() => {
            setModel(watchedGraph);
            setProjection("diagram");
            setSelected(null);
          }}
        >
          Diagram
        </button>
        <button
          onClick={() => {
            setModel(watchedGraph);
            setProjection("network");
            setSelected(null);
          }}
        >
          Network
        </button>
        <button
          onClick={() => {
            setModel(watchedGraph);
            setProjection("matrix");
            setSelected(null);
          }}
        >
          Matrix
        </button>
        <button
          onClick={() => {
            setModel(rawChart);
            setProjection("vega-lite");
            setSelected(null);
          }}
        >
          Wide chart
        </button>
        <button onClick={() => setActive((v) => !v)}>Toggle active</button>
        <button
          onClick={() =>
            setModel(
              (m) =>
                editModel(m, { content: { values: [{ "column-00": "Only", "column-01": 1 }] } })
                  .model,
            )
          }
        >
          Shrink chart data
        </button>
      </nav>
      <p>
        Selection:{" "}
        <output data-testid="selected">
          {selected ? `${selected.collection}:${selected.elementId}` : "none"}
        </output>
      </p>
      <output data-testid="revision">{model.revision}</output>
      <VisualModelView
        model={model}
        projection={projection}
        height={620}
        active={active}
        selected={selected}
        onSelect={select}
        onReady={(identity) => events.push({ kind: "ready", ...identity })}
        onError={(message) => events.push({ kind: "error", message })}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
