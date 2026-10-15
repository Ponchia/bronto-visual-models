import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createModel, editModel, type VisualTarget } from "@ponchia/visual-models";
import { GanttModelView } from "@ponchia/visual-models/react/gantt";
import "@ponchia/visual-models/base.css";
function App() {
  const [model, setModel] = useState(() =>
    createModel({ id: "native", title: "Native release plan", template: "gantt" }),
  );
  const [selected, select] = useState<VisualTarget | null>(null);
  return (
    <main style={{ maxWidth: 800, margin: "auto" }}>
      <h1>Native Gantt consumer</h1>
      <GanttModelView
        model={model}
        selected={selected}
        onSelect={select}
        onEdit={async (patch) => setModel((current) => editModel(current, patch).model)}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
