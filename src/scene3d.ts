import { VISUAL_RECORD_ID_SCHEMA as id, VisualModelError } from "./model.ts";
import {
  isSceneView,
  locateSceneMeasures,
  MAX_SCENE_FOG,
  MAX_SCENE_MEASURES,
  type ResolvedSceneMeasure,
  SCENE_FINISHES,
  SCENE_LENGTH_UNITS,
  SCENE_LIGHTS,
  type SceneFinish,
  type SceneLengthUnit,
  type SceneLight,
  type SceneLightRig,
  type SceneMeasure,
  type SceneView,
  sceneLightRig,
} from "./scene-look.ts";

const label = { type: "string", minLength: 1, maxLength: 240 };
const number = { type: "number", minimum: -1000000, maximum: 1000000 };
const vector = { type: "array", items: number, minItems: 3, maxItems: 3 };
const size = {
  type: "array",
  items: { type: "number", exclusiveMinimum: 0, maximum: 1000000 },
  minItems: 3,
  maxItems: 3,
};
const color = { type: "string", pattern: "^#[0-9a-fA-F]{6}$" };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const SCENE_3D_SCHEMA = object(
  {
    unit: { type: "string", enum: ["data", ...SCENE_LENGTH_UNITS] },
    ground: { type: "boolean" },
    // The paper behind the scene, and what distance fades into. Absent takes
    // the light's own sky, and a scene with neither follows the theme.
    background: color,
    // The hour the scene is lit at; absent keeps scene3d's own bright rig.
    light: { type: "string", enum: [...SCENE_LIGHTS] },
    fog: { type: "number", minimum: 0, maximum: MAX_SCENE_FOG },
    // Where the scene opens: a canned angle or one of its viewpoints' ids.
    view: { type: "string", minLength: 1, maxLength: 64 },
    assets: {
      type: "array",
      maxItems: 4,
      items: object(
        {
          id,
          label,
          path: { type: "string", minLength: 1, maxLength: 4096 },
          sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        },
        ["id", "label", "path", "sha256"],
      ),
    },
    nodes: {
      type: "array",
      maxItems: 600,
      items: object(
        {
          id,
          label,
          entityId: id,
          parentId: id,
          assetId: id,
          shape: {
            type: "string",
            enum: ["box", "sphere", "cylinder", "cone", "torus", "plane", "group"],
          },
          position: vector,
          rotation: vector,
          scale: size,
          size,
          color,
          opacity: { type: "number", minimum: 0, maximum: 1 },
          roughness: { type: "number", minimum: 0, maximum: 1 },
          metalness: { type: "number", minimum: 0, maximum: 1 },
          sides: { type: "integer", minimum: 3, maximum: 64 },
          visible: { type: "boolean" },
          // How the surface takes the light. Explicit roughness and metalness win.
          finish: { type: "string", enum: [...SCENE_FINISHES] },
          // The colour a primitive fades to at its underside.
          shade: color,
        },
        ["id", "label"],
      ),
    },
    viewpoints: {
      type: "array",
      maxItems: 12,
      items: object({ id, label, position: vector, target: vector }, [
        "id",
        "label",
        "position",
        "target",
      ]),
    },
    // Dimension lines between two placed objects, centre to centre.
    measures: {
      type: "array",
      maxItems: MAX_SCENE_MEASURES,
      items: object({ id, from: id, to: id, label }, ["id", "from", "to"]),
    },
    source: object(
      {
        modelId: id,
        revision: { type: "integer", minimum: 1 },
        at: { type: "number", minimum: 0, maximum: 600 },
        qualifications: { type: "array", maxItems: 16, items: { type: "string", maxLength: 1000 } },
      },
      ["modelId", "revision", "at", "qualifications"],
    ),
  },
  ["unit", "nodes", "assets", "viewpoints"],
);

