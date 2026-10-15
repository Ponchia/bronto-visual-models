import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MemoryModelStore,
  type ModelCommand,
  type VisualTarget,
  type CommandResult,
  type ModelEdit,
  type CommandPreview,
  modelTargets,
} from "@ponchia/visual-models";
import { VisualModelView, useVisualModel } from "@ponchia/visual-models/react";
import "@ponchia/visual-models/styles.css";
import "./style.css";

const architecture = {
  id: "architecture",
  title: "Order service",
  renderer: "diagram",
  content: {
    nodes: [
      { id: "client", label: "Client", x: 0, y: 95 },
      { id: "api", label: "Orders API", x: 300, y: 95 },
      { id: "database", label: "Postgres", x: 610, y: 0 },
      { id: "queue", label: "Event queue", x: 610, y: 190 },
    ],
    edges: [
      { id: "request", source: "client", target: "api", label: "requests" },
      { id: "persist", source: "api", target: "database", label: "persists" },
      { id: "publish", source: "api", target: "queue", label: "publishes" },
    ],
  },
};
const milestone = {
  id: "delivery",
  title: "Delivery timeline",
  renderer: "timeline",
  content: {
    lanes: [
      { id: "design", label: "Design" },
      { id: "build", label: "Build" },
    ],
    events: [
      {
        id: "review",
        label: "Contract review",
        lane: "design",
        start: Date.UTC(2026, 9, 14, 9),
        end: Date.UTC(2026, 9, 15, 12),
        entityId: "api",
      },
      {
        id: "implement",
        label: "Service integration",
        lane: "build",
        start: Date.UTC(2026, 9, 15, 12),
        end: Date.UTC(2026, 9, 18, 12),
        entityId: "api",
      },
      { id: "release", label: "Beta release", lane: "build", start: Date.UTC(2026, 9, 19, 12) },
    ],
  },
};
function App() {
  const [store] = useState(() => new MemoryModelStore());
  const sequence = useRef(0);
  const model = useVisualModel(store, "architecture");
  const timeline = useVisualModel(store, "delivery");
  const [proposal, setProposal] = useState<{
    command: ModelCommand;
    preview: CommandPreview;
    layout?: boolean;
  } | null>(null);
  const [layoutDirection, setLayoutDirection] = useState<"RIGHT" | "DOWN">("RIGHT");
  const [arranging, setArranging] = useState(false);
  const layoutRequest = useRef<AbortController | null>(null);
  useEffect(() => () => layoutRequest.current?.abort(), []);
  const [redo, setRedo] = useState<string | null>(null);
  const [projection, setProjection] = useState("diagram");
  const [selected, setSelected] = useState<VisualTarget | null>(null);
  const [selectedTime, setSelectedTime] = useState<VisualTarget | null>(null);
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState("Opening the example…");
  const [receipts, setReceipts] = useState<CommandResult[]>([]);
  const [lastCommand, setLastCommand] = useState<ModelCommand | null>(null);
  const [lastEdit, setLastEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState("");
  const key = (name: string) => `${name}-${++sequence.current}`;
  useEffect(() => {
    let disposed = false;
    void (async () => {
      await store.execute(
        { type: "create", key: "initial-architecture", model: architecture },
        { actor: "demo" },
      );
      await store.execute(
        { type: "create", key: "initial-delivery", model: milestone },
        { actor: "demo" },
      );
      if (!disposed) {
        setStatus("Ready. Drag a node, edit a label, or try an agent operation.");
      }
    })().catch((error) => setStatus(error.message));
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    const row = (model?.content[selected?.collection ?? ""] as any[] | undefined)?.find(
      (item) => item.id === selected?.elementId,
    );
    setLabel(row?.label ?? "");
  }, [model, selected]);
  const execute = async (command: ModelCommand) => {
    setBusy(true);
    try {
      const result = await store.execute(command, { actor: "demo" });
      setReceipts((current) => [result, ...current].slice(0, 5));
      setLastCommand(command);
      if (!result.replayed && command.type !== "create" && command.id === "architecture") {
        if (command.type === "edit") {
          setLastEdit(command.key);
          setRedo(null);
        }
        if (command.type === "undo") {
          if (command.operation === redo) {
            setLastEdit(command.key);
            setRedo(null);
          } else {
            setLastEdit(null);
            setRedo(command.key);
          }
        }
      }
      setStatus(
        result.replayed
          ? `Replayed ${command.key}. No second edit was applied.`
          : `Committed ${command.type} · revision ${result.receipt.revision}.`,
      );
      return result;
    } catch (error) {
      setStatus(`Refused: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      setBusy(false);
    }
  };
  const edit = (patch: ModelEdit) =>
    execute({ type: "edit", id: "architecture", key: key("manual"), patch });
  const run = (command: ModelCommand) => {
    void execute(command).catch(() => {});
  };
  const agentCommand = (): ModelCommand => {
    const row = (store.get("architecture")!.content.nodes as any[]).find(
      (item) => item.id === "api",
    );
    return {
      type: "edit",
      id: "architecture",
      key: key("agent"),
      patch: {
        items: [
          {
            field: "nodes",
            set: [
              {
                id: "api",
                label: row.label === "Orders API" ? "Orders service" : "Orders API",
                expect: { label: row.label },
              },
            ],
          },
        ],
      },
    };
  };
  const previewAgent = async () => {
    setBusy(true);
    try {
      const command = agentCommand();
      const preview = await store.preview(command, { actor: "demo" });
      setProposal({ command, preview });
      setStatus(`Preview ready at revision ${preview.base?.revision}. Nothing committed.`);
    } catch (error) {
      setStatus(`Preview refused: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const previewLayout = async () => {
    const controller = new AbortController();
    layoutRequest.current?.abort();
    layoutRequest.current = controller;
    setBusy(true);
    setArranging(true);
    try {
      const { computeDiagramLayout } = await import("./layout.ts");
      const layout = await computeDiagramLayout(
        store.get("architecture")!,
        { direction: layoutDirection },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const command: ModelCommand = {
        type: "edit",
        key: key("layout"),
        id: "architecture",
        patch: layout.patch,
      };
      const preview = await store.preview(command, { actor: "demo" });
      controller.signal.throwIfAborted();
      setProposal({ command, preview, layout: true });
      setProjection("diagram");
      setStatus(
        `Layout preview: ${layout.nodeCount} nodes, ${layout.edgeCount} unchanged relationships. Nothing saved.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (layoutRequest.current === controller) {
        layoutRequest.current = null;
        setArranging(false);
        setBusy(false);
      }
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(model, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "architecture.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="https://github.com/Ponchia/bronto-visual-models">
          <span className="brand-mark" aria-hidden="true">
            b.
          </span>
          bronto<span className="brand-detail">visual models</span>
        </a>
        <nav>
          <a href="https://github.com/Ponchia/bronto-visual-models#readme">Documentation ↗</a>
          <a href="https://github.com/Ponchia/bronto-visual-models">GitHub ↗</a>
        </nav>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">A library in the Bronto family · beta</p>
          <h1>
            One model.
            <br />
            <em>Several ways to see it.</em>
          </h1>
          <p className="intro">
            Keep visual content editable by people and agents. Change a view without losing the
            meaning, identity or history of what it shows.
          </p>
        </div>
        <aside className="hero-note">
          <code>@ponchia/visual-models</code>
          <p>
            Typed models and guarded operations.
            <br />
            Optional React renderers.
            <br />
            Your application stays in control.
          </p>
          <a href="https://github.com/Ponchia/bronto-visual-models/releases">
            Get the beta package →
          </a>
        </aside>
      </section>
      <div className="demo-heading">
        <h2>Try the shared model</h2>
        <span className="local-badge">● Runs locally in this tab</span>
      </div>
      <section className="workspace">
        <div className="model-column">
          <div className="primary-panel">
            <div className="panel-header">
              <div>
                <span className="small-label">Architecture</span>
                <h3>Order service</h3>
              </div>
              <div className="tabs" aria-label="Model representation">
                {["diagram", "network", "matrix"].map((view) => (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={projection === view}
                    onClick={() => {
                      setReady("");
                      setProjection(view);
                    }}
                  >
                    {view[0].toUpperCase() + view.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {model ? (
              <VisualModelView
                key={proposal?.layout ? "layout-preview" : "saved-model"}
                model={proposal?.layout ? proposal.preview.model : model}
                projection={projection}
                selected={selected}
                onSelect={setSelected}
                onEdit={proposal?.layout ? undefined : edit}
                height={430}
                onReady={(identity) => setReady(identity.projection)}
              />
            ) : (
              <div className="loading">Loading model…</div>
            )}
            <div className="model-footer">
              <span>Pan to explore · use Fit for an overview</span>
              <code data-testid="revision">rev {model?.revision ?? "—"}</code>
              <span className="sr-only" data-testid="renderer-ready">
                {ready}
              </span>
            </div>
          </div>
          <div className="timeline-panel">
            <div className="panel-header">
              <div>
                <span className="small-label">A different model family</span>
                <h3>Delivery timeline</h3>
              </div>
              <span className="subtle">Drag an event to reschedule</span>
            </div>
            {timeline && (
              <VisualModelView
                model={timeline}
                selected={selectedTime}
                onSelect={setSelectedTime}
                onEdit={(patch) =>
                  execute({ type: "edit", id: "delivery", key: key("time"), patch })
                }
                height={255}
              />
            )}
          </div>
        </div>
        <div className="control-column">
          <aside className="inspector">
            <p className="small-label">Human + agent edits</p>
            <h3>A change, not a replacement</h3>
            <p>Move a node first. The agent’s label edit will preserve your layout.</p>
            <div className="actions">
              <button disabled={!model || busy} onClick={() => void previewAgent()}>
                Preview agent edit
              </button>
              <button
                className="primary"
                disabled={!model || busy}
                onClick={() => run(agentCommand())}
              >
                Apply agent edit
              </button>
              <button
                disabled={!lastCommand || busy}
                onClick={() => lastCommand && run(lastCommand)}
              >
                Retry last operation
              </button>
              <button
                disabled={!lastEdit || busy}
                onClick={() =>
                  lastEdit &&
                  run({ type: "undo", key: key("undo"), id: "architecture", operation: lastEdit })
                }
              >
                Undo last edit
              </button>
              <button
                disabled={!redo || busy}
                onClick={() =>
                  redo &&
                  run({ type: "undo", key: key("redo"), id: "architecture", operation: redo })
                }
              >
                Redo last edit
              </button>
              <button
                disabled={!model || busy}
                onClick={() =>
                  run({
                    type: "edit",
                    key: key("stale"),
                    id: "architecture",
                    patch: {
                      items: [
                        {
                          field: "nodes",
                          set: [
                            {
                              id: "api",
                              label: "Overwritten",
                              expect: { label: "A value from an outdated read" },
                            },
                          ],
                        },
                      ],
                    },
                  })
                }
              >
                Try a stale edit
              </button>
            </div>
            <div className="layout-actions" role="group" aria-label="Diagram layout">
              <label htmlFor="layout-direction">Arrange the diagram</label>
              <select
                id="layout-direction"
                value={layoutDirection}
                disabled={busy}
                onChange={(event) => setLayoutDirection(event.target.value as "RIGHT" | "DOWN")}
              >
                <option value="RIGHT">Left to right</option>
                <option value="DOWN">Top to bottom</option>
              </select>
              <button disabled={!model || busy} onClick={() => void previewLayout()}>
                Preview layout
              </button>
              {arranging && (
                <button onClick={() => layoutRequest.current?.abort()}>Cancel layout</button>
              )}
              <p>Computed in a local worker. Preview first; save only after review.</p>
            </div>
            {proposal && (
              <section className="proposal" aria-label="Proposed changes">
                <h4>
                  {proposal.layout ? "Proposed layout — not saved" : "Review before committing"}
                </h4>
                <p>
                  Based on revision {proposal.preview.base?.revision}; saved model stays at revision{" "}
                  {model?.revision}.
                </p>
                <ul>
                  {proposal.preview.changes.map((change, index) => (
                    <li key={index}>
                      {change.change}: {change.collection}
                      {change.id ? ` / ${change.id}` : ""}
                      {change.fields?.length ? ` (${change.fields.join(", ")})` : ""}
                    </li>
                  ))}
                </ul>
                <details>
                  <summary>Inspect command JSON</summary>
                  <pre>{JSON.stringify(proposal.command, null, 2)}</pre>
                </details>
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      void execute(proposal.command)
                        .then(() => setProposal(null))
                        .catch(() => {});
                    }}
                  >
                    Apply preview
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setProposal(null);
                      setStatus("Preview discarded. Nothing committed.");
                    }}
                  >
                    Discard preview
                  </button>
                </div>
                <p>Applying rechecks the saved state. A preview is not a reserved edit.</p>
              </section>
            )}
            <div className="label-editor">
              <label htmlFor="element-choice">Choose an element</label>
              <select
                id="element-choice"
                value={selected ? `${selected.collection}:${selected.elementId}` : ""}
                disabled={!model || busy}
                onChange={(event) =>
                  setSelected(
                    modelTargets(model!).find(
                      (target) => `${target.collection}:${target.elementId}` === event.target.value,
                    ) ?? null,
                  )
                }
              >
                <option value="">No element selected</option>
                {model &&
                  modelTargets(model).map((target) => (
                    <option
                      key={`${target.collection}:${target.elementId}`}
                      value={`${target.collection}:${target.elementId}`}
                    >
                      {target.collection === "nodes" ? "Node" : "Relationship"}: {target.label}
                    </option>
                  ))}
              </select>
              <label htmlFor="label">
                {selected
                  ? `Selected ${selected.collection?.slice(0, -1) ?? "element"}: ${selected.elementId}`
                  : "Select a node or relationship"}
              </label>
              <input
                id="label"
                value={label}
                disabled={!selected || busy}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Edit its label"
              />
              <button
                disabled={!selected || !label.trim() || busy}
                onClick={() => {
                  const row = (model!.content[selected!.collection!] as any[]).find(
                    (entry) => entry.id === selected!.elementId,
                  );
                  void edit({
                    generation: model!.generation,
                    items: [
                      {
                        field: selected!.collection!,
                        set: [{ id: row.id, label, expect: { label: row.label } }],
                      },
                    ],
                  }).catch(() => {});
                }}
              >
                Save label
              </button>
            </div>
            <p className="status" role="status" data-testid="operation-status">
              {status}
            </p>
          </aside>
          <div className="receipt-panel">
            <p className="small-label">Observable outcomes</p>
            <h3>Operation receipts</h3>
            {!receipts.length ? (
              <p className="empty">
                Your first change will appear here with its operation key and resulting revision.
              </p>
            ) : (
              <ol>
                {receipts.map((result, index) => (
                  <li key={`${index}:${result.receipt.key}`}>
                    <code>{result.receipt.key}</code>
                    <span>
                      {result.replayed ? "replayed" : "committed"} · rev {result.receipt.revision}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <button className="text-button" disabled={!model} onClick={download}>
              Export model JSON ↓
            </button>
            <p className="fine-print">
              Agent buttons run deterministic example commands, not an AI service. Exports contain
              authored data, not external datasets, assets or renderer binaries. This demo resets on
              reload.
            </p>
          </div>
        </div>
      </section>
      <section className="principles">
        <article>
          <span>01</span>
          <h3>Content has its own identity</h3>
          <p>
            A visual model is not a screenshot or a node on a particular canvas. Its elements can be
            inspected and referenced across representations.
          </p>
        </article>
        <article>
          <span>02</span>
          <h3>Edits state what they expect</h3>
          <p>
            Field-level preconditions protect against stale writes. Repeated operation keys recover
            a receipt instead of applying a change twice.
          </p>
        </article>
        <article>
          <span>03</span>
          <h3>Your host owns the boundaries</h3>
          <p>
            Bring your storage, authorization and connected data. The library does not open an
            account, fetch a dataset or grant itself access.
          </p>
        </article>
      </section>
      <footer>
        <span>Bronto Visual Models · MIT · Zeno Trevisan</span>
        <a href="https://github.com/Ponchia/bronto-visual-models/issues">Feedback & issues ↗</a>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
