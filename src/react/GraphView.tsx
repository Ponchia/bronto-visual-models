import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type Edge,
} from "@xyflow/react";
import RoutedEdge, { type RoutedFlowEdge } from "./RoutedEdge.tsx";
import { diagramRoutingMatches, placeDiagramLabels } from "../render/diagram-routing.ts";
import type { GraphContent, GraphNode } from "../semantic.ts";
import { modelTargets } from "../targets.ts";
import { graphEdgeHandles, graphPorts } from "../render/graph-ports.ts";
import { networkData, canonicalElementId } from "../render/network-model.ts";
import type { AdapterProps } from "./types.ts";

type NodeData = {
  label: string;
  group?: boolean;
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
function Entity({ id, data }: NodeProps<GraphFlowNode>) {
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
    <div className={`bvm-entity ${data.group ? "bvm-group" : ""}`}>
      <span className="bvm-entity-label" title={data.label}>
        {data.label}
      </span>
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
}
const nodeTypes = { entity: Entity };
const edgeTypes = { routed: RoutedEdge };

export default function GraphView(props: AdapterProps) {
  const { model, projection, onEdit, onSelect, selected, registry, tokens, report } = props;
  const content = model.content as unknown as GraphContent;
  const network = projection === "network";
  const [moving, setMoving] = useState(false);
  const validRouting = useMemo(
    () =>
      !network && diagramRoutingMatches(model, props.diagramRouting)
        ? props.diagramRouting
        : undefined,
    [model, network, props.diagramRouting],
  );
  const routing = moving ? undefined : validRouting;
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
  const derived = useMemo(() => {
    const layout = network ? networkData(content, "") : undefined;
    const positions = new Map(
      layout?.nodes.map((node) => [canonicalElementId(node.id)?.id, node.style]),
    );
    const byId = new Map(content.nodes.map((node) => [node.id, node]));
    const depthCache = new Map<string, number>();
    const depth = (node: GraphNode): number => {
      const cached = depthCache.get(node.id);
      if (cached !== undefined) return cached;
      // Resolve a chain only once. Deeply nested diagrams previously walked
      // the entire ancestor chain again for every sort comparison.
      const path = [node];
      let parent = node.parentId;
      while (parent && !depthCache.has(parent) && path.length <= content.nodes.length) {
        const next = byId.get(parent);
        if (!next) break;
        path.push(next);
        parent = next.parentId;
      }
      let level = parent ? (depthCache.get(parent) ?? 0) + 1 : 0;
      while (path.length) {
        depthCache.set(path.pop()!.id, level);
        level++;
      }
      return depthCache.get(node.id)!;
    };
    return [...content.nodes]
      .sort((a, b) => depth(a) - depth(b))
      .map(
        (node): GraphFlowNode => ({
          id: node.id,
          type: "entity",
          data: {
            label: node.label,
            group: node.group,
            ports: node.ports,
            routePorts: routing?.ports.filter((port) => port.nodeId === node.id),
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
            borderColor: tokens.edge,
          },
          selected: selected?.collection === "nodes" && selected.elementId === node.id,
        }),
      );
  }, [content, network, !!onEdit, selected?.collection, selected?.elementId, tokens, routing]);
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
    const frame = requestAnimationFrame(() => props.ready());
    return () => cancelAnimationFrame(frame);
  }, [model.revision, projection, props.ready]);
  const edges = useMemo(
    (): RoutedFlowEdge[] =>
      content.edges.map((edge) => {
        const handles = graphEdgeHandles(content, edge);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          sourceHandle: handles.source,
          targetHandle: handles.target,
          type: "routed",
          data: {
            route: routing?.edges.find((route) => route.id === edge.id),
            labelBox: labelPlan?.labels.get(edge.id),
            managedLabels: (!!props.diagramRouting && !network) || moving,
            text: edge.label,
            font: `12px ${tokens.sans}`,
            select: () =>
              onSelect?.(
                targets.find((t) => t.collection === "edges" && t.elementId === edge.id) ?? null,
              ),
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: tokens.edge },
          style: {
            stroke:
              selected?.collection === "edges" && selected.elementId === edge.id
                ? tokens.accent
                : tokens.edge,
            strokeWidth: 1.8,
          },
          labelStyle: { fill: tokens.text },
          labelBgStyle: { fill: tokens.panel },
          ariaLabel: edge.label,
        };
      }),
    [
      content.edges,
      content.nodes,
      content.direction,
      selected?.collection,
      selected?.elementId,
      tokens,
      routing,
      labelPlan,
      onSelect,
      targets,
      props.diagramRouting,
      network,
      moving,
    ],
  );
  const select = useCallback(
    (collection: string, id: string) =>
      onSelect?.(
        targets.find((target) => target.collection === collection && target.elementId === id) ??
          null,
      ),
    [onSelect, targets],
  );
  return (
    <div
      className="bvm-graph-shell"
      data-routing-state={routing ? "current" : props.diagramRouting ? "stale" : "none"}
    >
      <div className="bvm-graph-canvas">
        <ReactFlow<GraphFlowNode, RoutedFlowEdge>
          nodes={nodes}
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
          onPaneClick={() => onSelect?.(null)}
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
      {!!props.diagramRouting && !network && (
        <details className="bvm-edge-reading">
          <summary>
            Relationship labels ({content.edges.length})
            {!routing
              ? " · routes changed"
              : routing.omitted.length || labelPlan?.unplaced.length
                ? " · some labels shown here"
                : ""}
          </summary>
          <ul>
            {content.edges.map((edge) => (
              <li key={edge.id}>
                <button type="button" onClick={() => select("edges", edge.id)}>
                  {edge.label || "Unlabelled relationship"}
                </button>
                <span>
                  {" "}
                  {content.nodes.find((n) => n.id === edge.source)?.label} →{" "}
                  {content.nodes.find((n) => n.id === edge.target)?.label}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
