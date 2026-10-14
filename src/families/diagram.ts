import { GRAPH_SCHEMA, type GraphContent, type GraphNode } from "../semantic.ts";
import { cycleComponents } from "./cycles.ts";
import {
  defineVisualFamily,
  NESTED_REMOVAL,
  nestedCascade,
  SEMANTIC_FIELDS,
  SEMANTIC_SEARCH,
  type VisualIssue,
} from "./family.ts";

const SIDES = ["top", "right", "bottom", "left"];
const NEW_NODE = { width: 180, height: 90 };
const NEW_GROUP = { width: 420, height: 300 };
const GAP = 40;

function diagramIssues(content: Record<string, unknown>): VisualIssue[] {
  const graph = content as unknown as GraphContent;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const issues: VisualIssue[] = [];
  for (const node of graph.nodes) {
    if (node.parentId && !byId.has(node.parentId))
      issues.push({ path: ["nodes", node.id, "parentId"], message: "A diagram parent must exist" });
    else if (node.parentId && !byId.get(node.parentId)?.group)
      issues.push({
        path: ["nodes", node.id, "parentId"],
        message: "A diagram parent must be a group",
      });
    const ports = new Set<string>();
    for (const port of node.ports ?? []) {
      if (ports.has(port.id))
        issues.push({
          path: ["nodes", node.id, "ports", port.id],
          message: "Diagram ports require unique IDs within each node",
        });
      ports.add(port.id);
    }
  }
  const nesting = graph.nodes.flatMap((node) =>
    node.parentId ? [[node.parentId, node.id] as const] : [],
  );
  const cyclic = cycleComponents([...byId.keys()], nesting);
  for (const node of graph.nodes)
    if (cyclic.has(node.id))
      issues.push({
        path: ["nodes", node.id, "parentId"],
        message: "Diagram groups must not nest in a cycle",
      });
  for (const edge of graph.edges)
    for (const end of ["source", "target"] as const) {
      const node = byId.get(edge[end]);
      const port = edge[`${end}Port`];
      if (!node)
        issues.push({
          path: ["edges", edge.id, end],
          message: "A diagram edge refers to an absent node",
        });
      else if (
        port &&
        (node.ports ? !node.ports.some((entry) => entry.id === port) : !SIDES.includes(port))
      )
        issues.push({
          path: ["edges", edge.id, `${end}Port`],
          message: "A diagram edge refers to an absent port",
        });
    }
  return issues;
}

/** Right of everything already drawn, so a new node never lands on an old one. */
function freePlace(nodes: readonly GraphNode[]) {
  if (!nodes.length) return { x: 0, y: 0 };
  return {
    x: Math.max(...nodes.map((node) => node.x + (node.width ?? NEW_NODE.width))) + GAP,
    y: Math.min(...nodes.map((node) => node.y)),
  };
}

export function createDiagramFamily(options: { linkPattern?: string } = {}) {
  const nodes = GRAPH_SCHEMA.properties.nodes as {
    type: string;
    maxItems: number;
    items: { properties: Record<string, unknown>; [key: string]: unknown };
  };
  return defineVisualFamily("diagram", {
    schema: options.linkPattern
      ? {
          ...GRAPH_SCHEMA,
          properties: {
            ...GRAPH_SCHEMA.properties,
            nodes: {
              ...nodes,
              items: {
                ...nodes.items,
                properties: {
                  ...nodes.items.properties,
                  href: { type: "string", pattern: options.linkPattern, maxLength: 300 },
                },
              },
            },
          },
        }
      : GRAPH_SCHEMA,
    validate: diagramIssues,
    additions: () => [
      { label: "Add entity", collection: "nodes" },
      { label: "Add group", collection: "nodes", group: true },
    ],
    fields: {
      direction: { label: "Layout direction", control: "choice" },
      source: { label: "Imported source", readOnly: true, hidden: true },
    },
    collections: {
      nodes: {
        search: SEMANTIC_SEARCH,
        fields: {
          ...SEMANTIC_FIELDS,
          parentId: { label: "Group", control: "ref", ref: "nodes" },
          group: { label: "Holds other nodes", section: "Structure" },
          href: { label: "Canvas link", control: "text", section: "Structure" },
          ports: { label: "Ports", section: "Structure", hidden: true },
          x: { label: "X", control: "number", section: "Layout" },
          y: { label: "Y", control: "number", section: "Layout" },
          width: { label: "Width", control: "number", section: "Layout" },
          height: { label: "Height", control: "number", section: "Layout" },
        },
        newItem: (content, { id, near, group }) => ({
          id,
          label: group ? "New group" : "New entity",
          ...(near ?? freePlace((content as unknown as GraphContent).nodes)),
          ...(group ? { ...NEW_GROUP, group: true } : NEW_NODE),
        }),
        cascade: nestedCascade("nodes", "edges"),
        removalNote: NESTED_REMOVAL,
      },
      edges: {
        search: SEMANTIC_SEARCH,
        fields: {
          ...SEMANTIC_FIELDS,
          source: { label: "From", control: "ref", ref: "nodes", order: 2 },
          target: { label: "To", control: "ref", ref: "nodes", order: 3 },
          sourcePort: { label: "From port", control: "ref", ref: "ports", of: "source" },
          targetPort: { label: "To port", control: "ref", ref: "ports", of: "target" },
        },
      },
    },
  });
}
export const diagramFamily = createDiagramFamily();
