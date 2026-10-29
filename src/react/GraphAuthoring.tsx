import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  GRAPH_EDGE_LINES,
  GRAPH_SHAPES,
  GRAPH_TONES,
  type GraphContent,
  type GraphEdge,
  type GraphNode,
} from "../semantic.ts";
import type { VisualModel, VisualTarget } from "../model.ts";
import type { ModelEdit } from "../operations.ts";

type Commit = (patch: ModelEdit) => Promise<unknown>;
type Editable = {
  label: string;
  description: string;
  tone: string;
  shape?: string;
  line?: string;
};
const fieldsOf = (record: GraphNode | GraphEdge, collection: "nodes" | "edges"): Editable => ({
  label: record.label,
  description: record.description ?? "",
  tone: record.tone ?? "neutral",
  ...(collection === "nodes"
    ? { shape: (record as GraphNode).shape ?? "rounded" }
    : { line: (record as GraphEdge).line ?? "solid" }),
});

function ItemEditor({
  model,
  collection,
  item,
  onEdit,
  report,
}: {
  model: VisualModel;
  collection: "nodes" | "edges";
  item: GraphNode | GraphEdge;
  onEdit: Commit;
  report(message: string): void;
}) {
  // The draft's base is captured at selection time. An unrelated host edit
  // must not wipe what the person is typing; a conflicting field refuses.
  const [base, setBase] = useState(() => item);
  const [draft, setDraft] = useState<Editable>(() => fieldsOf(item, collection));
  const [pending, setPending] = useState(false);
  const [awaitingModel, setAwaitingModel] = useState(false);
  const submitted = useRef<Record<string, unknown> | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (submitted.current) {
      // A resolved callback alone never proves a commit. Rebase only after
      // the controlled host model actually contains every submitted field.
      if (
        Object.entries(submitted.current).every(
          ([field, value]) => (item as unknown as Record<string, unknown>)[field] === value,
        )
      ) {
        submitted.current = null;
        setAwaitingModel(false);
        setBase(item);
        setDraft(fieldsOf(item, collection));
        setNotice("Saved in the current model");
      }
    } else if (
      item !== base &&
      Object.entries(fieldsOf(base, collection)).every(
        ([field, value]) => draft[field as keyof Editable] === value,
      )
    ) {
      // A clean inspector follows host revisions. Dirty drafts preserve the
      // original expect values until the person explicitly reloads.
      setBase(item);
      setDraft(fieldsOf(item, collection));
    }
    // React effects observe host-supplied record changes, not the state they
    // themselves rebase. Including draft/base would retrigger an unchanged
    // controlled model indefinitely.
  }, [item, collection]);
  const update = (field: keyof Editable, value: string) =>
    setDraft((previous) => ({ ...previous, [field]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || awaitingModel) return;
    const changes = Object.fromEntries(
      Object.entries(draft).filter(
        ([field, value]) => value !== fieldsOf(base, collection)[field as keyof Editable],
      ),
    );
    if (!Object.keys(changes).length) {
      setNotice("No changes to save");
      return;
    }
    const expect = Object.fromEntries(
      Object.keys(changes).map((field) => [
        field,
        (base as unknown as Record<string, unknown>)[field] ?? null,
      ]),
    );
    setPending(true);
    setAwaitingModel(true);
    submitted.current = changes;
    setNotice("");
    try {
      await onEdit({
        generation: model.generation,
        items: [{ field: collection, set: [{ id: item.id, ...changes, expect }] }],
      });
      if (submitted.current) setNotice("Edit submitted; awaiting updated model");
    } catch (error) {
      submitted.current = null;
      setAwaitingModel(false);
      const message = error instanceof Error ? error.message : String(error);
      report(message);
      setNotice("Edit refused; reload the fields or revise your changes");
    } finally {
      setPending(false);
    }
  };
  const reload = () => {
    submitted.current = null;
    setAwaitingModel(false);
    setBase(item);
    setDraft(fieldsOf(item, collection));
    setNotice("Fields reloaded from the current model");
  };
  return (
    <form className="bvm-graph-item-editor" onSubmit={(event) => void save(event)}>
      <strong>
        {collection === "nodes" ? "Node" : "Relationship"}: {item.id}
      </strong>
      <label>
        Label
        <input
          aria-label="Diagram item label"
          value={draft.label}
          maxLength={240}
          onChange={(event) => update("label", event.target.value)}
          required
          disabled={pending || awaitingModel}
        />
      </label>
      <label>
        Description
        <textarea
          aria-label="Diagram item description"
          value={draft.description}
          maxLength={4000}
          rows={2}
          disabled={pending || awaitingModel}
          onChange={(event) => update("description", event.target.value)}
        />
      </label>
      <label>
        Color
        <select
          aria-label="Diagram item color"
          value={draft.tone}
          disabled={pending || awaitingModel}
          onChange={(event) => update("tone", event.target.value)}
        >
          {GRAPH_TONES.map((tone) => (
            <option key={tone} value={tone}>
              {tone}
            </option>
          ))}
        </select>
      </label>
      {collection === "nodes" ? (
        <label>
          Shape
          <select
            aria-label="Diagram node shape"
            value={draft.shape}
            disabled={pending || awaitingModel}
            onChange={(event) => update("shape", event.target.value)}
          >
            {GRAPH_SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {shape}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Line
          <select
            aria-label="Diagram edge line"
            value={draft.line}
            disabled={pending || awaitingModel}
            onChange={(event) => update("line", event.target.value)}
          >
            {GRAPH_EDGE_LINES.map((line) => (
              <option key={line} value={line}>
                {line}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="bvm-graph-authoring-buttons">
        <button type="submit" disabled={pending || awaitingModel}>
          {pending
            ? "Saving…"
            : awaitingModel
              ? "Awaiting saved model"
              : "Apply diagram appearance"}
        </button>
        <button type="button" disabled={pending} onClick={reload}>
          Reload fields
        </button>
      </div>
      {notice && <span role="status">{notice}</span>}
    </form>
  );
}

/**
 * Portable diagram authoring: no app routes, persistence, access grants or
 * optimistic mutation. All writes cross the same controlled onEdit boundary.
 */
export default function GraphAuthoring({
  model,
  selected,
  onEdit,
  report,
  newNodePosition,
}: {
  model: VisualModel;
  selected: VisualTarget | null;
  onEdit: Commit;
  report(message: string): void;
  newNodePosition(): { x: number; y: number };
}) {
  const content = model.content as unknown as GraphContent;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [relationLabel, setRelationLabel] = useState("relates to");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const source = content.nodes.some((node) => node.id === from) ? from : content.nodes[0]?.id;
  const target = content.nodes.some((node) => node.id === to)
    ? to
    : (content.nodes[1]?.id ?? source);
  const current =
    selected?.collection === "nodes"
      ? content.nodes.find((node) => node.id === selected.elementId)
      : selected?.collection === "edges"
        ? content.edges.find((edge) => edge.id === selected.elementId)
        : undefined;
  const collection =
    selected?.collection === "nodes" || selected?.collection === "edges"
      ? selected.collection
      : undefined;
  const submit = async (field: "nodes" | "edges", record: Record<string, unknown>) => {
    if (pending) return;
    setPending(true);
    setNotice("");
    try {
      await onEdit({
        generation: model.generation,
        ifRevision: model.revision,
        items: [
          {
            field,
            set: [
              { ...record, id: `${field === "nodes" ? "node" : "edge"}-${crypto.randomUUID()}` },
            ],
          },
        ],
      });
      setNotice("Addition submitted to the host");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report(message);
      setNotice("Addition refused; inspect the latest model");
    } finally {
      setPending(false);
    }
  };
  return (
    <details className="bvm-graph-authoring">
      <summary>Author diagram</summary>
      <div className="bvm-graph-authoring-content">
        <button
          type="button"
          disabled={pending}
          onClick={() => void submit("nodes", { label: "New entity", ...newNodePosition() })}
        >
          Add diagram node
        </button>
        {content.nodes.length >= 2 && (
          <form
            className="bvm-graph-link-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (source && target && relationLabel.trim())
                void submit("edges", { label: relationLabel.trim(), source, target });
            }}
          >
            <label>
              From
              <select
                aria-label="Diagram link from"
                value={source}
                onChange={(event) => setFrom(event.target.value)}
              >
                {content.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              To
              <select
                aria-label="Diagram link to"
                value={target}
                onChange={(event) => setTo(event.target.value)}
              >
                {content.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Label
              <input
                aria-label="Diagram link label"
                value={relationLabel}
                maxLength={240}
                onChange={(event) => setRelationLabel(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={pending}>
              Add diagram link
            </button>
          </form>
        )}
        {collection && current ? (
          <ItemEditor
            key={`${model.id}:${model.generation}:${selected?.incarnation}:${collection}:${current.id}`}
            model={model}
            collection={collection}
            item={current}
            onEdit={onEdit}
            report={report}
          />
        ) : (
          <p>Select a node or relationship to edit its label, description and appearance.</p>
        )}
        {notice && <span role="status">{notice}</span>}
      </div>
    </details>
  );
}
