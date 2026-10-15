import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  applyNodeChanges,
  type Node,
  type NodeProps,
  type Edge,
} from "@xyflow/react";
import type { GraphContent, GraphNode } from "../semantic.ts";
import { modelTargets } from "../targets.ts";
import { networkData, canonicalElementId } from "../render/network-model.ts";
import type { AdapterProps } from "./types.ts";

type NodeData = { label: string; group?: boolean; ports?: GraphNode["ports"] };
type GraphFlowNode = Node<NodeData>;
const position = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};
function Entity({ data }: NodeProps<GraphFlowNode>) {
  const ports = data.ports ?? [
    { id: "left", side: "left" as const },
    { id: "right", side: "right" as const },
  ];
  return (
    <div className={`bvm-entity ${data.group ? "bvm-group" : ""}`}>
      <span className="bvm-entity-label">{data.label}</span>
      {ports.map((port) => (
        <span key={port.id}>
          <Handle id={port.id} type="target" position={position[port.side]} />
          <Handle id={port.id} type="source" position={position[port.side]} />
        </span>
      ))}
    </div>
  );
}
const nodeTypes = { entity: Entity };

export default function GraphView(props: AdapterProps) {
  const { model, projection, onEdit, onSelect, selected, registry, tokens, report } = props;
  const content = model.content as unknown as GraphContent;
  const network = projection === "network";
  const targets = useMemo(() => modelTargets(model, registry), [model, registry]);
  const derived = useMemo(() => {
    const layout = network ? networkData(content, "") : undefined;
    const positions = new Map(
      layout?.nodes.map((node) => [canonicalElementId(node.id)?.id, node.style]),
    );
    const byId = new Map(content.nodes.map((node) => [node.id, node]));
    const depth = (node: GraphNode) => {
      let level = 0,
        parent = node.parentId;
      while (parent && level <= content.nodes.length) {
        level++;
        parent = byId.get(parent)?.parentId;
      }
      return level;
    };
    return [...content.nodes]
      .sort((a, b) => depth(a) - depth(b))
      .map(
        (node): GraphFlowNode => ({
          id: node.id,
          type: "entity",
          data: { label: node.label, group: node.group, ports: node.ports },
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
  }, [content, network, !!onEdit, selected?.collection, selected?.elementId, tokens]);
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
    const frame = requestAnimationFrame(() => props.ready());
    return () => cancelAnimationFrame(frame);
  }, [model.revision, projection, props.ready]);
  const edges: Edge[] = content.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    sourceHandle: edge.sourcePort ?? "right",
    targetHandle: edge.targetPort ?? "left",
    type: "smoothstep",
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
  }));
  const select = useCallback(
    (collection: string, id: string) =>
      onSelect?.(
        targets.find((target) => target.collection === collection && target.elementId === id) ??
          null,
      ),
    [onSelect, targets],
  );
  return (
    <ReactFlow<GraphFlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
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
        const origin = before.current;
        before.current = undefined;
        const previous = origin?.rows.get(node.id);
        if (!onEdit || !previous || !origin) return;
        if (
          origin.modelId !== model.id ||
          origin.generation !== model.generation ||
          previous.incarnation !== model.elementIncarnations?.nodes?.[node.id]
        ) {
          setNodes(latest.current.derived);
          report("The dragged element was replaced; reread the model before moving it.");
          return;
        }
        if (previous.x === node.position.x && previous.y === node.position.y) {
          setNodes(latest.current.derived);
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
  );
}
