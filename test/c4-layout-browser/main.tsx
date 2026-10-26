import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryModelStore, type ModelEdit } from "@ponchia/visual-models";
import { VisualModelView, useVisualModel } from "@ponchia/visual-models/react";
import { c4RecordEdit, c4Scene } from "@ponchia/visual-models/render/c4";
import type { C4LayoutRunner } from "@ponchia/visual-models/layout/c4";
// build-packed-demo copies the real demo's worker adapter into this isolated consumer.
import { computeC4Layout } from "./layout";
import "@ponchia/visual-models/styles.css";
const store = new MemoryModelStore(),
  events: any[] = [];
let sequence = 0,
  last = "",
  configure!: (patch: any) => void,
  release: (() => void) | undefined;
let mode = "real";
const current = () => store.get("architecture")!;
const edit = async (patch: ModelEdit) => {
  const key = `edit-${++sequence}`,
    result = await store.execute({ type: "edit", key, id: "architecture", patch });
  last = key;
  return result;
};
const runner: C4LayoutRunner = async (model, view, options, signal) => {
  const captured = mode;
  events.push({ kind: "request", view, revision: model.revision });
  signal.addEventListener("abort", () => events.push({ kind: "abort", view }), { once: true });
  if (captured === "error") throw new Error("Layout provider refused the request");
  const result = await computeC4Layout(
    model,
    captured === "wrong-view" ? (view === "context" ? "containers" : "context") : view,
    options,
    signal,
  );
  if (captured === "delay")
    await new Promise<void>((resolve) => {
      release = resolve;
    }); // Deliberately ignores abort after computation.
  if (captured === "malformed")
    result.patch.items!.push({
      field: "elements",
      set: [{ id: "shop", label: "Smuggled rename" }],
    });
  return result;
};
(window as any).c4LayoutHarness = {
  events,
  current,
  snapshot: () => store.snapshot(),
  configure: (p: any) => configure(p),
  provider: (value: string) => {
    mode = value;
  },
  waiting: () => !!release,
  release: () => {
    const done = release;
    release = undefined;
    done?.();
  },
  rename: (label: string) => edit(c4RecordEdit(current(), "elements", "shop", { label })),
  undo: () =>
    store.execute({ type: "undo", key: `undo-${++sequence}`, id: "architecture", operation: last }),
  position: (view: string, id: string) =>
    c4Scene(current().content as any, view).elements.find((e) => e.element.id === id),
};
function App() {
  const model = useVisualModel(store, "architecture");
  const [options, setOptions] = useState({
    active: true,
    readOnly: false,
    mounted: true,
    editMode: "accept",
  });
  configure = (patch) => setOptions((o) => ({ ...o, ...patch }));
  const onEdit = (patch: ModelEdit) => {
    events.push({ kind: "edit", patch, active: options.active });
    if (options.editMode === "sync") throw new Error("Host refused layout synchronously");
    if (options.editMode === "async")
      return Promise.reject(new Error("Host refused layout asynchronously"));
    return edit(patch);
  };
  return (
    <main style={{ margin: 0, maxWidth: "100%" }}>
      <h1 style={{ fontSize: 20 }}>C4 layout contract</h1>
      {model && options.mounted && (
        <VisualModelView
          model={model}
          c4Layout={runner}
          height={900}
          active={options.active}
          onEdit={options.readOnly ? undefined : onEdit}
          onReady={(identity) =>
            events.push({ kind: "ready", active: options.active, ...identity })
          }
          onError={(message) => events.push({ kind: "error", message, active: options.active })}
        />
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
  .then(() =>
    createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  );
