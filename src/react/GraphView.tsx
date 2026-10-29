import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type CSSProperties,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  applyNodeChanges,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import RoutedEdge, { type RoutedFlowEdge } from "./RoutedEdge.tsx";
import { diagramRoutingMatches, placeDiagramLabels } from "../render/diagram-routing.ts";
import type { GraphContent, GraphNode, GraphTone } from "../semantic.ts";
import { modelTargets } from "../targets.ts";
import { graphPorts } from "../render/graph-ports.ts";
import { networkData, canonicalElementId } from "../render/network-model.ts";
import type { AdapterProps } from "./types.ts";
import type { RendererTokens } from "@ponchia/ui/renderer";
import GraphAuthoring from "./GraphAuthoring.tsx";
import type { VisualTarget } from "../model.ts";

const graphTone = (tone: GraphTone | undefined, tokens: RendererTokens): string => {
  switch (tone) {
    case "accent":
      return tokens.accent;
    case "info":
      return tokens.info;
    case "success":
      return tokens.success;
    case "warning":
      return tokens.warning;
    case "danger":
      return tokens.danger;
    default:
      return tokens.edge;
  }
};

import { graphInteractionIndex, graphSelection } from "../render/graph-index.ts";
import GraphFinder from "./GraphFinder.tsx";

type NodeData = {
  label: string;
  group?: boolean;
  shape?: GraphNode["shape"];
  description?: string;
  ports?: GraphNode["ports"];
  routePorts?: Array<{ portId: string; offset: number }>;
};
type GraphFlowNode = Node<NodeData>;
const position = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};
const Entity = memo(function Entity({ id, data }: NodeProps<GraphFlowNode>) {
  const ports = graphPorts(data).map((port) => ({
    ...port,
    offset: data.routePorts?.find((p) => p.portId === port.id)?.offset ?? port.offset,
  }));
  const updateNodeInternals = useUpdateNodeInternals();
  const portGeometry = JSON.stringify(ports.map(({ id, side, offset }) => ({ id, side, offset })));
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, portGeometry, updateNodeInternals]);
  return (
    <div
      className={`bvm-entity ${data.group ? "bvm-group" : ""} bvm-shape-${data.shape ?? "rounded"}`}
    >
      <span className="bvm-entity-label" title={data.label}>
        {data.label}
      </span>
      {!data.group && data.description && (
        <span className="bvm-entity-description" title={data.description}>
          {data.description}
        </span>
      )}
      {ports.map((port) => (
        <span key={port.id}>
          {(["target", "source"] as const).map((type) => (
            <Handle
              key={type}
              id={port.id}
              type={type}
              position={position[port.side]}
              title={port.label ?? port.id}
              style={
                port.side === "left" || port.side === "right"
                  ? { top: `${port.offset * 100}%` }
                  : { left: `${port.offset * 100}%` }
              }
            />
          ))}
        </span>
      ))}
    </div>
  );
});
const nodeTypes = { entity: Entity };
const edgeTypes = { routed: RoutedEdge };

