import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createModel,
  createVisualRegistry,
  editModel,
  VISUAL_FAMILIES,
  type VisualTarget,
} from "@ponchia/visual-models";
import {
  VisualModelView,
  createVisualViewAdapters,
  type AdapterProps,
} from "@ponchia/visual-models/react";
import "@ponchia/visual-models/styles.css";

const scorecard = {
  id: "scorecard",
  label: "Scorecard",
  category: "Analysis",
  description: "Independent inspection",
  modelType: "scorecard",
  version: 1,
  environment: "dom",
  records: ["items"],
  adapters: [{ adapter: "scorecard", capabilities: ["select", "edit"] }],
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,127}$" },
            label: { type: "string", minLength: 1, maxLength: 100 },
          },
          required: ["id", "label"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
  collections: { items: { search: ["label"] } },
} as const;
const registry = createVisualRegistry([...VISUAL_FAMILIES, scorecard]);
const viewAdapters = createVisualViewAdapters([
  { id: "scorecard", load: () => import("./scorecard.tsx") },
]);
function DiagramOverride(props: AdapterProps) {
  return (
    <output data-testid="diagram-override">
      Host diagram override · revision {props.model.revision}
    </output>
  );
}
const overrideAdapters = createVisualViewAdapters([
  { id: "scorecard", load: () => import("./scorecard.tsx") },
  { id: "diagram", component: DiagramOverride },
]);

function App() {
  const [view, setView] = useState<"diagram" | "scorecard">("diagram");
  const [mode, setMode] = useState<"none" | "custom" | "override">("none");
  const [readonly, setReadonly] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const [selected, setSelected] = useState<VisualTarget | null>(null);
  const [graph, setGraph] = useState(() =>
    createModel({
      id: "graph",
      title: "Schema-backed diagram",
      renderer: "diagram",
      content: {
        nodes: [
          {
            id: "api",
            label: "API",
            description: "Receives requests",
            x: 0,
            y: 0,
            shape: "database",
            tone: "info",
          },
          { id: "db", label: "Storage", x: 280, y: 0, shape: "queue", tone: "success" },
        ],
        edges: [
          {
            id: "ab",
            label: "writes",
            source: "api",
            target: "db",
            line: "dashed",
            tone: "warning",
          },
        ],
      },
    }),
  );
  const [report, setReport] = useState(() =>
    createModel(
      {
        id: "score",
        title: "External score",
        renderer: "scorecard",
        content: { items: [{ id: "quality", label: "Needs review" }] },
      },
      {},
      registry,
    ),
  );
  const model = view === "diagram" ? graph : report;
  return (
    <main>
      <h1>External visualization consumer</h1>
      <nav aria-label="Fixture controls">
        <button
          onClick={() => {
            setView("diagram");
            setSelected(null);
          }}
        >
          Open diagram
        </button>
        <button
          onClick={() => {
            setView("scorecard");
            setSelected(null);
          }}
        >
          Open scorecard
        </button>
        <button onClick={() => setMode("custom")}>Enable custom adapters</button>
        <button onClick={() => setMode("none")}>Disable custom adapters</button>
        <button onClick={() => setMode("override")}>Override diagram adapter</button>
        <button onClick={() => setReadonly(!readonly)}>Toggle read-only</button>
        <button onClick={() => setRefuse(!refuse)}>Toggle edit refusal</button>
      </nav>
      <p data-testid="module-loaded">{window.scorecardModuleEvaluated ? "loaded" : "not loaded"}</p>
      <p data-testid="revision">Revision {model.revision}</p>
      <VisualModelView
        model={model}
        registry={registry}
        viewAdapters={
          mode === "none" ? undefined : mode === "override" ? overrideAdapters : viewAdapters
        }
        selected={selected}
        onSelect={setSelected}
        height={520}
        onEdit={
          readonly
            ? undefined
            : async (patch) => {
                if (refuse) throw new Error("Host refused the update");
                if (view === "diagram")
                  setGraph((current) => editModel(current, patch, {}, registry).model);
                else setReport((current) => editModel(current, patch, {}, registry).model);
              }
        }
      />
      <pre data-testid="saved-model">{JSON.stringify(model.content)}</pre>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
