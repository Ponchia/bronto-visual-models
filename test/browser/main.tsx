import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryModelStore,
  createModel,
  editModel,
  modelTargets,
  type ModelEdit,
  type VisualTarget,
} from "@ponchia/visual-models";
import { VisualModelView, useVisualModel, lightTheme } from "@ponchia/visual-models/react";
import "@ponchia/visual-models/styles.css";

/** A commit between render and subscribe has no listener to notify yet. */
function SubscriptionRaceProbe() {
  const [source] = useState(() => {
    let current = createModel({
      id: "racing-subscription",
      title: "Before subscribe",
      renderer: "diagram",
      content: { nodes: [], edges: [] },
    });
    let advanced = false;
    return {
      get: () => current,
      subscribe: () => {
        if (!advanced) {
          advanced = true;
          current = editModel(current, { title: "Caught up after subscribe" }).model;
        }
        return () => {};
      },
    };
  });
  const model = useVisualModel(source, "racing-subscription");
  return <output data-testid="subscription-catchup">{model?.title}</output>;
}

function Harness() {
  const [store] = useState(() => new MemoryModelStore());
  const reads = useRef(0);
  const source = useMemo(
    () => ({
      get(id: string) {
        reads.current++;
        return store.get(id);
      },
      subscribe: (listener: Parameters<MemoryModelStore["subscribe"]>[0]) =>
        store.subscribe(listener),
    }),
    [store],
  );
  const [id, setId] = useState("graph");
  const model = useVisualModel(source, id);
  const [mode, setMode] = useState("accept");
  const [writable, setWritable] = useState(true);
  const [customTheme, setCustomTheme] = useState(false);
  const tokens = useMemo(
    () =>
      customTheme
        ? {
            ...lightTheme,
            scheme: "dark" as const,
            panel: "#17202a",
            text: "#f5f6fa",
            edge: "#91b7e5",
            accent: "#ffa047",
            focus: "#ffdf00",
            panelStrong: "#253649",
          }
        : lightTheme,
    [customTheme],
  );
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
      await store.execute({
        type: "create",
        key: "create-schedule",
        model: { id: "schedule", title: "Schedule fixture", template: "gantt" },
      });
      await store.execute({
        type: "create",
        key: "create-many",
        model: {
          id: "many",
          title: "Large data fixture",
          renderer: "diagram",
          content: {
            nodes: Array.from({ length: 120 }, (_, index) => ({
              id: `row-${index}`,
              label: `Record ${index}`,
              x: index * 10,
              y: 0,
            })),
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
      <SubscriptionRaceProbe />
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
      <button onClick={() => setId("schedule")}>Open schedule</button>
      <button onClick={() => setId("many")}>Open large model</button>
      <button onClick={() => setWritable((current) => !current)}>Toggle editing</button>
      <button onClick={() => setCustomTheme(true)}>Custom theme</button>
      <button
        onClick={() =>
          void write({
            items: [
              {
                field: "nodes",
                set: [
                  {
                    id: "a",
                    ports: [
                      { id: "out1", side: "right" },
                      { id: "out2", side: "right" },
                    ],
                  },
                ],
              },
              {
                field: "edges",
                set: [
                  {
                    id: "port-edge",
                    label: "custom to top",
                    source: "a",
                    target: "b",
                    sourcePort: "out2",
                    targetPort: "top",
                  },
                ],
              },
            ],
          })
        }
      >
        Custom ports
      </button>
      <button
        onClick={() =>
          void write({
            items: [
              {
                field: "nodes",
                set: [
                  {
                    id: "a",
                    ports: [
                      { id: "out1", side: "bottom" },
                      { id: "out2", side: "bottom" },
                    ],
                  },
                ],
              },
            ],
          })
        }
      >
        Move port sides
      </button>
      <output data-testid="snapshot-changes">{changed.current}</output>
      <output data-testid="snapshot-reads">{reads.current}</output>
      <output data-testid="pending">{String(pending)}</output>
      <output data-testid="saved">{model ? JSON.stringify(model.content.nodes) : "loading"}</output>
      <output data-testid="revision">{model?.revision}</output>
      {model && (
        <VisualModelView
          model={model}
          tokens={tokens}
          height={430}
          selected={selected}
          onSelect={setSelected}
          onEdit={writable ? onEdit : undefined}
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
