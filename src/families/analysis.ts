import { ANALYSIS_SCHEMA, type AnalysisContent } from "../semantic.ts";
import { cycleComponents } from "./cycles.ts";
import {
  defineVisualFamily,
  NESTED_REMOVAL,
  nestedCascade,
  SEMANTIC_FIELDS,
  SEMANTIC_SEARCH,
  type VisualIssue,
} from "./family.ts";

function analysisIssues(content: Record<string, unknown>): VisualIssue[] {
  const analysis = content as unknown as AnalysisContent;
  const issues: VisualIssue[] = [];
  const at = (path: string[], message: string) => issues.push({ path, message });
  const ids = analysis.nodes.map((node) => node.id);
  const known = new Set(ids);
  if (analysis.layout === "sankey") {
    const links = analysis.links ?? [];
    if (!links.length) at(["links"], "A weighted flow requires at least one positive link");
    const flow = cycleComponents(
      ids,
      links.map((link) => [link.source, link.target] as const),
    );
    for (const link of links) {
      for (const end of ["source", "target"] as const)
        if (!known.has(link[end]))
          at(["links", link.id, end], "Weighted flow refers to an absent entity");
      const loop = flow.get(link.source);
      if (loop !== undefined && loop === flow.get(link.target))
        at(["links", link.id], "Weighted flow must not contain a cycle");
    }
  } else if (analysis.layout === "treemap" || analysis.layout === "sunburst") {
    const nesting = cycleComponents(
      ids,
      analysis.nodes.flatMap((node) => (node.parentId ? [[node.parentId, node.id] as const] : [])),
    );
    for (const node of analysis.nodes) {
      if (node.parentId && !known.has(node.parentId))
        at(["nodes", node.id, "parentId"], "Hierarchy refers to an absent entity");
      else if (nesting.has(node.id))
        at(["nodes", node.id, "parentId"], "Hierarchy must not contain a cycle");
      if (node.value === undefined)
        at(["nodes", node.id, "value"], "Hierarchy nodes require nonnegative values");
    }
  } else {
    const dimensions = analysis.dimensions ?? [];
    if (dimensions.length < 2 || new Set(dimensions).size !== dimensions.length)
      at(["dimensions"], "Parallel coordinates require at least two unique dimensions");
    for (const node of analysis.nodes)
      for (const dimension of dimensions)
        if (typeof node.metrics?.[dimension] !== "number")
          at(
            ["nodes", node.id, "metrics", dimension],
            "Every parallel-coordinate row must supply every declared dimension",
          );
  }
  return issues;
}

export const analysisFamily = defineVisualFamily("analysis", {
  schema: ANALYSIS_SCHEMA,
  validate: analysisIssues,
  fields: {
    layout: { label: "Layout", control: "choice" },
    dimensions: { label: "Compared dimensions", section: "Structure" },
  },
  // Only a weighted flow draws relationships a person can add.
  additions: (content) => [
    { label: "Add entity", collection: "nodes" },
    ...(content.layout === "sankey"
      ? [{ label: "Add weighted relationship", collection: "links", relation: true }]
      : []),
  ],
  collections: {
    nodes: {
      search: SEMANTIC_SEARCH,
      fields: {
        ...SEMANTIC_FIELDS,
        value: { label: "Value", control: "number", order: 2 },
        parentId: { label: "Parent", control: "ref", ref: "nodes", section: "Structure" },
        metrics: { label: "Measurements", section: "Values" },
      },
      newItem: (content, { id }) => {
        const analysis = content as unknown as AnalysisContent;
        return {
          id,
          label: "New entity",
          ...(analysis.layout === "parallel"
            ? {
                metrics: Object.fromEntries(
                  (analysis.dimensions ?? []).map((dimension) => [dimension, 0]),
                ),
              }
            : { value: 10 }),
        };
      },
      cascade: nestedCascade("nodes", "links"),
      removalNote: NESTED_REMOVAL,
    },
    links: {
      search: SEMANTIC_SEARCH,
      fields: {
        source: { label: "Flow from", control: "ref", ref: "nodes", order: 0 },
        target: { label: "Flow to", control: "ref", ref: "nodes", order: 1 },
        label: { label: "Flow label", control: "text", order: 2 },
        value: { label: "Flow value", control: "number", order: 3 },
        description: SEMANTIC_FIELDS.description,
        entityId: SEMANTIC_FIELDS.entityId,
      },
      newItem: (_content, { id, values }) => ({ label: "Flow", value: 10, ...values, id }),
    },
  },
});
