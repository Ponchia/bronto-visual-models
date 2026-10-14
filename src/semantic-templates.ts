import type { VisualTemplate } from "./catalog.ts";
/** Illustrative records, never represented as live deployment or infrastructure data. */
export const SEMANTIC_TEMPLATES: readonly VisualTemplate[] = [
  {
    id: "architecture",
    title: "Editable architecture",
    description:
      "Identified services and relationships. Drag, connect, group and deliberately lay out.",
    renderer: "diagram",
    version: 1,
    content: {
      direction: "RIGHT",
      nodes: [
        { id: "client", label: "Client", entityId: "client", x: 0, y: 40, width: 180, height: 90 },
        {
          id: "service",
          label: "Service",
          entityId: "service",
          x: 300,
          y: 40,
          width: 180,
          height: 90,
        },
        {
          id: "storage",
          label: "Storage",
          entityId: "storage",
          x: 600,
          y: 40,
          width: 180,
          height: 90,
        },
      ],
      edges: [
        { id: "request", label: "request", source: "client", target: "service" },
        { id: "persist", label: "persist", source: "service", target: "storage" },
      ],
    },
  },
  {
    id: "timeline",
    title: "Events and swimlanes",
    description: "Illustrative phases on an explicitly dated timeline; not a schedule executor.",
    renderer: "timeline",
    version: 1,
    content: {
      lanes: [
        { id: "work", label: "Delivery" },
        { id: "review", label: "Review" },
      ],
      events: [
        {
          id: "design",
          label: "Design",
          lane: "work",
          start: 1789862400000,
          end: 1789948800000,
          entityId: "client",
        },
        {
          id: "verify",
          label: "Verify",
          lane: "review",
          start: 1789948800000,
          end: 1790035200000,
          entityId: "service",
        },
      ],
    },
  },
  {
    id: "gantt",
    title: "Editable Gantt plan",
    description:
      "Scheduled workstreams with task ranges, progress, milestones and explicit dependencies.",
    renderer: "gantt",
    version: 1,
    content: {
      workstreams: [
        { id: "delivery", label: "Delivery" },
        { id: "assurance", label: "Assurance" },
      ],
      tasks: [
        {
          id: "baseline",
          label: "Establish baseline",
          description: "Capture current evidence and scope before changing controls.",
          workstream: "delivery",
          start: 1789862400000,
          end: 1790121600000,
          progress: 100,
          status: "done",
          owner: "Delivery",
        },
        {
          id: "implement",
          label: "Implement controls",
          workstream: "delivery",
          start: 1790121600000,
          end: 1790726400000,
          progress: 35,
          status: "active",
          owner: "Engineering",
        },
        {
          id: "review",
          label: "Independent review",
          workstream: "assurance",
          start: 1790726400000,
          milestone: true,
          progress: 0,
          status: "planned",
          owner: "Security",
        },
      ],
      dependencies: [
        {
          id: "baseline-implement",
          label: "Baseline before implementation",
          source: "baseline",
          target: "implement",
          type: "finish-to-start",
        },
        {
          id: "implement-review",
          label: "Implementation before review",
          source: "implement",
          target: "review",
          type: "finish-to-start",
        },
      ],
    },
  },
  {
    id: "weighted-flow",
    title: "Weighted flow",
    description: "Illustrative acyclic supply and use; link widths encode quantities.",
    renderer: "analysis",
    version: 1,
    content: {
      layout: "sankey",
      nodes: [
        { id: "supply", label: "Supply" },
        { id: "use", label: "Useful work" },
        { id: "loss", label: "Other use" },
      ],
      links: [
        { id: "used", label: "Used", source: "supply", target: "use", value: 70 },
        { id: "other", label: "Other", source: "supply", target: "loss", value: 30 },
      ],
    },
  },
  {
    id: "hierarchy",
    title: "Hierarchy and treemap",
    description: "Illustrative service composition with identified leaf values.",
    renderer: "analysis",
    version: 1,
    content: {
      layout: "treemap",
      nodes: [
        { id: "system", label: "System", value: 0 },
        { id: "client", label: "Client", parentId: "system", entityId: "client", value: 35 },
        { id: "service", label: "Service", parentId: "system", entityId: "service", value: 45 },
        { id: "storage", label: "Storage", parentId: "system", entityId: "storage", value: 20 },
      ],
    },
  },
  {
    id: "parallel",
    title: "Multivariable comparison",
    description: "Compare identified options across explicit numeric dimensions.",
    renderer: "analysis",
    version: 1,
    content: {
      layout: "parallel",
      dimensions: ["cost", "capacity", "latency"],
      nodes: [
        { id: "a", label: "Option A", metrics: { cost: 20, capacity: 80, latency: 30 } },
        { id: "b", label: "Option B", metrics: { cost: 50, capacity: 95, latency: 10 } },
        { id: "c", label: "Option C", metrics: { cost: 10, capacity: 35, latency: 70 } },
      ],
    },
  },
  {
    id: "geography",
    title: "Geographic features",
    description:
      "Local illustrative point and route geometry; no external basemap, tile service or location request.",
    renderer: "geography",
    version: 1,
    content: {
      center: [0, 40],
      zoom: 3,
      features: [
        {
          id: "site-a",
          label: "Illustrative site A",
          entityId: "client",
          geometry: { type: "Point", coordinates: [-3, 40] },
        },
        {
          id: "site-b",
          label: "Illustrative site B",
          entityId: "service",
          geometry: { type: "Point", coordinates: [3, 43] },
        },
        {
          id: "route",
          label: "Illustrative route",
          geometry: {
            type: "LineString",
            coordinates: [
              [-3, 40],
              [0, 42],
              [3, 43],
            ],
          },
        },
      ],
    },
  },
];
