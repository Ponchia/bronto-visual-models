import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createModel, editModel, type ModelEdit } from "@ponchia/visual-models";
import { VisualModelView } from "@ponchia/visual-models/react";
import { layoutDiagram } from "@ponchia/visual-models/layout/elk";
import type { DiagramRouting } from "@ponchia/visual-models/render/diagram-routing";
import "@ponchia/visual-models/styles.css";
function App() {
  const [model, setModel] = useState(() =>
    createModel({
      id: "route-demo",
      title: "Routed group diagram",
      renderer: "diagram",
      content: {
        nodes: [
          {
            id: "group",
            group: true,
            label: "System boundary",
            x: 0,
            y: 0,
            width: 450,
            height: 250,
          },
          { id: "a", label: "Entry component", parentId: "group", x: 24, y: 68 },
          { id: "b", label: "Processing component", parentId: "group", x: 230, y: 68 },
          { id: "c", label: "External store", x: 600, y: 0 },
          { id: "d", label: "Remote observer", x: 600, y: 150 },
        ],
        edges: [
          { id: "ab", source: "a", target: "b", label: "sends the initial request" },
          {
            id: "ab2",
            source: "a",
            target: "b",
            label:
              "sends a different independent request with a deliberately long relationship label that remains fully available in the reading list",
          },
          { id: "bc", source: "b", target: "c", label: "persists the result" },
          { id: "bd", source: "b", target: "d", label: "announces completion" },
          { id: "bb", source: "b", target: "b", label: "retries locally" },
        ],
      },
    }),
  );
  const [routing, setRouting] = useState<DiagramRouting>();
  const [message, setMessage] = useState("Not arranged");
  const apply = (patch: ModelEdit) => setModel((current) => editModel(current, patch).model);
  const arrange = async () => {
    try {
      const p = await layoutDiagram(model);
      setModel((current) => editModel(current, p.patch).model);
      setRouting(p.routing);
      setMessage("Arranged");
    } catch (e) {
      setMessage(String(e));
    }
  };
  return (
    <main style={{ maxWidth: 1100, margin: "20px auto", padding: 12 }}>
      <h1>Routed diagram contract</h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button onClick={() => void arrange()}>Arrange</button>
        <button onClick={() => apply({ title: "A new document title" })}>Rename title</button>
        <button
          onClick={() =>
            apply({
              items: [
                {
                  field: "nodes",
                  set: [
                    {
                      id: "d",
                      x: Number((model.content.nodes as any[]).find((n) => n.id === "d").x) + 100,
                    },
                  ],
                },
              ],
            })
          }
        >
          Move remote node
        </button>
        <button
          onClick={() =>
            apply({
              ifRevision: model.revision,
              items: [
                {
                  field: "nodes",
                  replace: ["a"],
                  set: [{ id: "a", label: "New entry", parentId: "group" }],
                },
              ],
            })
          }
        >
          Replace entry
        </button>
      </div>
      <output data-testid="state">{message}</output>
      <output data-testid="revision">{model.revision}</output>
      <VisualModelView
        model={model}
        diagramRouting={routing}
        height={550}
        onEdit={async (patch) => apply(patch)}
        onError={setMessage}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