export default function GraphView(props: AdapterProps) {
  const { model, projection, onEdit, onSelect, registry, tokens, report } = props;
  const content = model.content as unknown as GraphContent;
  const network = projection === "network";
  const [localSelected, setLocalSelected] = useState<VisualTarget | null>(null);
  const [moving, setMoving] = useState(false);
  const [readingEdges, setReadingEdges] = useState(false);
  const [keyboardStatus, setKeyboardStatus] = useState("");
  const keyboardWrite = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const validRouting = useMemo(
    () =>
      !network && diagramRoutingMatches(model, props.diagramRouting)
        ? props.diagramRouting
        : undefined,
    [model, network, props.diagramRouting],
  );
  const routing = moving ? undefined : validRouting;
  const index = useMemo(() => graphInteractionIndex(content, routing), [content, routing]);
  const [flow, setFlow] = useState<ReactFlowInstance<GraphFlowNode, RoutedFlowEdge> | null>(null);
  const [fontEpoch, setFontEpoch] = useState(0);
  useEffect(() => {
    let live = true;
    const done = () => {
      if (live) setFontEpoch((x) => x + 1);
    };
    void document.fonts?.ready.then(done);
    document.fonts?.addEventListener("loadingdone", done);
    return () => {
      live = false;
      document.fonts?.removeEventListener("loadingdone", done);
    };
  }, []);
  const labelPlan = useMemo(() => {
    if (!routing) return undefined;
    const canvas = typeof document === "undefined" ? null : document.createElement("canvas");
    const context = canvas?.getContext("2d");
    if (context) context.font = `12px ${tokens.sans}`;
    const sizes = new Map(
      content.edges.map((edge) => [
        edge.id,
        {
          width: Math.max(
            24,
            Math.min(200, (context?.measureText(edge.label).width ?? edge.label.length * 7) + 16),
          ),
          height: 24,
        },
      ]),
    );
    return placeDiagramLabels(content, routing.edges, sizes);
  }, [routing, content, tokens.sans, fontEpoch]);
  const targets = useMemo(() => modelTargets(model, registry), [model, registry]);
  const targetIndex = useMemo(
    () => new Map(targets.map((target) => [`${target.collection}:${target.elementId}`, target])),
    [targets],
  );
  const selected =
    props.selected !== undefined
      ? props.selected
      : localSelected?.modelId === model.id && localSelected.generation === model.generation
        ? (() => {
            const now = targetIndex.get(`${localSelected.collection}:${localSelected.elementId}`);
            return now && now.incarnation === localSelected.incarnation ? now : null;
          })()
        : null;
  const selection = useRef({
    onSelect,
    targetIndex,
    setLocalSelected,
    controlled: props.selected !== undefined,
  });
  selection.current = {
    onSelect,
    targetIndex,
    setLocalSelected,
    controlled: props.selected !== undefined,
  };
  const select = useCallback((collection: string, id: string) => {
    const current = selection.current;
    const target = current.targetIndex.get(`${collection}:${id}`) ?? null;
    if (!current.controlled) current.setLocalSelected(target);
    current.onSelect?.(target);
  }, []);
  const baseNodes = useMemo(() => {
    const layout = network ? networkData(content, "") : undefined;
    const positions = new Map(
      layout?.nodes.map((node) => [canonicalElementId(node.id)?.id, node.style]),
    );
    return index.orderedNodes.map(
      (node): GraphFlowNode => ({
        id: node.id,
        type: "entity",
        data: {
          label: node.label,
          group: node.group,
          shape: node.shape,
          description: node.description,
          ports: node.ports,
          routePorts: index.routePorts.get(node.id),
        },
        position: network
          ? {
              x: (positions.get(node.id)?.x ?? 0) + 280,
              y: (positions.get(node.id)?.y ?? 0) + 230,
            }
          : { x: node.x, y: node.y },
        ...(!network && node.parentId ? { parentId: node.parentId } : {}),
        ariaLabel: node.label,
        draggable: !network && !!onEdit,
        style: {
          width: network ? 145 : (node.width ?? 180),
          height: network ? 65 : (node.height ?? 90),
          background: tokens.panel,
          color: tokens.text,
          borderColor: graphTone(node.tone, tokens),
          "--bvm-entity-tone": graphTone(node.tone, tokens),
        } as CSSProperties,
        selected: false,
      }),
    );
  }, [content, network, !!onEdit, tokens, index]);
  const nodeSelection = selected?.collection === "nodes" ? selected.elementId : undefined;
  const derived = useMemo(
    () => graphSelection(baseNodes, nodeSelection),
    [baseNodes, nodeSelection],
  );
  const [nodes, setNodes] = useState<GraphFlowNode[]>(derived);
  const dragging = useRef(false);
  const latest = useRef({ props, derived });
  latest.current = { props, derived };
  const before = useRef<
    | {
        modelId: string;
        generation: string;
        rows: Map<string, { x: number; y: number; incarnation?: string }>;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    if (!dragging.current) setNodes(derived);
  }, [derived]);
  useEffect(() => {
    if (!dragging.current) setMoving(false);
  }, [model.generation, model.revision]);
  useEffect(() => {
    if (props.active === false) return;
    const frame = requestAnimationFrame(() => props.ready());
    return () => cancelAnimationFrame(frame);
  }, [model.revision, projection, props.ready, props.active]);
  const baseEdges = useMemo(
    (): RoutedFlowEdge[] =>
      content.edges.map((edge) => {
        const handles = index.handles.get(edge.id)!;
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          sourceHandle: handles.source,
          targetHandle: handles.target,
          type: "routed",
          data: {
            route: index.routes.get(edge.id),
            labelBox: labelPlan?.labels.get(edge.id),
            managedLabels: (!!props.diagramRouting && !network) || moving,
            text: edge.label,
            font: `12px ${tokens.sans}`,
            select: () => select("edges", edge.id),
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: graphTone(edge.tone, tokens) },
          style: {
            stroke: graphTone(edge.tone, tokens),
            strokeWidth: 1.8,
            ...(edge.line === "dashed"
              ? { strokeDasharray: "8 5" }
              : edge.line === "dotted"
                ? { strokeDasharray: "2 5" }
                : {}),
          },
          labelStyle: { fill: tokens.text },
          labelBgStyle: { fill: tokens.panel },
          ariaLabel: edge.label,
        };
      }),
    [content.edges, tokens, index, labelPlan, props.diagramRouting, network, moving, select],
  );
  const edgeSelection = selected?.collection === "edges" ? selected.elementId : undefined;
  const edges = useMemo(
    () =>
      baseEdges.map((edge) =>
        edge.id === edgeSelection
          ? { ...edge, selected: true, style: { ...edge.style, stroke: tokens.accent } }
          : edge,
      ),
    [baseEdges, edgeSelection, tokens.accent],
  );
  const reveal = useCallback(
    async (collection: string, id: string) => {
      if (!flow || props.active === false || moving) return;
      const found =
        collection === "nodes"
          ? [id]
          : (() => {
              const edge = index.edges.get(id);
              return edge ? [edge.source, edge.target] : [];
            })();
      if (!found.length) return;
      select(collection, id);
      await flow.fitView({
        nodes: found.map((id) => ({ id })),
        padding: 0.3,
        minZoom: 0.1,
        maxZoom: 1.2,
        duration: 0,
      });
    },
    [flow, index, select, props.active, moving],
  );
  const keyboard = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const element = event.target;
      if (!(element instanceof Element)) return;
      const node = element.matches(".react-flow__node"),
        edge = element.matches(".react-flow__edge");
      if (!node && !edge) return;
      const id = element.getAttribute("data-id");
      if (!id) return;
      if (["Enter", " ", "Escape"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (latest.current.props.active === false) return;
        if (event.key === "Escape") select("", "");
        else select(node ? "nodes" : "edges", id);
        return;
      }
      const offset = (
        { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<
          string,
          number[]
        >
      )[event.key];
      if (!node || !offset || event.altKey || event.ctrlKey || event.metaKey) return;
      // React Flow's built-in keyboard displacement is renderer-local. Replace it
      // with the same controlled transaction boundary as pointer edits.
      event.stopPropagation();
      const current = latest.current.props;
      if (!current.onEdit || current.active === false || current.projection === "network") return;
      event.preventDefault();
      if (keyboardWrite.current || dragging.current) return;
      const source = (current.model.content as unknown as GraphContent).nodes.find(
        (node) => node.id === id,
      );
      if (!source) return;
      const step = event.shiftKey ? 40 : 10;
      const origin = { id: current.model.id, generation: current.model.generation };
      const patch = {
        generation: origin.generation,
        ifRevision: current.model.revision,
        items: [
          {
            field: "nodes",
            set: [
              {
                id,
                x: source.x + offset[0]! * step,
                y: source.y + offset[1]! * step,
                expect: { x: source.x, y: source.y },
              },
            ],
          },
        ],
      };
      keyboardWrite.current = true;
      setKeyboardStatus(`Saving position of ${source.label}…`);
      void Promise.resolve()
        .then(() => current.onEdit!(patch))
        .then(() => {
          if (mounted.current && latest.current.props.model.generation === origin.generation)
            setKeyboardStatus("Position edit submitted to the host.");
        })
        .catch((error) => {
          if (
            !mounted.current ||
            latest.current.props.model.id !== origin.id ||
            latest.current.props.model.generation !== origin.generation
          )
            return;
          setNodes(latest.current.derived);
          setKeyboardStatus("Position edit was refused; saved coordinates are unchanged.");
          latest.current.props.report(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          keyboardWrite.current = false;
        });
    },
    [select],
  );
  const canvas = useRef<HTMLDivElement>(null);
  const nodePosition = useCallback(() => {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect || !flow) return { x: 0, y: 0 };
    const point = flow.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    return { x: Math.round(point.x - 90), y: Math.round(point.y - 45) };
  }, [flow]);
  return (
    <div
      className="bvm-graph-shell"
      data-routing-state={routing ? "current" : props.diagramRouting ? "stale" : "none"}
    >
      <GraphFinder
        targets={targets}
        disabled={!flow || props.active === false || moving}
        reveal={reveal}
        report={report}
      />
      {onEdit && !network && props.active !== false && (
        <GraphAuthoring
          model={model}
          selected={selected}
          onEdit={onEdit}
          report={report}
          newNodePosition={nodePosition}
        />
      )}
      <div className="bvm-graph-canvas" ref={canvas} onKeyDownCapture={keyboard}>
        <ReactFlow<GraphFlowNode, RoutedFlowEdge>
          nodes={nodes}
          onInit={setFlow}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.22, minZoom: 0.1, maxZoom: 1 }}
          minZoom={0.1}
          maxZoom={2.5}
          colorMode={tokens.scheme}
          nodesConnectable={false}
          deleteKeyCode={null}
          multiSelectionKeyCode={null}
          onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes, current))}
          onNodeClick={(_event, node) => select("nodes", node.id)}
          onEdgeClick={(_event, edge) => select("edges", edge.id)}
          onPaneClick={() => select("", "")}
          onNodeDragStart={() => {
            setMoving(true);
            dragging.current = true;
            before.current = {
              modelId: model.id,
              generation: model.generation,
              rows: new Map(
                content.nodes.map((node) => [
                  node.id,
                  {
                    x: node.x,
                    y: node.y,
                    incarnation: model.elementIncarnations?.nodes?.[node.id],
                  },
                ]),
              ),
            };
          }}
          onNodeDragStop={(_event, node) => {
            dragging.current = false;
            // Local positions may differ until the host supplies its committed revision.
            // Keep routes suspended until that occurs (or a refusal restores the host state).
            const origin = before.current;
            before.current = undefined;
            const previous = origin?.rows.get(node.id);
            if (!onEdit || !previous || !origin) {
              setMoving(false);
              return;
            }
            if (
              origin.modelId !== model.id ||
              origin.generation !== model.generation ||
              previous.incarnation !== model.elementIncarnations?.nodes?.[node.id]
            ) {
              setNodes(latest.current.derived);
              setMoving(false);
              report("The dragged element was replaced; reread the model before moving it.");
              return;
            }
            if (previous.x === node.position.x && previous.y === node.position.y) {
              setNodes(latest.current.derived);
              setMoving(false);
              return;
            }
            // A callback may throw synchronously or reject later; both restore the newest host state.
            const patch = {
              generation: origin.generation,
              items: [
                {
                  field: "nodes",
                  set: [
                    {
                      id: node.id,
                      x: node.position.x,
                      y: node.position.y,
                      expect: { x: previous.x, y: previous.y },
                    },
                  ],
                },
              ],
            };
            void Promise.resolve()
              .then(() => onEdit(patch))
              .catch((error) => {
                // Ignore a completion belonging to a different model now occupying this surface.
                const current = latest.current;
                if (
                  current.props.model.id !== origin.modelId ||
                  current.props.model.generation !== origin.generation
                )
                  return;
                setNodes(current.derived);
                setMoving(false);
                current.props.report(error instanceof Error ? error.message : String(error));
              });
          }}
          proOptions={{ hideAttribution: false }}
        >
          <Background color={tokens.line} gap={22} />
          <Controls
            showInteractive={false}
            fitViewOptions={{ padding: 0.22, minZoom: 0.1, maxZoom: 1 }}
          />
        </ReactFlow>
      </div>
      {keyboardStatus && (
        <p className="bvm-keyboard-status" role="status">
          {keyboardStatus}
        </p>
      )}
      {!!props.diagramRouting && !network && (
        <details
          className="bvm-edge-reading"
          onToggle={(e) => setReadingEdges(e.currentTarget.open)}
        >
          <summary>
            Relationship labels ({content.edges.length})
            {!routing
              ? " · routes changed"
              : routing.omitted.length || labelPlan?.unplaced.length
                ? " · some labels shown here"
                : ""}
          </summary>
          {readingEdges && (
            <ul>
              {content.edges.map((edge) => (
                <li key={edge.id}>
                  <button type="button" onClick={() => select("edges", edge.id)}>
                    {edge.label || "Unlabelled relationship"}
                  </button>
                  <span>
                    {" "}
                    {index.nodes.get(edge.source)?.label} → {index.nodes.get(edge.target)?.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}
