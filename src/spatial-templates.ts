import type { VisualTemplate } from "./catalog.ts";

export const SPATIAL_TEMPLATES: readonly VisualTemplate[] = [
  {
    id: "spatial-cohorts",
    title: "Cohort columns",
    description:
      "Illustrative category/period rows become stacked columns or a flat comparison without materialized scene geometry.",
    renderer: "spatial-layers",
    version: 1,
    content: {
      coordinateSystem: "cartesian",
      unit: "data",
      rows: [
        { id: "web-a", module: "Web", period: "Week 1", value: 32, color: "#b5cfee" },
        { id: "web-b", module: "Web", period: "Week 2", value: 18, color: "#447fbe" },
        { id: "server-a", module: "Server", period: "Week 1", value: 24, color: "#b5cfee" },
        { id: "server-b", module: "Server", period: "Week 2", value: 28, color: "#447fbe" },
        { id: "shared-a", module: "Shared", period: "Week 1", value: 16, color: "#b5cfee" },
        { id: "shared-b", module: "Shared", period: "Week 2", value: 12, color: "#447fbe" },
      ],
      layers: [
        {
          id: "cohorts",
          label: "Cohorts by module",
          type: "columns",
          colorField: "color",
          stack: { category: "module", series: "period", value: "value", scale: 1, spacing: 22 },
        },
      ],
    },
  },
  {
    id: "spatial-routes",
    title: "Layered points and paths",
    description:
      "Combine identified points and a path in Cartesian space; source IDs stay available for discussion.",
    renderer: "spatial-layers",
    version: 1,
    content: {
      coordinateSystem: "cartesian",
      unit: "data",
      rows: [
        {
          id: "a",
          label: "Start",
          x: -30,
          y: -10,
          z: 0,
          coordinates: [
            [-30, -10, 0],
            [0, 25, 10],
            [30, 0, 0],
          ],
        },
        {
          id: "b",
          label: "Destination",
          x: 30,
          y: 0,
          z: 0,
          coordinates: [
            [30, 0, 0],
            [45, 15, 5],
          ],
        },
      ],
      layers: [
        {
          id: "points",
          label: "Locations",
          type: "points",
          x: "x",
          y: "y",
          z: "z",
          labelField: "label",
          radius: 2,
        },
        {
          id: "routes",
          label: "Routes",
          type: "paths",
          path: "coordinates",
          color: "#c58642",
          width: 3,
        },
      ],
    },
  },
  {
    id: "scene3d",
    title: "3D composition",
    description:
      "Compose real glTF/GLB assets and simple primitives. Units, object identity and pinned assets are explicit.",
    renderer: "scene3d",
    version: 1,
    content: {
      unit: "data",
      ground: false,
      assets: [],
      viewpoints: [],
      nodes: [
        {
          id: "base",
          label: "Platform",
          shape: "box",
          position: [0, -0.3, 0],
          size: [6, 0.6, 5],
          color: "#52758f",
        },
        {
          id: "sphere",
          label: "Sphere",
          shape: "sphere",
          position: [-1.2, 1, 0],
          size: [2, 2, 2],
          color: "#d6a362",
        },
        {
          id: "tower",
          label: "Tower",
          shape: "box",
          position: [1.3, 1.5, 0],
          size: [1.2, 3, 1.2],
          color: "#77a8b3",
        },
      ],
    },
  },
];
