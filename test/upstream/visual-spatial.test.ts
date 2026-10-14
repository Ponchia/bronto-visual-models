import assert from "node:assert/strict";
import test from "node:test";
import {
  modelTargets,
  resolveSpatialLayers,
  resolveVisualProjection,
  type Scene3DContent,
  type SpatialLayersContent,
  VISUAL_TEMPLATES,
  validateVisualContent,
} from "../../src/index.ts";

const cohorts = () =>
  structuredClone(
    VISUAL_TEMPLATES.find((template) => template.id === "spatial-cohorts")?.content,
  ) as SpatialLayersContent;
const scene = () =>
  structuredClone(
    VISUAL_TEMPLATES.find((template) => template.id === "scene3d")?.content,
  ) as Scene3DContent;

test("cohort projections keep source identity and distinguish real values from 3D geometry", () => {
  const content = cohorts(),
    before = structuredClone(content);
  validateVisualContent("spatial-layers", "spatial", content);
  const resolved = resolveSpatialLayers(content, content.rows);
  assert.equal(resolved[0]?.data.length, 6);
  const web = resolved[0]?.data.filter((item) => item.source.module === "Web");
  assert.equal(web?.[0]?.position[2], 0);
  assert.equal(web?.[1]?.position[2], 32);
  assert.equal(web?.[1]?.height, 18);
  assert.equal(web?.[1]?.id, "web-b");
  assert.equal(
    resolveVisualProjection({ renderer: "spatial-layers", content }, "layers-2d"),
    "layers-2d",
  );
  assert.equal(
    resolveVisualProjection({ renderer: "spatial-layers", content }, "network"),
    undefined,
  );
  assert.deepEqual(content, before);
});

test("spatial data refuses ambiguous sources, invalid geometry and unbounded coordinates", () => {
  const content = cohorts();
  for (const bad of [
    { ...content, rows: [...content.rows, content.rows[0]] },
    { ...content, rows: [{ id: "a", module: "A", period: "Now", value: -1 }] },
    { ...content, datasource: "dataset", params: { dataset: "bronto/data" } },
    { ...content, params: { dataset: "bronto/data" } },
    { ...content, coordinateSystem: "lnglat", unit: "m" },
    { ...content, layers: [{ id: "bad", label: "Bad", type: "points", x: "x" }] },
    { ...content, layers: [{ ...content.layers[0], getPosition: "fetch('/private')" }] },
  ])
    assert.throws(() => validateVisualContent("spatial-layers", "spatial", bad));
  const bound = {
    ...content,
    rows: [],
    datasource: "dataset" as const,
    params: { dataset: "bronto/data", revision: 3 },
  };
  validateVisualContent("spatial-layers", "spatial", bound);
  const rows = content.rows.map((row) => ({ ...row, rowId: `source-${row.id}` }));
  assert.ok(
    resolveSpatialLayers(bound, rows)[0]?.data.every((item) => item.id.startsWith("source-")),
  );
  const geography: SpatialLayersContent = {
    coordinateSystem: "lnglat",
    unit: "m",
    rows: [{ id: "p", x: 20, y: 30 }],
    layers: [{ id: "p", label: "Places", type: "points", x: "x", y: "y" }],
  };
  validateVisualContent("spatial-layers", "spatial", geography);
  for (const xy of [
    [181, 0],
    [0, 86],
    [null, 30],
    ["20", 30],
  ])
    assert.throws(() =>
      validateVisualContent("spatial-layers", "spatial", {
        ...geography,
        rows: [{ id: "p", x: xy[0], y: xy[1] }],
      }),
    );
});

