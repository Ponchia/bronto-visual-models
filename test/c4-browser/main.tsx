import React, { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MemoryModelStore, type ModelEdit, type VisualTarget } from "@ponchia/visual-models";
import { c4RecordEdit, c4PositionEdit, c4Scene } from "@ponchia/visual-models/render/c4";
import { VisualModelView, useVisualModel } from "@ponchia/visual-models/react";
import "@ponchia/visual-models/styles.css";
const store = new MemoryModelStore();
const events: any[] = [];
let sequence = 0,
  lastEdit = "";
let configure: (patch: any) => void;
let release: (() => void) | undefined;
const current = () => store.get("architecture")!;
async function edit(patch: ModelEdit) {
  const key = `edit-${++sequence}`;
  const result = await store.execute({ type: "edit", key, id: "architecture", patch });
  lastEdit = key;
  return result;
}
const harness = {
  events,
  configure: (patch: any) => configure(patch),
  // Renders and runs effects synchronously, as an engine store update does when
  // it happens inside a ResizeObserver delivery.
  configureSync: (patch: any) => flushSync(() => configure(patch)),
  snapshot: () => store.snapshot(),
  current,
  position: (view: string, id: string) =>
    c4Scene(current().content as any, view).elements.find((e) => e.element.id === id),
  label: (id: string, label: string) => edit(c4RecordEdit(current(), "elements", id, { label })),
  move: (view: string, id: string, x: number) => {
    const positions = c4Scene(current().content as any, view).elements.map((e) => ({
      elementId: e.element.id,
      x: e.element.id === id ? x : e.x,
      y: e.y,
    }));
    return edit(c4PositionEdit(current(), view, positions));
  },
  replace: (id: string) =>
    edit({
      ifRevision: current().revision,
      items: [{ field: "elements", replace: [id], set: [{ id, label: "Replacement API" }] }],
    }),
  undo: () =>
    store.execute({
      type: "undo",
      key: `undo-${++sequence}`,
      id: "architecture",
      operation: lastEdit,
    }),
  waiting: () => !!release,
  release: () => {
    const done = release;
    release = undefined;
    done?.();
  },
};
(window as any).c4Harness = harness;
function App() {
  const model = useVisualModel(store, "architecture");
  const [options, setOptions] = useState({
    active: true,
    readOnly: false,
    mode: "accept",
    viewId: null as string | null,
    controlSelection: false,
    controlNavigation: false,
    mounted: true,
  });
  const [selected, setSelected] = useState<VisualTarget | null>(null);
  configure = (patch) => setOptions((o) => ({ ...o, ...patch }));
  const onEdit = (patch: ModelEdit) => {
    events.push({ kind: "edit", active: options.active, patch });
    if (options.mode === "sync") throw new Error("Synchronous host refusal");
    if (options.mode === "async") return Promise.reject(new Error("Asynchronous host refusal"));
    if (options.mode === "delayed")
      return new Promise((_, reject) => {
        release = () => reject(new Error("Delayed host refusal"));
      });
    return edit(patch);
  };
  return (
    <main style={{ margin: 0, maxWidth: "100%" }}>
      <h1 style={{ fontSize: 20 }}>C4 contract fixture</h1>
      {model && options.mounted && (
        // An embedding canvas guards its own gestures with React Flow's default
        // classes on every ancestor of node content, as Spatial's nodes do.
        <div className="nodrag nowheel nopan">
          <VisualModelView
            model={model}
            height={780}
            active={options.active}
            selected={options.controlSelection ? selected : undefined}
            onSelect={(target) => {
              setSelected(target);
              events.push({ kind: "select", target });
            }}
            c4ViewId={options.viewId ?? undefined}
            onC4ViewChange={
              options.controlNavigation ? (viewId) => configure({ viewId }) : undefined
            }
            onEdit={options.readOnly ? undefined : onEdit}
            onReady={(identity) =>
              events.push({ kind: "ready", active: options.active, ...identity })
            }
            onError={(message) => events.push({ kind: "error", active: options.active, message })}
          />
        </div>
      )}
    </main>
  );
}
void store
  .execute({
    type: "create",
    key: "create",
    model: { id: "architecture", title: "Commerce architecture", template: "c4-commerce" },
  })
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