interface SceneAsset {
  id: string;
  label: string;
  path: string;
  sha256: string;
}
export interface SceneNode {
  id: string;
  label: string;
  entityId?: string;
  parentId?: string;
  assetId?: string;
  shape?: "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane" | "group";
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  size?: [number, number, number];
  color?: string;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  sides?: number;
  visible?: boolean;
  finish?: SceneFinish;
  shade?: string;
}
export interface SceneViewpoint {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}
export interface Scene3DContent extends Record<string, unknown> {
  unit: "data" | SceneLengthUnit;
  ground?: boolean;
  background?: string;
  light?: SceneLight;
  fog?: number;
  view?: string;
  assets: SceneAsset[];
  nodes: SceneNode[];
  viewpoints: SceneViewpoint[];
  measures?: Array<Omit<SceneMeasure, "label"> & { label?: string }>;
  source?: { modelId: string; revision: number; at: number; qualifications: string[] };
}
export interface SceneAssetDescription {
  path: string;
  sha256: string;
  bytes: number;
  vertices: number;
  primitives: number;
  nodes: number;
  animations: string[];
  texturePixels: number;
  warnings: string[];
}
export interface ResolvedSceneAsset extends SceneAssetDescription {
  json: Record<string, unknown>;
}

export function validateScene3D(value: Record<string, unknown>) {
  const content = value as Scene3DContent;
  const assets = new Map(content.assets.map((asset) => [asset.id, asset]));
  const nodes = new Map(content.nodes.map((node) => [node.id, node]));
  for (const asset of content.assets) {
    if (
      !asset.path.startsWith("/") ||
      asset.path.includes("\0") ||
      !/\.(gltf|glb)$/i.test(asset.path)
    )
      throw new VisualModelError(
        "invalid",
        "3D assets require absolute workspace .gltf or .glb paths.",
      );
  }
  for (const node of content.nodes) {
    if (Boolean(node.shape) === Boolean(node.assetId))
      throw new VisualModelError(
        "invalid",
        "A scene node has either a primitive shape or one asset reference.",
      );
    if (node.assetId && !assets.has(node.assetId))
      throw new VisualModelError("invalid", "A scene node refers to a missing asset.");
    const seen = new Set([node.id]);
    let parent = node.parentId;
    while (parent) {
      if (seen.has(parent) || seen.size >= 24)
        throw new VisualModelError(
          "invalid",
          "Scene parenting must be acyclic and at most 24 levels deep.",
        );
      const entry = nodes.get(parent);
      if (!entry) throw new VisualModelError("invalid", "Scene parents must be existing nodes.");
      seen.add(parent);
      parent = entry.parentId;
    }
  }
  if (
    content.view !== undefined &&
    !isSceneView(content.view) &&
    !content.viewpoints.some((viewpoint) => viewpoint.id === content.view)
  )
    throw new VisualModelError(
      "invalid",
      "A scene opens at a canned view (corner, front, side or top) or at one of its own viewpoints.",
    );
  // Measure ids are unique by the catalog's record identity rule.
  for (const measure of content.measures ?? []) {
    if (!nodes.has(measure.from) || !nodes.has(measure.to))
      throw new VisualModelError("invalid", "A scene measure joins two existing scene nodes.");
    if (measure.from === measure.to)
      throw new VisualModelError("invalid", "A scene measure joins two different scene nodes.");
  }
}

/*
  The rig a scene3d scene had before it could name an hour: brighter than the
  `neutral` one, because glTF assets arrive with physically based
  materials. A scene that names no hour keeps it, so nothing already composed
  changes its light.
*/
const SCENE3D_RIG: SceneLightRig = {
  ambient: { color: "#ffffff", intensity: 1.2 },
  hemisphere: { sky: "#ffffff", ground: "#ffffff", intensity: 0 },
  key: { color: "#ffffff", intensity: 2.5 },
  fill: { color: "#ffffff", intensity: 0.6 },
  sky: null,
};

/*
  The canned angle a name asks for in this scene, if any.

  The scene's own viewpoint wins over a canned angle of the same name: scene3d
  saved viewpoints before it had canned angles, so a place an author named
  `top` stays the place they saved.
*/
export function scene3dCannedView(
  content: Pick<Scene3DContent, "viewpoints">,
  name: string | undefined,
): SceneView | undefined {
  return isSceneView(name) && !content.viewpoints.some((viewpoint) => viewpoint.id === name)
    ? name
    : undefined;
}

export function scene3dLightRig(content: Pick<Scene3DContent, "light">): SceneLightRig {
  return content.light ? sceneLightRig(content.light) : SCENE3D_RIG;
}