test("layer paths and polygons remain local coordinate data with explicit closure", () => {
  const content: SpatialLayersContent = {
    coordinateSystem: "cartesian",
    unit: "data",
    rows: [
      {
        id: "a",
        coordinates: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 0],
        ],
      },
    ],
    layers: [{ id: "area", label: "Area", type: "polygons", path: "coordinates" }],
  };
  validateVisualContent("spatial-layers", "spatial", content);
  assert.deepEqual(resolveSpatialLayers(content, content.rows)[0]?.data[0]?.path?.[0], [0, 0, 0]);
  assert.throws(
    () =>
      validateVisualContent("spatial-layers", "spatial", {
        ...content,
        rows: [
          {
            id: "a",
            coordinates: [
              [0, 0],
              [4, 0],
              [4, 4],
              [0, 4],
            ],
          },
        ],
      }),
    /closed/,
  );
  assert.throws(
    () =>
      validateVisualContent("spatial-layers", "spatial", {
        ...content,
        rows: [{ id: "a", coordinates: "https://example.test/geometry" }],
      }),
    /coordinate/,
  );
});

test("scene assets and objects have independent stable identities and bounded parent relationships", () => {
  const content = scene();
  validateVisualContent("scene3d", "scene3d", content);
  assert.equal(content.nodes.length, 3);
  const asset = {
    id: "asset",
    label: "Object",
    path: "/workspace/model.glb",
    sha256: "a".repeat(64),
  };
  const assetNode = { id: "instance", label: "Placed object", assetId: "asset", parentId: "base" };
  validateVisualContent("scene3d", "scene3d", {
    ...content,
    assets: [asset],
    nodes: [...content.nodes, assetNode],
  });
  for (const bad of [
    { ...content, assets: [{ ...asset, path: "https://example.test/model.glb" }] },
    { ...content, assets: [{ ...asset, sha256: "latest" }] },
    { ...content, nodes: [...content.nodes, assetNode] },
    { ...content, nodes: [{ id: "a", label: "A", shape: "box", parentId: "a" }] },
    {
      ...content,
      nodes: [{ id: "a", label: "A", shape: "box", assetId: "asset" }],
      assets: [asset],
    },
    { ...content, nodes: [{ id: "a", label: "A", shape: "box", scale: [0, 1, 1] }] },
  ])
    assert.throws(() => validateVisualContent("scene3d", "scene3d", bad));
  assert.equal(
    modelTargets({
      id: "scene",
      generation: "g",
      revision: 1,
      renderer: "scene3d",
      content,
    } as never).filter((item) => item.collection === "nodes").length,
    3,
  );
});

test("cohort grouping never sums repeated snapshots and category colors follow the declared field", () => {
  const content = cohorts();
  content.rows = content.rows.map(({ color: _color, ...row }) => row);
  const layer = content.layers[0];
  assert.ok(layer);
  delete layer.colorField;
  layer.colorBy = "period";
  const resolved = resolveSpatialLayers(content, content.rows)[0];
  assert.ok(resolved);
  const week1 = resolved.data.filter((item) => item.source.period === "Week 1");
  assert.deepEqual(week1[0]?.color, week1[1]?.color);
  assert.notDeepEqual(resolved.data[0]?.color, resolved.data[1]?.color);
  assert.throws(
    () =>
      resolveSpatialLayers(content, [
        ...content.rows,
        { ...content.rows[0], id: "another-snapshot" },
      ]),
    /one snapshot/,
  );
});

test("placed asset budgets also apply when a view reuses unchanged pinned mesh bytes", async () => {
  const { validatePlacedAssetBudget } = await import("../../src/scene3d.ts");
  const content = scene();
  const asset = {
    path: "/workspace/mesh.glb",
    sha256: "a".repeat(64),
    bytes: 100,
    vertices: 500000,
    primitives: 300,
    nodes: 1,
    animations: [],
    texturePixels: 16000000,
    warnings: [],
  };
  content.nodes = [
    { id: "first", label: "First", assetId: "asset" },
    { id: "second", label: "Second", assetId: "asset" },
  ];
  validatePlacedAssetBudget(content, { asset });
  content.nodes.push({ id: "third", label: "Third", assetId: "asset" });
  assert.throws(() => validatePlacedAssetBudget(content, { asset }), /one million/);
  content.nodes = [];
  assert.throws(
    () => validatePlacedAssetBudget(content, { a: asset, b: asset, c: asset }),
    /texture/,
  );
});
