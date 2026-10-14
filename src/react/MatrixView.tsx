import { useEffect, useMemo, useRef } from "react";
import { parse, View } from "vega";
import type { GraphContent } from "../semantic.ts";
import { modelTargets } from "../targets.ts";
import { graphMatrix, matrixData, matrixSpec } from "../render/graph-matrix.ts";
import { useVegaSurface } from "../engines/vega-surface.ts";
import type { AdapterProps } from "./types.ts";
export default function MatrixView(props: AdapterProps) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useMemo(
    () => graphMatrix(props.model.content as unknown as GraphContent, "", "authored"),
    [props.model.content],
  );
  const targets = useMemo(
    () => modelTargets(props.model, props.registry),
    [props.model, props.registry],
  );
  const surface = useVegaSurface(container, {
    identity: "dependency-matrix-v1",
    active: props.active !== false,
    tokens: props.tokens,
    data: {
      key: `${props.model.generation}:${props.model.revision}`,
      sized: true,
      sets: (size) => matrixData(graph, size.width),
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
      return view;
    },
    onReady: props.ready,
    onError: props.report,
  });
  useEffect(() => {
    if (!surface.view) return;
    const clicked = (_event: unknown, item: any) => {
      const ids = item?.datum?.ids;
      const id =
        Array.isArray(ids) && ids.length === 1
          ? ids[0]
          : item?.datum?.collection === "nodes"
            ? item.datum.id
            : undefined;
      if (!id) return;
      props.onSelect?.(
        targets.find(
          (target) => target.elementId === id && target.collection === (ids ? "edges" : "nodes"),
        ) ?? null,
      );
    };
    surface.view.addEventListener("click", clicked);
    return () => {
      surface.view?.removeEventListener("click", clicked);
    };
  }, [surface.view, targets, props.onSelect]);
  useEffect(() => {
    void surface.run((view) => {
      view.signal(
        "selected",
        props.selected?.collection === "edges" ? props.selected.elementId : "",
      );
      view.signal(
        "selectedNode",
        props.selected?.collection === "nodes" ? props.selected.elementId : "",
      );
    });
  }, [surface.run, props.selected]);
  return (
    <div className="bvm-matrix">
      <div className="bvm-engine" ref={container} />
      <label className="bvm-matrix-choice">
        Relationship{" "}
        <select
          aria-label="Matrix relationship"
          value={props.selected?.collection === "edges" ? props.selected.elementId : ""}
          onChange={(event) =>
            props.onSelect?.(
              targets.find(
                (target) =>
                  target.collection === "edges" && target.elementId === event.target.value,
              ) ?? null,
            )
          }
        >
          <option value="">Choose an identified relationship</option>
          {targets
            .filter((target) => target.collection === "edges")
            .map((target) => (
              <option key={target.elementId} value={target.elementId}>
                {target.label}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}