type Vector = [number, number, number];
type Matrix = [number, number, number, number, number, number, number, number, number];
interface Affine {
  /** Row-major 3x3: rotation times scale. */
  m: Matrix;
  t: Vector;
}

/** three.js's default `XYZ` Euler order, so a placed object's numbers mean here what they mean on screen. */
function local(node: SceneNode): Affine {
  const [x, y, z] = node.rotation ?? [0, 0, 0];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [a, b, c, d, e, f] = [
    Math.cos(x),
    Math.sin(x),
    Math.cos(y),
    Math.sin(y),
    Math.cos(z),
    Math.sin(z),
  ];
  return {
    m: [
      c * e * sx,
      -c * f * sy,
      d * sz,
      (a * f + b * e * d) * sx,
      (a * e - b * f * d) * sy,
      -b * c * sz,
      (b * f - a * e * d) * sx,
      (b * e + a * f * d) * sy,
      a * c * sz,
    ],
    t: [...(node.position ?? [0, 0, 0])],
  };
}

function apply({ m, t }: Affine, [x, y, z]: Vector): Vector {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [a * x + b * y + c * z + t[0], d * x + e * y + f * z + t[1], g * x + h * y + i * z + t[2]];
}

function compose(parent: Affine, child: Affine): Affine {
  const [a, b, c, d, e, f, g, h, i] = parent.m;
  const [j, k, l, m, n, o, p, q, r] = child.m;
  return {
    m: [
      a * j + b * m + c * p,
      a * k + b * n + c * q,
      a * l + b * o + c * r,
      d * j + e * m + f * p,
      d * k + e * n + f * q,
      d * l + e * o + f * r,
      g * j + h * m + i * p,
      g * k + h * n + i * q,
      g * l + h * o + i * r,
    ],
    t: apply(parent, child.t),
  };
}

/**
 * Where each placed object's origin is in the world, through its parents'
 * position, rotation and scale. A primitive is centred on its origin, so this
 * is the centre a dimension line runs to; `size` shapes the mesh and moves
 * nothing beneath it.
 */
export function scene3dWorldPositions(content: Scene3DContent): Map<string, Vector> {
  const nodes = new Map(content.nodes.map((node) => [node.id, node]));
  const frames = new Map<string, Affine>();
  const frame = (node: SceneNode, depth = 0): Affine => {
    const known = frames.get(node.id);
    if (known) return known;
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    const own = local(node);
    const world = parent && depth < 24 ? compose(frame(parent, depth + 1), own) : own;
    frames.set(node.id, world);
    return world;
  };
  return new Map(content.nodes.map((node) => [node.id, frame(node).t]));
}

/** The scene's dimension lines, located; `radius` is the scene's own size. */
export function resolveScene3DMeasures(
  content: Scene3DContent,
  radius: number,
): ResolvedSceneMeasure[] {
  if (!content.measures?.length) return [];
  return locateSceneMeasures(
    content.measures.map((measure) => ({ ...measure, label: measure.label ?? "" })),
    scene3dWorldPositions(content),
    content.unit === "data" ? null : content.unit,
    radius,
  );
}

/** Apply the same amplification limit after every placed-object edit, even
 * when unchanged, hash-pinned asset payloads are reused by the browser. */
export function validatePlacedAssetBudget(
  content: Scene3DContent,
  assets: Record<string, SceneAssetDescription>,
): void {
  const vertices = content.nodes.reduce(
    (sum, node) => sum + (node.assetId ? (assets[node.assetId]?.vertices ?? 0) : 0),
    0,
  );
  const draws = content.nodes.reduce(
    (sum, node) => sum + (node.assetId ? (assets[node.assetId]?.primitives ?? 0) : 1),
    0,
  );
  const texturePixels = Object.values(assets).reduce((sum, asset) => sum + asset.texturePixels, 0);
  if (vertices > 1000000 || draws > 1200 || texturePixels > 32000000)
    throw new VisualModelError(
      "invalid",
      "Placed assets exceed one million vertices, 1200 mesh primitives or 32 million texture pixels. Simplify the scene before rendering.",
    );
}
