import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { chartSourceKey, createModel, editModel } from "@ponchia/visual-models";
import { VisualModelView } from "@ponchia/visual-models/react";
import "@ponchia/visual-models/styles.css";

const mark = {
  mark: "bar",
  encoding: {
    x: { field: "service", type: "nominal" },
    y: { field: "requests", type: "quantitative" },
  },
};
const first = [
  { service: "Orders", requests: 14 },
  { service: "Search", requests: 28 },
];
const refreshed = [
  { service: "Orders", requests: 87, note: '<img src="https://example.invalid/tracker">' },
  { service: "Search", requests: 13 },
];
const original = createModel({
  id: "host-chart",
  title: "Trusted host chart",
  renderer: "vega-lite",
  content: {
    spec: mark,
    datasource: "dataset",
    params: { dataset: "metrics-2026", revision: 1 },
  },
});

declare global {
  interface Window {
    hostChartPageErrors?: string[];
  }
}

function App() {
  const [model, setModel] = useState(original);
  const [data, setData] = useState(() => ({
    sourceKey: chartSourceKey(original)!,
    revision: "snapshot-1",
    rows: first as Array<Record<string, unknown>>,
  }));
  const [supplied, setSupplied] = useState(true);
  const [active, setActive] = useState(true);
  const [ready, setReady] = useState({
    modelRevision: 0,
    revision: "",
    digest: "",
    sourceKey: "",
    count: 0,
  });
  const [errors, setErrors] = useState<string[]>([]);
  const resolved = useMemo(() => (supplied ? data : undefined), [supplied, data]);
  return (
    <main style={{ maxWidth: 960, padding: 12, margin: "auto" }}>
      <h1>Host-resolved chart consumer</h1>
      <div role="group" aria-label="Host chart operations">
        <button
          type="button"
          onClick={() =>
            setData((old) => ({
              ...old,
              revision: "snapshot-2",
              rows: refreshed,
            }))
          }
        >
          Refresh resolved rows
        </button>
        <button
          type="button"
          onClick={() =>
            setData((old) => ({
              ...old,
              revision: "snapshot-3",
              rows: [{ service: "CONFIDENTIAL-NEVER-REPORT", requests: Infinity }],
            }))
          }
        >
          Invalid host rows
        </button>
        <button
          type="button"
          onClick={() =>
            setData((old) => ({
              ...old,
              revision: "snapshot-4",
              rows: first,
            }))
          }
        >
          Restore valid host rows
        </button>
        <button type="button" onClick={() => setSupplied(false)}>
          Remove host snapshot
        </button>
        <button type="button" onClick={() => setSupplied(true)}>
          Restore host snapshot
        </button>
        <button
          type="button"
          onClick={() =>
            setData((old) => ({
              ...old,
              revision: "snapshot-5",
              sourceKey: "f".repeat(64),
            }))
          }
        >
          Wrong source key
        </button>
        <button
          type="button"
          onClick={() =>
            setData((old) => ({
              ...old,
              revision: "snapshot-6",
              sourceKey: chartSourceKey(model)!,
            }))
          }
        >
          Resolve current source
        </button>
        <button
          type="button"
          onClick={() =>
            setModel(
              (old) =>
                editModel(old, {
                  ifRevision: old.revision,
                  content: {
                    params: { dataset: "new-metrics-2026", revision: 2 },
                  },
                }).model,
            )
          }
        >
          Change source binding
        </button>
        <button type="button" onClick={() => setActive((old) => !old)}>
          Toggle active
        </button>
      </div>
      <label>
        Unrelated host field <input defaultValue="unaltered" />
      </label>
      <output data-testid="model-revision">{model.revision}</output>
      <output data-testid="data-revision">{data.revision}</output>
      <output data-testid="ready-model">{ready.modelRevision}</output>
      <output data-testid="ready-source">{ready.revision}</output>
      <output data-testid="ready-digest">{ready.digest}</output>
      <output data-testid="ready-count">{ready.count}</output>
      <output data-testid="activity">{String(active)}</output>
      <output data-testid="saved-content">{JSON.stringify(model.content)}</output>
      <output data-testid="error-messages">{JSON.stringify(errors)}</output>
      <VisualModelView
        model={model}
        chartRows={resolved}
        active={active}
        height={440}
        onReady={({ revision, source }) => {
          if (!source) return;
          setReady((old) => ({
            modelRevision: revision,
            revision: source.revision,
            digest: source.digest,
            sourceKey: source.sourceKey,
            count:
              old.revision === source.revision && old.digest === source.digest
                ? old.count
                : old.count + 1,
          }));
        }}
        onError={(message) =>
          setErrors((old) => (old.at(-1) === message ? old : [...old, message]))
        }
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
