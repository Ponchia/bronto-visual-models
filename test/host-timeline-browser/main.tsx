import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createModel,
  editModel,
  timelineSourceKey,
  type SourceRowTarget,
} from "@ponchia/visual-models";
import { VisualModelView } from "@ponchia/visual-models/react";
import "@ponchia/visual-models/styles.css";

const rows = [
  {
    rowId: "order-1",
    label: "Order received",
    started: "2026-10-29T09:00:00Z",
    ended: "2026-10-29T09:20:00Z",
    stream: "Orders",
    entity: "order-123",
  },
  {
    rowId: "build-2",
    label: '<img src="https://example.invalid/tracker">',
    started: "2026-10-29T10:00:00Z",
    stream: "Build",
    entity: "job-456",
  },
];
const refreshed = [
  {
    ...rows[0],
    label: "Order verified",
    started: "2026-10-29T09:30:00Z",
    ended: "2026-10-29T09:45:00Z",
  },
  rows[1],
  {
    rowId: "order-3",
    label: "Order shipped",
    started: "2026-10-29T10:40:00Z",
    stream: "Orders",
    entity: "order-123",
  },
];
const firstModel = createModel({
  id: "source-timeline",
  title: "Host source events",
  renderer: "timeline",
  content: {
    datasource: "dataset",
    params: { dataset: "events-2026", revision: 1 },
    fields: {
      label: "label",
      start: "started",
      end: "ended",
      lane: "stream",
      entity: "entity",
    },
    lanes: [],
    events: [],
  },
});

function App() {
  const [model, setModel] = useState(firstModel);
  const [snapshot, setSnapshot] = useState(() => ({
    sourceKey: timelineSourceKey(firstModel)!,
    revision: "snapshot-1",
    rows: rows as Array<Record<string, unknown>>,
  }));
  const [supplied, setSupplied] = useState(true);
  const [active, setActive] = useState(true);
  const [selection, setSelection] = useState<SourceRowTarget | null>(null);
  const [ready, setReady] = useState({ sourceKey: "", revision: "", digest: "", modelRevision: 0 });
  const [editAttempts, setEditAttempts] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const change = (content: Record<string, unknown>) =>
    setModel(
      (current) =>
        editModel(current, {
          ifRevision: current.revision,
          content,
        }).model,
    );
  return (
    <main style={{ maxWidth: 980, margin: "auto", padding: 12 }}>
      <h1>Host-resolved timeline consumer</h1>
      <nav aria-label="Timeline host controls">
        <button
          type="button"
          onClick={() =>
            setSnapshot((previous) => ({
              ...previous,
              revision: "snapshot-2",
              rows: refreshed,
            }))
          }
        >
          Refresh timeline data
        </button>
        <button
          type="button"
          onClick={() =>
            setSnapshot((previous) => ({
              ...previous,
              revision: "snapshot-3",
              rows: [{ ...rows[0], started: "PRIVATE-SOURCE-SECRET" }],
            }))
          }
        >
          Invalid timeline rows
        </button>
        <button
          type="button"
          onClick={() =>
            setSnapshot((previous) => ({
              ...previous,
              revision: "snapshot-4",
              rows: rows,
            }))
          }
        >
          Restore timeline rows
        </button>
        <button
          type="button"
          onClick={() =>
            setSnapshot((previous) => ({
              ...previous,
              revision: "snapshot-5",
              sourceKey: "f".repeat(64),
            }))
          }
        >
          Wrong timeline source
        </button>
        <button
          type="button"
          onClick={() =>
            setSnapshot((previous) => ({
              ...previous,
              revision: "snapshot-6",
              sourceKey: timelineSourceKey(model)!,
            }))
          }
        >
          Resolve current timeline source
        </button>
        <button
          type="button"
          onClick={() =>
            change({
              params: { dataset: "events-new", revision: 2 },
            })
          }
        >
          Change timeline source
        </button>
        <button type="button" onClick={() => setSupplied(false)}>
          Remove timeline snapshot
        </button>
        <button type="button" onClick={() => setSupplied(true)}>
          Restore timeline snapshot
        </button>
        <button type="button" onClick={() => setActive((value) => !value)}>
          Toggle timeline activity
        </button>
      </nav>
      <label>
        Unrelated host input <input defaultValue="unchanged" />
      </label>
      <output data-testid="model-revision">{model.revision}</output>
      <output data-testid="snapshot-revision">{snapshot.revision}</output>
      <output data-testid="ready-source">{ready.revision}</output>
      <output data-testid="ready-model">{ready.modelRevision}</output>
      <output data-testid="ready-digest">{ready.digest}</output>
      <output data-testid="selected-source-row">{selection?.rowId ?? "none"}</output>
      <output data-testid="selected-source-revision">{selection?.revision ?? "none"}</output>
      <output data-testid="selected-source-entity">{selection?.entityId ?? "none"}</output>
      <output data-testid="edit-attempts">{editAttempts}</output>
      <output data-testid="saved-content">{JSON.stringify(model.content)}</output>
      <output data-testid="error-messages">{JSON.stringify(errors)}</output>
      <VisualModelView
        model={model}
        timelineRows={supplied ? snapshot : undefined}
        sourceSelected={selection}
        onSourceSelect={setSelection}
        active={active}
        height={460}
        onEdit={async () => {
          setEditAttempts((value) => value + 1);
          throw new Error("Dataset is read-only");
        }}
        onReady={(identity) => {
          if (!identity.source) return;
          setReady({
            modelRevision: identity.revision,
            ...identity.source,
          });
        }}
        onError={(message) =>
          setErrors((previous) => (previous.at(-1) === message ? previous : [...previous, message]))
        }
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
