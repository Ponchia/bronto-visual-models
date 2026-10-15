import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryModelStore,
  modelTargets,
  type ModelEdit,
  type VisualTarget,
} from "@ponchia/visual-models";
import { VisualModelView, useVisualModel } from "@ponchia/visual-models/react";
import "@ponchia/visual-models/styles.css";

function Harness() {
  const [store] = useState(() => new MemoryModelStore());
  const [id, setId] = useState("graph");
  const model = useVisualModel(store, id);
  const [mode, setMode] = useState("accept");
  const [selected, setSelected] = useState<VisualTarget | null>(null);
  const [pending, setPending] = useState(false);
  const rejected = useRef<((error: Error) => void) | null>(null);
  const sequence = useRef(0);
  const previous = useRef(model);
  const changed = useRef(0);
  if (previous.current !== model) {
    changed.current++;
    previous.current = model;
  }
  useEffect(() => {
    void (async () => {
      for (const name of ["graph", "other"])
        await store.execute({
          type: "create",
          key: `create-${name}`,
          model: {
            id: name,
            title: name,
            renderer: "diagram",
            content: {
              nodes: [
                { id: "a", label: "Original A", x: 0, y: 0 },
                { id: "b", label: "Node B", x: 300, y: 0 },
              ],
              edges: [],
            },
          },
        });
    })();
  }, [store]);
  const write = async (patch: ModelEdit) => {
    await store.execute({ type: "edit", id, key: `edit-${++sequence.current}`, patch });
  };
  const onEdit = (patch: ModelEdit): Promise<unknown> => {
    if (mode === "sync") throw new Error("Synchronous edit refused");
    if (mode === "delay")
      return new Promise((_resolve, reject) => {
        rejected.current = reject;
        setPending(true);
      });
    return write(patch);
  };
  return (
    <main style={{ width: 900, margin: 20 }}>
      <label>
        Commit mode{" "}
        <select
          aria-label="Commit mode"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="accept">Accept</option>
          <option value="sync">Synchronous refusal</option>
          <option value="delay">Delayed refusal</option>
        </select>
      </label>
      <button
        onClick={() =>
          void write({
            items: [{ field: "nodes", set: [{ id: "a", label: "Latest host A", x: 360, y: 100 }] }],
          })
        }
      >
        Host update
      </button>
      <button
        onClick={() => {
          rejected.current?.(new Error("Delayed edit refused"));
          rejected.current = null;
          setPending(false);
        }}
      >
        Reject pending
      </button>
      <button onClick={() => setSelected(modelTargets(model!)[0])}>Select A</button>
      <button
        onClick={() =>
          void write({
            ifRevision: model!.revision,
            items: [{ field: "nodes", replace: ["a"], set: [{ id: "a", label: "Original A" }] }],
          })
        }
      >
        Replace A
      </button>
      <button onClick={() => setId((current) => (current === "graph" ? "other" : "graph"))}>
        Switch model
      </button>
      <button
        onClick={() =>
          void store.execute({
            type: "edit",
            id: "other",
            key: `other-${++sequence.current}`,
            patch: { title: "Unrelated" },
          })
        }
      >
        Unrelated update
      </button>
      <output data-testid="snapshot-changes">{changed.current}</output>
      <output data-testid="pending">{String(pending)}</output>
      <output data-testid="saved">{model ? JSON.stringify(model.content.nodes) : "loading"}</output>
      <output data-testid="revision">{model?.revision}</output>
      {model && (
        <VisualModelView
          model={model}
          height={430}
          selected={selected}
          onSelect={setSelected}
          onEdit={onEdit}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
