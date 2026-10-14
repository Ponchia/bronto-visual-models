import type { VisualTemplate } from "./catalog.ts";

/** Data-only examples make existing grammars discoverable without loading another engine. */
export const CREATIVE_TEMPLATES: readonly VisualTemplate[] = [
  {
    id: "cycle",
    title: "Learning cycle",
    description: "Explain a repeating process with identified stages.",
    renderer: "infographic",
    version: 1,
    content: {
      template: "sequence-circular-simple",
      items: [
        { id: "observe", label: "Observe", desc: "Collect evidence." },
        { id: "interpret", label: "Interpret", desc: "Form an explanation." },
        { id: "act", label: "Act", desc: "Try a deliberate change." },
        { id: "reflect", label: "Reflect", desc: "Compare the result." },
      ],
    },
  },
  {
    id: "roadmap-explanation",
    title: "Winding roadmap",
    description: "Present stages and their purpose without pretending to schedule tasks.",
    renderer: "infographic",
    version: 1,
    content: {
      template: "sequence-roadmap-vertical-simple",
      items: [
        { id: "baseline", label: "Establish a baseline", desc: "Describe the current experience." },
        {
          id: "build-prototype",
          label: "Try a focused prototype",
          desc: "Test a specific hypothesis.",
        },
        { id: "qualify", label: "Qualify the result", desc: "Measure and inspect the output." },
        {
          id: "publish",
          label: "Publish the improvement",
          desc: "Retain the evidence and decisions.",
        },
      ],
    },
  },
  {
    id: "mind-map",
    title: "Mind map",
    description: "Explore nested ideas. Stable item IDs survive layout and wording changes.",
    renderer: "infographic",
    version: 1,
    content: {
      template: "hierarchy-mindmap-branch-gradient-lined-palette",
      items: [
        { id: "question", label: "What makes this useful?" },
        { id: "people", parentId: "question", label: "People" },
        { id: "tasks", parentId: "people", label: "Real tasks" },
        { id: "access", parentId: "people", label: "Accessible interaction" },
        { id: "evidence", parentId: "question", label: "Evidence" },
        { id: "observations", parentId: "evidence", label: "Observed behavior" },
        { id: "constraints", parentId: "question", label: "Constraints" },
      ],
    },
  },
  {
    id: "explanation-tree",
    title: "Branching explanation",
    description: "A rooted tree of concepts, separate from numerical hierarchy charts.",
    renderer: "infographic",
    version: 1,
    content: {
      template: "hierarchy-tree-lr-curved-line-rounded-rect-node",
      items: [
        { id: "purpose", label: "Purpose" },
        { id: "understand", parentId: "purpose", label: "Understand" },
        { id: "evidence", parentId: "understand", label: "Evidence" },
        { id: "create", parentId: "purpose", label: "Create" },
        { id: "build-prototype", parentId: "create", label: "Prototype" },
      ],
    },
  },
  {
    id: "structured-comparison",
    title: "Comparison columns",
    description: "Compare alternatives with explicit headings and supporting items.",
    renderer: "infographic",
    version: 1,
    content: {
      template: "spatial-comparison-columns",
      items: [
        { id: "a", label: "Option A" },
        { id: "a-strength", parentId: "a", label: "Strength", desc: "State the evidence." },
        {
          id: "a-tradeoff",
          parentId: "a",
          label: "Trade-off",
          desc: "Make the constraint explicit.",
        },
        { id: "b", label: "Option B" },
        { id: "b-strength", parentId: "b", label: "Strength", desc: "Use the same criteria." },
        {
          id: "b-tradeoff",
          parentId: "b",
          label: "Trade-off",
          desc: "Preserve important differences.",
        },
      ],
    },
  },
  {
    id: "relationship-explanation",
    title: "Relationship explanation",
    description:
      "Draw the relationships you authored, including feedback and distinct edge labels.",
    renderer: "infographic",
    version: 1,
    content: {
      template: "relation-dagre-flow-lr-compact-card",
      items: [
        { id: "evidence", label: "Evidence", desc: "Observed results" },
        { id: "review", label: "Review", desc: "Interpret together" },
        { id: "change", label: "Change", desc: "Test the next step" },
      ],
      relations: [
        { id: "informs", from: "evidence", to: "review", label: "informs" },
        { id: "guides", from: "review", to: "change", label: "guides" },
        { id: "produces", from: "change", to: "evidence", label: "produces" },
      ],
    },
  },
  {
    id: "heatmap",
    title: "Coverage heatmap",
    description: "Illustrative rows: compare two categorical dimensions and their measurements.",
    renderer: "vega-lite",
    version: 1,
    content: {
      values: [
        { area: "Web", scenario: "Keyboard", value: 8 },
        { area: "Web", scenario: "Touch", value: 6 },
        { area: "Server", scenario: "Keyboard", value: 5 },
        { area: "Server", scenario: "Touch", value: 7 },
      ],
      spec: {
        mark: "rect",
        encoding: {
          x: { field: "scenario", type: "nominal", title: "Scenario", axis: { labelAngle: 0 } },
          y: { field: "area", type: "nominal", title: "Area" },
          color: { field: "value", type: "quantitative", title: "Measurement" },
          tooltip: [{ field: "area" }, { field: "scenario" }, { field: "value" }],
        },
      },
    },
  },
  {
    id: "distribution",
    title: "Distribution comparison",
    description: "Illustrative rows: show spread and outliers instead of only an average.",
    renderer: "vega-lite",
    version: 1,
    content: {
      values: [
        { group: "A", value: 4 },
        { group: "A", value: 5 },
        { group: "A", value: 7 },
        { group: "A", value: 12 },
        { group: "B", value: 3 },
        { group: "B", value: 6 },
        { group: "B", value: 8 },
        { group: "B", value: 9 },
      ],
      spec: {
        mark: { type: "boxplot", extent: "min-max" },
        encoding: {
          x: { field: "group", type: "nominal", title: "Group" },
          y: { field: "value", type: "quantitative", title: "Measurement", scale: { zero: true } },
        },
      },
    },
  },
  {
    id: "small-multiples",
    title: "Small multiples",
    description: "Illustrative rows: compare trends using repeated views with shared scales.",
    renderer: "vega-lite",
    version: 1,
    content: {
      values: [
        { service: "A", day: 1, value: 4 },
        { service: "A", day: 2, value: 7 },
        { service: "A", day: 3, value: 5 },
        { service: "B", day: 1, value: 3 },
        { service: "B", day: 2, value: 4 },
        { service: "B", day: 3, value: 8 },
      ],
      spec: {
        facet: { row: { field: "service", type: "nominal", title: "Service" } },
        spec: {
          width: 300,
          height: 120,
          mark: { type: "line", point: true },
          encoding: {
            x: { field: "day", type: "ordinal", title: "Day" },
            y: { field: "value", type: "quantitative", title: "Measurement" },
          },
        },
        resolve: { scale: { y: "shared" } },
      },
    },
  },
];
