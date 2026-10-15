import { useEffect, useId, useMemo, useRef, useState } from "react";
import { parse, View } from "vega";
import type { GraphContent } from "../semantic.ts";
import { modelTargets } from "../targets.ts";
import { graphMatrix, matrixData, matrixSpec, type MatrixOrder } from "../render/graph-matrix.ts";
import { useVegaSurface } from "../engines/vega-surface.ts";
import type { AdapterProps } from "./types.ts";

export default function MatrixView(props: AdapterProps) {
  const container = useRef<HTMLDivElement>(null);
  const id = useId();
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<MatrixOrder>("authored");
  const content = props.model.content as unknown as GraphContent;
  const graph = useMemo(() => graphMatrix(content, query, order), [content, query, order]);
  const [fontEpoch, setFontEpoch] = useState(0);
  useEffect(() => {
    let live = true;
    const update = () => {
      if (live) setFontEpoch((value) => value + 1);
    };
    void document.fonts?.ready.then(update);
    document.fonts?.addEventListener("loadingdone", update);
    return () => {
      live = false;
      document.fonts?.removeEventListener("loadingdone", update);
    };
  }, []);
  const labelWidth = useMemo(() => {
    const canvas = typeof document === "undefined" ? null : document.createElement("canvas");
    const context = canvas?.getContext("2d");
    if (!context) return undefined;
    context.font = `12px ${props.tokens.sans}`;
    return Math.max(0, ...graph.nodes.map((node) => context.measureText(node.label).width));
  }, [graph, props.tokens.sans, fontEpoch]);
  const targets = useMemo(
    () => modelTargets(props.model, props.registry),
    [props.model, props.registry],
  );
  const targetsById = useMemo(
    () => new Map(targets.map((t) => [`${t.collection}:${t.elementId}`, t])),
    [targets],
  );
  const [cell, setCell] = useState<{ revision: number; ids: string[]; label: string } | null>(null);
  const choices = cell?.revision === props.model.revision ? cell : null;
  const surface = useVegaSurface(container, {
    identity: "dependency-matrix-v1",
    active: props.active !== false,
    tokens: props.tokens,
    data: {
      key: JSON.stringify([props.model.generation, props.model.revision, query, order, labelWidth]),
      sized: true,
      sets: (size) => matrixData(graph, size.width, labelWidth),
    },
    // The grammar's width/height depend on layout data; retain them for the
    // sparse scrollable grid rather than overwrite with the host viewport size.
    resize: (view) => {
      view.resize();
    },
    create: async ({ container: element, data, config, tooltip }) => {
      const spec = matrixSpec(props.tokens);
      spec.data = spec.data?.map((entry) => ({ ...entry, values: data[entry.name] ?? [] }));
      const view = new View(parse(spec, config("vega")), {
        renderer: "svg",
        container: element,
        loader: {
          load: async () => {
            throw new Error("This matrix does not load external data");
          },
          sanitize: async () => {
            throw new Error("External links are not enabled");
          },
        } as any,
      });
      view.tooltip(tooltip);
      view.signal(
        "selected",
        props.selected?.collection === "edges" ? props.selected.elementId : "",
      );
      view.signal(
        "selectedNode",
        props.selected?.collection === "nodes" ? props.selected.elementId : "",
      );
      return view;
    },
    onReady: props.ready,
    onError: props.report,
  });
  useEffect(() => {
    if (!surface.view || props.active === false) return;
    const clicked = (_event: unknown, item: any) => {
      const datum = item?.datum;
      if (Array.isArray(datum?.ids)) {
        const ids = datum.ids.filter(
          (id: unknown) => typeof id === "string" && targetsById.has(`edges:${id}`),
        );
        if (ids.length === 1) {
          setCell(null);
          props.onSelect?.(targetsById.get(`edges:${ids[0]}`)!);
        } else if (ids.length > 1)
          setCell({
            revision: props.model.revision,
            ids,
            label: String(datum.label ?? "Relationships"),
          });
      } else if (datum?.collection === "nodes") {
        setCell(null);
        props.onSelect?.(targetsById.get(`nodes:${datum.id}`) ?? null);
      }
    };
    surface.view.addEventListener("click", clicked);
    return () => {
      surface.view?.removeEventListener("click", clicked);
    };
  }, [surface.view, targetsById, props.onSelect, props.active, props.model.revision]);
  const selectedEdge = props.selected?.collection === "edges" ? props.selected.elementId : "";
  const selectedNode = props.selected?.collection === "nodes" ? props.selected.elementId : "";
  useEffect(() => {
    let live = true;
    if (props.active !== false)
      void surface
        .run(async (view) => {
          view.signal("selected", selectedEdge);
          view.signal("selectedNode", selectedNode);
          // Setting a Vega signal alone does not render it.
          await view.runAsync();
        })
        .then(() => {
          if (live) surface.attest();
        })
        .catch((error) => {
          if (live) props.report(error instanceof Error ? error.message : String(error));
        });
    return () => {
      live = false;
    };
  }, [
    surface.view,
    surface.run,
    surface.attest,
    selectedEdge,
    selectedNode,
    props.active,
    props.report,
  ]);
  const visibleEdgeIds = useMemo(() => new Set(graph.edges.map((edge) => edge.id)), [graph]);
  return (
    <div className="bvm-matrix">
      <details className="bvm-explore">
        <summary>Explore matrix</summary>
        <div className="bvm-explore-form">
          <label htmlFor={`${id}-filter`}>Filter matrix nodes</label>
          <input
            id={`${id}-filter`}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCell(null);
            }}
            placeholder="Node name or identifier"
          />
          <label htmlFor={`${id}-order`}>Matrix order</label>
          <select
            id={`${id}-order`}
            value={order}
            onChange={(e) => {
              setOrder(e.target.value as MatrixOrder);
              setCell(null);
            }}
          >
            <option value="authored">Authored order</option>
            <option value="label">Name</option>
            <option value="degree">Connection count</option>
          </select>
          <button
            type="button"
            disabled={!query && order === "authored"}
            onClick={() => {
              setQuery("");
              setOrder("authored");
              setCell(null);
            }}
          >
            Reset matrix view
          </button>
          <span role="status">
            {graph.nodes.length} of {content.nodes.length} nodes · {graph.edges.length} of{" "}
            {content.edges.length} relationships. Filtering and order do not edit the model.
          </span>
        </div>
      </details>
      <div className="bvm-matrix-grid">
        {!graph.nodes.length && (
          <p className="bvm-matrix-empty" role="status">
            No matching nodes. Clear the filter to restore the complete matrix.
          </p>
        )}
        <div
          className="bvm-engine"
          ref={container}
          tabIndex={0}
          role="region"
          aria-label="Scrollable dependency matrix"
        />
      </div>
      {choices && (
        <section className="bvm-matrix-choices" aria-label="Relationships in selected matrix cell">
          <p>
            {choices.label} · {choices.ids.length} relationships. Choose one explicitly.
          </p>
          <ul>
            {choices.ids.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  disabled={!props.onSelect}
                  aria-pressed={selectedEdge === id}
                  onClick={() => props.onSelect?.(targetsById.get(`edges:${id}`)!)}
                >
                  {targetsById.get(`edges:${id}`)!.label} · {id}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setCell(null)}>
            Close relationship choices
          </button>
        </section>
      )}
      <label className="bvm-matrix-choice">
        Relationship{" "}
        <select
          aria-label="Matrix relationship"
          disabled={!props.onSelect || props.active === false}
          value={visibleEdgeIds.has(selectedEdge) ? selectedEdge : ""}
          onChange={(e) => props.onSelect?.(targetsById.get(`edges:${e.target.value}`) ?? null)}
        >
          <option value="">Choose an identified relationship</option>
          {graph.edges.map((edge) => (
            <option key={edge.id} value={edge.id}>
              {edge.label} · {edge.id}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
