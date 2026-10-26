import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  applyNodeChanges,
  type ReactFlowInstance,
} from "@xyflow/react";
import { C4_KIND_LABELS, C4_VIEW_LABELS, type C4Content, type C4Position } from "../c4.ts";
import { c4ElementText, c4PositionEdit, c4Scene, C4_CARD } from "../render/c4.ts";
import { modelTargets, resolveModelTarget, targetResolves } from "../targets.ts";
import type { VisualModel, VisualTarget } from "../model.ts";
import type { AdapterProps } from "./types.ts";
import { C4Node, C4Edge, type C4FlowNode, type C4FlowEdge } from "./C4Notation.tsx";
import C4Inspector from "./C4Inspector.tsx";

const nodeTypes = { c4: C4Node };
const edgeTypes = { c4: C4Edge };
const kindIndex = { person: 0, "software-system": 1, container: 2, component: 3 };
export default function C4View(props: AdapterProps) {
  const { model, tokens } = props;
  const content = model.content as unknown as C4Content;
  const [localView, setLocalView] = useState(content.views[0]?.id ?? "");
  const [localSelected, setLocalSelected] = useState<VisualTarget | null>(null);
  const [query, setQuery] = useState("");
  const canvas = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const writing = useRef(false);
  const [flow, setFlow] = useState<ReactFlowInstance<C4FlowNode, C4FlowEdge> | null>(null);
  const viewId =
    props.c4ViewId ??
    (content.views.some((v) => v.id === localView) ? localView : content.views[0]?.id);
  const view = content.views.find((v) => v.id === viewId);
  const scene = useMemo(() => (view ? c4Scene(content, view.id) : undefined), [content, view]);
  const targets = useMemo(
    () =>
      new Map(
        modelTargets(model, props.registry).map((t) => [`${t.collection}:${t.elementId}`, t]),
      ),
    [model, props.registry],
  );
  const rawSelection = props.selected === undefined ? localSelected : props.selected;
  const resolution = rawSelection
    ? resolveModelTarget(model, rawSelection, undefined, props.registry)
    : null;
  const selected = resolution && targetResolves(resolution) ? resolution.current : null;
  const active = props.active !== false;
  const selectable = useRef({ props, targets, active });
  selectable.current = { props, targets, active };
  const select = useCallback((collection: string, id: string) => {
    const now = selectable.current;
    if (!now.active) return;
    const target = now.targets.get(`${collection}:${id}`) ?? null;
    setLocalSelected(target);
    now.props.onSelect?.(target);
  }, []);
  const navigate = (id: string) => {
    if (!active) return;
    if (props.c4ViewId === undefined) setLocalView(id);
    props.onC4ViewChange?.(id);
    setLocalSelected(null);
    props.onSelect?.(null);
    setQuery("");
  };
  const canNavigate = props.c4ViewId === undefined || !!props.onC4ViewChange;
  const baseNodes = useMemo((): C4FlowNode[] => {
    if (!scene) return [];
    const nodes: C4FlowNode[] = scene.elements.map(({ element, x, y }) => {
      const n = kindIndex[element.kind];
      return {
        id: element.id,
        type: "c4",
        position: { x, y },
        // These cards have fixed authored dimensions; never wait for another
        // ResizeObserver delivery after a controlled permission/state update.
        initialWidth: C4_CARD.width,
        initialHeight: C4_CARD.height,
        data: { element },
        ariaLabel: c4ElementText(element),
        draggable: !!props.onEdit && active && !pending,
        style: {
          ...C4_CARD,
          background: element.external ? tokens.panel : tokens.categoricalTint[n],
          color: element.external ? tokens.text : tokens.categoricalInk[n],
        },
      };
    });
    if (scene.boundary) {
      const b = scene.boundary;
      nodes.unshift({
        id: `:boundary:${b.element.id}`,
        type: "c4",
        position: { x: b.x, y: b.y },
        initialWidth: b.width,
        initialHeight: b.height,
        data: { element: b.element, boundary: true },
        draggable: false,
        selectable: false,
        focusable: false,
        ariaLabel: `${b.element.label} boundary`,
        zIndex: -1,
        style: { width: b.width, height: b.height, color: tokens.text, pointerEvents: "none" },
      });
    }
    return nodes;
  }, [scene, !!props.onEdit, active, pending, tokens]);
  const derived = useMemo(
    () =>
      baseNodes.map((node) => ({
        ...node,
        selected: selected?.collection === "elements" && selected.elementId === node.id,
      })),
    [baseNodes, selected?.collection, selected?.elementId],
  );
  const [nodes, setNodes] = useState<C4FlowNode[]>(derived);
  const drag = useRef<{ model: VisualModel; viewId: string; positions: C4Position[] } | null>(null);
  const latest = useRef({ props, derived, viewId, active, selected });
  latest.current = { props, derived, viewId, active, selected };
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!drag.current) setNodes(derived);
  }, [derived]);
  useEffect(() => {
    drag.current = null;
    setNodes(derived);
  }, [viewId, model.id, model.generation, active]);
  const edges = useMemo((): C4FlowEdge[] => {
    if (!scene) return [];
    const positions = new Map(scene.elements.map((e) => [e.element.id, e]));
    const groups = new Map<string, string[]>();
    for (const r of scene.relationships) {
      const key = JSON.stringify([r.source, r.target].sort());
      groups.set(key, [...(groups.get(key) ?? []), r.id]);
    }
    return scene.relationships.map((r) => {
      const source = positions.get(r.source)!,
        target = positions.get(r.target)!;
      const dx = target.x - source.x,
        dy = target.y - source.y;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const members = groups.get(JSON.stringify([r.source, r.target].sort()))!;
      const lane =
        (members.indexOf(r.id) - (members.length - 1) / 2) * 120 * (r.source < r.target ? 1 : -1);
      return {
        id: r.id,
        type: "c4",
        source: r.source,
        target: r.target,
        sourceHandle: horizontal ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top",
        targetHandle: horizontal ? (dx >= 0 ? "left" : "right") : dy >= 0 ? "top" : "bottom",
        data: {
          label: r.label,
          technology: r.technology,
          lane,
          active,
          select: () => select("relationships", r.id),
        },
        selected: selected?.collection === "relationships" && selected.elementId === r.id,
        ariaLabel: `${r.label}${r.technology ? ` · ${r.technology}` : ""}`,
        markerEnd: { type: MarkerType.ArrowClosed, color: tokens.edge },
        style: {
          stroke: tokens.edge,
          strokeWidth:
            selected?.elementId === r.id && selected.collection === "relationships" ? 3 : 1.6,
        },
      };
    });
  }, [scene, selected?.collection, selected?.elementId, tokens.edge, active, select]);
  useEffect(() => {
    if (!active || !scene || !flow) return;
    const frame = requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.2, duration: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [flow, viewId, active]);
  useEffect(() => {
    if (!active || !scene || !flow) return;
    const frame = requestAnimationFrame(props.ready);
    return () => cancelAnimationFrame(frame);
  }, [model.revision, viewId, active, flow, props.ready]);
  // Resize/inspector changes must not leave the focused architecture off-screen.
  // Only actual canvas geometry changes move the camera; typing and model edits do not.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !flow || !active) return;
    let size = { width: element.clientWidth, height: element.clientHeight };
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (!width || !height || (width === size.width && height === size.height)) return;
      size = { width, height };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!latest.current.active) return;
        const selected = latest.current.selected;
        const target =
          selected?.collection === "elements" ? flow.getNode(selected.elementId!) : undefined;
        if (target)
          void flow.setCenter(
            target.position.x + C4_CARD.width / 2,
            target.position.y + C4_CARD.height / 2,
            { zoom: Math.min(flow.getZoom(), 1), duration: 0 },
          );
        else void flow.fitView({ padding: 0.2, duration: 0 });
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [flow, active, viewId]);
  const persist = async (base: VisualModel, id: string, positions: C4Position[]) => {
    const current = latest.current;
    if (writing.current) return;
    if (
      !current.active ||
      !current.props.onEdit ||
      current.viewId !== id ||
      current.props.model.id !== base.id ||
      current.props.model.generation !== base.generation
    ) {
      setNodes(current.derived);
      return;
    }
    writing.current = true;
    setPending(true);
    try {
      await current.props.onEdit(c4PositionEdit(base, id, positions));
    } catch (error) {
      const now = latest.current;
      if (
        mounted.current &&
        now.active &&
        now.viewId === id &&
        now.props.model.generation === base.generation
      )
        now.props.report(error instanceof Error ? error.message : String(error));
    } finally {
      writing.current = false;
      if (mounted.current) {
        setPending(false);
        setNodes(latest.current.derived);
      }
    }
  };
  if (!view || !scene)
    return (
      <div className="bvm-notice" role="status">
        {content.views.length
          ? `C4 diagram ${props.c4ViewId ?? viewId} is unavailable. Its saved selection is preserved.`
          : "Add a named C4 diagram to explore this architecture."}
      </div>
    );
  const selectedCollection =
    selected?.collection === "elements" || selected?.collection === "relationships"
      ? selected.collection
      : undefined;
  const selectedRecord = selectedCollection
    ? content[selectedCollection].find((e) => e.id === selected!.elementId)
    : undefined;
  const visibleIds = new Set(scene.elements.map((e) => e.element.id));
  const choices = scene.elements.filter(({ element }) =>
    c4ElementText(element).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const controlledNavigation = props.c4ViewId !== undefined && !props.onC4ViewChange;
  return (
    <div className="bvm-c4">
      <div className="bvm-c4-toolbar">
        <label>
          Architecture diagram
          <select
            aria-label="Architecture diagram"
            value={view.id}
            disabled={!active || controlledNavigation}
            onChange={(e) => navigate(e.target.value)}
          >
            {content.views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <div className="bvm-c4-heading">
          <strong>{C4_VIEW_LABELS[view.kind]}</strong>
          <span>
            {view.scope
              ? content.elements.find((e) => e.id === view.scope)?.label
              : "People and software systems"}
          </span>
        </div>
        <button
          type="button"
          disabled={!active || !flow}
          onClick={() => void flow?.fitView({ padding: 0.2, duration: 0 })}
        >
          Fit architecture
        </button>
        {props.onEdit && (
          <button
            type="button"
            disabled={!active || pending || !view.positions?.length}
            onClick={() => void persist(model, view.id, [])}
          >
            Reset diagram layout
          </button>
        )}
      </div>
      <div className="bvm-c4-find">
        <label>
          Find in this diagram
          <input
            aria-label="Find in this diagram"
            value={query}
            disabled={!active}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, responsibility or technology"
          />
        </label>
        <label>
          Inspect element
          <select
            aria-label="Inspect architecture element"
            disabled={!active}
            value={
              selected?.collection === "elements" &&
              visibleIds.has(selected.elementId!) &&
              choices.some((e) => e.element.id === selected.elementId)
                ? selected.elementId
                : ""
            }
            onChange={(e) => {
              if (!e.target.value) return;
              select("elements", e.target.value);
              void flow?.fitView({
                nodes: [{ id: e.target.value }],
                padding: 0.6,
                minZoom: 0.7,
                maxZoom: 1,
                duration: 0,
              });
            }}
          >
            <option value="">
              {choices.length
                ? `${choices.length} elements — choose to focus`
                : "No matching elements"}
            </option>
            {choices.map(({ element }) => (
              <option key={element.id} value={element.id}>
                {element.label} · {C4_KIND_LABELS[element.kind]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Inspect relationship
          <select
            aria-label="Inspect architecture relationship"
            disabled={!active}
            value={
              selected?.collection === "relationships" &&
              scene.relationships.some((r) => r.id === selected.elementId)
                ? selected.elementId
                : ""
            }
            onChange={(e) => {
              if (e.target.value) select("relationships", e.target.value);
            }}
          >
            <option value="">{scene.relationships.length} directed relationships</option>
            {scene.relationships.map((r) => (
              <option key={r.id} value={r.id}>
                {targets.get(`relationships:${r.id}`)?.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={`bvm-c4-body${selectedRecord ? " bvm-c4-with-inspector" : ""}`}>
        <div
          ref={canvas}
          className="bvm-c4-canvas"
          onKeyDownCapture={(event) => {
            const target = event.target as HTMLElement;
            const node = target.closest<HTMLElement>(".react-flow__node");
            if (!node || target.closest("input,textarea,select,button")) return;
            const id = node.dataset.id;
            if (!id || !visibleIds.has(id)) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              select("elements", id);
              return;
            }
            const deltas: Record<string, [number, number]> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            };
            const delta = deltas[event.key];
            if (!delta) return;
            event.preventDefault();
            event.stopPropagation();
            if (!active || !props.onEdit || writing.current) return;
            const step = event.shiftKey ? 50 : 10;
            const positions = scene.elements.map((e) => ({
              elementId: e.element.id,
              x: e.x + (e.element.id === id ? delta[0] * step : 0),
              y: e.y + (e.element.id === id ? delta[1] * step : 0),
            }));
            void persist(model, view.id, positions);
          }}
        >
          <ReactFlow<C4FlowNode, C4FlowEdge>
            // The host grid owns viewport size; renderer content must not
            // contribute intrinsic dimensions back into its observed viewport.
            style={{ position: "absolute", inset: 0 }}
            key={`${model.id}:${model.generation}:${view.id}`}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={setFlow}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.05}
            maxZoom={2}
            nodesConnectable={false}
            nodesDraggable={!!props.onEdit && active && !pending}
            elementsSelectable={active}
            panOnDrag={active}
            zoomOnScroll={active}
            zoomOnPinch={active}
            zoomOnDoubleClick={active}
            deleteKeyCode={null}
            multiSelectionKeyCode={null}
            selectionKeyCode={null}
            onNodeClick={(_, node) => {
              if (!node.data.boundary) select("elements", node.id);
            }}
            onEdgeClick={(_, edge) => select("relationships", edge.id)}
            onPaneClick={() => {
              if (active) {
                setLocalSelected(null);
                props.onSelect?.(null);
              }
            }}
            onNodesChange={(changes) => {
              // Card and boundary sizes are derived, not editable. Do not feed
              // size-observer notifications synchronously back into controlled
              // node state; the engine still keeps its internal handle measures.
              const relevant = changes.filter(
                (change) =>
                  change.type !== "dimensions" && (change.type !== "position" || !!drag.current),
              );
              if (relevant.length) setNodes((rows) => applyNodeChanges(relevant, rows));
            }}
            onNodeDragStart={() => {
              if (active && props.onEdit && !pending)
                drag.current = {
                  model,
                  viewId: view.id,
                  positions: scene.elements.map((e) => ({
                    elementId: e.element.id,
                    x: e.x,
                    y: e.y,
                  })),
                };
            }}
            onNodeDragStop={(_, node) => {
              const base = drag.current;
              drag.current = null;
              if (!base) {
                setNodes(latest.current.derived);
                return;
              }
              const positions = base.positions.map((p) =>
                p.elementId === node.id
                  ? { elementId: p.elementId, x: node.position.x, y: node.position.y }
                  : p,
              );
              void persist(base.model, base.viewId, positions);
            }}
          >
            <Background color={tokens.line} gap={24} />
            {active && <Controls showInteractive={false} />}
          </ReactFlow>
        </div>
        {selectedCollection && selectedRecord && (
          <C4Inspector
            key={`${model.generation}:${selectedCollection}:${selected!.elementId}:${selected!.incarnation}`}
            props={{ ...props, active: active && !pending }}
            canNavigate={canNavigate}
            collection={selectedCollection}
            record={selectedRecord}
            navigate={(id) => {
              if (canNavigate) navigate(id);
            }}
          />
        )}
      </div>
      <div className="bvm-c4-legend" aria-label="C4 notation legend">
        <span>
          <strong>Notation:</strong> explicit element type and responsibility
        </span>
        <span>→ directed relationship; second line is protocol</span>
        <span>Dashed card: external element</span>
        <span>Dashed enclosure: scope boundary</span>
        <span>
          {props.onEdit ? "Drag saves only this diagram's layout." : "Read-only architecture."}{" "}
          Navigation never edits content.
        </span>
      </div>
    </div>
  );
}
