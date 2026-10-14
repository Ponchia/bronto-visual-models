/*
  How a 3D scene LOOKS: the hour it is lit at, how a surface takes the light,
  the canned angles it opens at, the air between the camera and the subject,
  and how a length is written on a dimension line.

  Small closed vocabularies with the renderer numbers behind them, and the
  arithmetic that places a camera or a label. No three.js and no React: the
  scene3d family's schema and the browser that draws a scene both answer from
  these, so there is one table per question rather than one per surface.
*/

/*
  The viewpoint a scene OPENS at — not where anybody is looking now.

  The camera itself is device state and stays out of the document for the same
  reason as the canvas camera: syncing it would drag one reader's view around
  another reader's screen. What IS worth sharing is the author's answer to
  "which way round is this thing" — a floor plan reads from `top`, a facade
  from `front` — so a visitor's camera starts there and is theirs from then on.
*/
export const SCENE_VIEWS = ["corner", "front", "side", "top"] as const;
export type SceneView = (typeof SCENE_VIEWS)[number];

/*
  The hour the scene is lit at, as a word rather than as four light rigs.

  A small closed vocabulary of HOURS, not a light editor. Each one carries a
  key colour, a fill, an ambient, a hemisphere and the sky it wants, chosen
  together — a warm key against a cool fill, which is the hue-shifting rule
  stylised art runs on, rather than one dimmer per lamp for an author to
  balance. The light is what says where you are: an underwater bank lit like a
  noon lawn reads as a sand pile in an empty room.
*/
export const SCENE_LIGHTS = [
  "neutral",
  "golden-hour",
  "overcast",
  "underwater",
  "moonlight",
  "studio",
] as const;
export type SceneLight = (typeof SCENE_LIGHTS)[number];

/*
  How a surface takes the light, as a small closed vocabulary rather than the
  three renderer numbers behind it.

  A scene of primitives has no texture to tell you what a thing is made of:
  water in a pond and the pane of a lantern read as the same matte plastic as
  the stone beside them. An author picks the word; the mapping is the
  renderer's business.
*/
export const SCENE_FINISHES = ["matte", "satin", "glossy", "metal", "glass", "glow"] as const;
export type SceneFinish = (typeof SCENE_FINISHES)[number];

/*
  What one world unit IS, when the author wants it to be something. This
  labels and does not scale: one unit is one unit whatever it is called.
*/
export const SCENE_LENGTH_UNITS = ["mm", "cm", "m", "km", "in", "ft"] as const;
export type SceneLengthUnit = (typeof SCENE_LENGTH_UNITS)[number];

/*
  How much of the scene's own depth the air takes, 0 to 1.

  Written as a STRENGTH rather than as near and far planes because the camera
  moves — a viewpoint saved from across the scene and one saved from inside it
  would need different numbers for the same look.
*/
export const MAX_SCENE_FOG = 1;

/*
  Dimension lines. Bounded low on purpose: a measurement is an ANSWER — how
  wide is the gap, does the bench reach the wall — and a scene wearing two
  dozen of them has stopped answering anything. Each one also costs a DOM label
  over the canvas.
*/
export const MAX_SCENE_MEASURES = 24;

type Vector = readonly [number, number, number];

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export interface SceneSurface {
  roughness: number;
  metalness: number;
  /** Emissive strength, 0 when the part is not lit from inside. */
  glow: number;
  /** Multiplies the part's own opacity; only `glass` is below 1. */
  transparency: number;
}

const SURFACES: Readonly<Record<SceneFinish, SceneSurface>> = {
  matte: { roughness: 0.95, metalness: 0.02, glow: 0, transparency: 1 },
  satin: { roughness: 0.72, metalness: 0.04, glow: 0, transparency: 1 },
  glossy: { roughness: 0.24, metalness: 0.06, glow: 0, transparency: 1 },
  metal: { roughness: 0.3, metalness: 0.9, glow: 0, transparency: 1 },
  // Glass without an opacity of its own is glass nobody can see through, which
  // is the one case where a finish has to touch a field the author also owns.
  glass: { roughness: 0.06, metalness: 0, glow: 0, transparency: 0.45 },
  glow: { roughness: 0.6, metalness: 0, glow: 0.6, transparency: 1 },
};

/** The surface a finish names; an unknown or absent finish is satin. */
export function sceneSurface(finish: string | undefined): SceneSurface {
  return SURFACES[(finish ?? "satin") as SceneFinish] ?? SURFACES.satin;
}

interface SceneLamp {
  color: string;
  intensity: number;
}

export interface SceneLightRig {
  ambient: SceneLamp;
  hemisphere: { sky: string; ground: string; intensity: number };
  /** High and to one side, and the only one that casts. */
  key: SceneLamp;
  /** Weak and opposite, so the unlit faces do not all go to one black. */
  fill: SceneLamp;
  /** The background this hour wants, or null to keep the canvas's own paper. */
  sky: string | null;
}

/*
  The hours, written as whole rigs rather than as sliders.

  Every one of them obeys the same rule, which is the rule stylised painting
  runs on: THE FILL IS THE OPPOSITE HUE TO THE KEY. A warm key with a cool fill
  is what gives an untextured solid two different colours to be, and it is why a
  white sphere under `golden-hour` reads as sunlit rather than as beige. Shifting
  only brightness — the mistake this table exists to prevent — gives the same
  sphere two greys and a flat picture.

  `neutral` reproduces the retired diorama family's fixed rig exactly, to the
  number, because every diorama converted into scene3d was stamped with it. That
  is also why it has no sky: a scene that says nothing keeps the canvas's own
  paper and follows the operator's theme.
*/
const LIGHT_RIGS: Readonly<Record<SceneLight, SceneLightRig>> = {
  neutral: {
    ambient: { color: "#ffffff", intensity: 0.55 },
    hemisphere: { sky: "#ffffff", ground: "#4a4a52", intensity: 0.45 },
    key: { color: "#ffffff", intensity: 1.15 },
    fill: { color: "#ffffff", intensity: 0.3 },
    sky: null,
  },
  "golden-hour": {
    ambient: { color: "#ffe6cd", intensity: 0.42 },
    hemisphere: { sky: "#ffd9a0", ground: "#5b6fa8", intensity: 0.5 },
    key: { color: "#ffd2a1", intensity: 1.3 },
    fill: { color: "#8ea6d6", intensity: 0.36 },
    sky: "#f4dcbc",
  },
  overcast: {
    ambient: { color: "#eaf0f6", intensity: 0.8 },
    hemisphere: { sky: "#f2f6fa", ground: "#8d949c", intensity: 0.6 },
    key: { color: "#e3eaf1", intensity: 0.72 },
    fill: { color: "#dbe3ec", intensity: 0.5 },
    sky: "#e4eaf0",
  },
  underwater: {
    ambient: { color: "#8ed0e8", intensity: 0.5 },
    hemisphere: { sky: "#a6e6fb", ground: "#0d3550", intensity: 0.68 },
    key: { color: "#d6f5ff", intensity: 1.05 },
    fill: { color: "#2c6e96", intensity: 0.46 },
    sky: "#3f92bd",
  },
  moonlight: {
    ambient: { color: "#46598a", intensity: 0.34 },
    hemisphere: { sky: "#93a7e6", ground: "#12162a", intensity: 0.44 },
    key: { color: "#c3d2ff", intensity: 0.8 },
    fill: { color: "#4a5b93", intensity: 0.26 },
    sky: "#141a30",
  },
  studio: {
    ambient: { color: "#ffffff", intensity: 0.72 },
    hemisphere: { sky: "#ffffff", ground: "#cfd3d8", intensity: 0.5 },
    key: { color: "#ffffff", intensity: 1.45 },
    fill: { color: "#ffffff", intensity: 0.6 },
    sky: "#eef0f2",
  },
};

/** The rig an hour names; an unknown or absent hour is the neutral one. */
export function sceneLightRig(light: unknown): SceneLightRig {
  return (
    LIGHT_RIGS[(typeof light === "string" ? light : "neutral") as SceneLight] ?? LIGHT_RIGS.neutral
  );
}

/*
  Haze strength turned into an exponential-squared density, per world unit.

  Scaled by the scene's OWN radius rather than given in absolute units, which is
  the only way one number can mean the same thing on a 3-unit figurine and a
  200-unit valley — a density that reads as morning air on one is a white wall
  on the other. Exponential rather than a near/far pair for the reason the field
  is a strength at all: near and far are answers about where the camera is, and
  every saved viewpoint stands somewhere else.
*/
export function sceneFogDensity(strength: unknown, radius: number): number {
  if (typeof strength !== "number" || !Number.isFinite(strength)) return 0;
  const air = clamp(strength, 0, MAX_SCENE_FOG);
  if (air <= 0) return 0;
  /*
    The square root is what makes the knob usable rather than tidy.

    Exponential-squared fog raises `density * distance` to the power of two, so
    a strength fed in linearly spends most of its travel doing nothing and then
    all of it at the top: 0.35 came out as three percent of haze — invisible —
    while 1 whited the scene out. Taking the root spreads the visible range over
    the slider instead, so a third of the way along looks like a third of the
    way along.
  */
  return (Math.sqrt(air) * 0.45) / Math.max(radius, 0.5);
}

export interface SceneBounds {
  center: Vector;
  radius: number;
}

export interface ScenePose {
  position: Vector;
  target: Vector;
}

// Unit directions, one per canned view. `corner` is the three-quarter view that
// shows three faces of a box at once, which is why it is the default.
const VIEW_DIRECTIONS: Readonly<Record<SceneView, Vector>> = {
  corner: [0.72, 0.52, 0.72],
  front: [0, 0.22, 1],
  side: [1, 0.22, 0],
  // Not straight down: an exactly vertical camera has no unambiguous up vector,
  // and orbit controls answer that by flipping the scene as you cross the pole.
  top: [0.001, 1, 0.35],
};

export function isSceneView(value: unknown): value is SceneView {
  return typeof value === "string" && (SCENE_VIEWS as readonly string[]).includes(value);
}

/**
 * Where a canned view stands for a scene of these bounds: aimed at the
 * subject's own centre, far enough back to see all of it.
 *
 * The centre matters as much as the distance: aiming at the world origin puts
 * a building in the top half of the frame with an empty field under it,
 * because a building stands ON the ground rather than around it.
 */
export function scenePose(view: SceneView, bounds: SceneBounds): ScenePose {
  const direction = VIEW_DIRECTIONS[view] ?? VIEW_DIRECTIONS.corner;
  const length = Math.hypot(...direction) || 1;
  const distance = Math.max(4, bounds.radius * 2.4);
  return {
    position: [
      bounds.center[0] + (direction[0] / length) * distance,
      bounds.center[1] + (direction[1] / length) * distance,
      bounds.center[2] + (direction[2] / length) * distance,
    ],
    target: bounds.center,
  };
}

/*
  A length as a person would write it.

  Three significant-ish digits and no trailing zeros, because a dimension line
  reading "2.4 m" is a measurement and one reading "2.4000000000000004 m" is a
  float. Unitless lengths carry no suffix rather than a made-up one: a scene
  that has not declared a unit is not secretly in metres.
*/
export function formatSceneLength(value: number, unit: SceneLengthUnit | null): string {
  const magnitude = Math.abs(value);
  const digits = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
  const text = Number(value.toFixed(digits)).toString();
  return unit ? `${text} ${unit}` : text;
}

/** A dimension line as authored: two named things in the scene, not two points. */
export interface SceneMeasure {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface ResolvedSceneMeasure extends SceneMeasure {
  start: Vector;
  end: Vector;
  distance: number;
  /** The distance written the way a person would, with the scene's unit. */
  text: string;
  /*
    Where the label sits, as a fraction along the line from `start` to `end`.

    Half, unless another measure wanted the same piece of space. Two dimension
    lines drawn across the same subject cross near its middle — a height and a
    width through one building always do — and two labels at their midpoints
    land on top of each other. Sliding a label ALONG ITS OWN LINE is the one way
    out that cannot misattribute it: wherever it ends up, it is still on the
    line it measures.
  */
  labelAt: number;
}

/*
  How close two labels may sit before one of them moves, as a fraction of the
  scene's own size. Absolute units would be wrong at both ends: a 3-unit desk
  and a 300-unit valley need different answers, and the label is the same
  number of pixels in both because the camera fits the scene.
*/
const MEASURE_LABEL_CLEARANCE = 0.08;
// How far along its line a crowded label may slide. Past a third it stops
// reading as "the middle of this line" and starts looking like it belongs to
// whatever it has arrived next to.
const MAX_MEASURE_LABEL_SLIDE = 0.32;

function measurePoint(measure: Pick<ResolvedSceneMeasure, "start" | "end">, at: number): Vector {
  return [
    measure.start[0] + (measure.end[0] - measure.start[0]) * at,
    measure.start[1] + (measure.end[1] - measure.start[1]) * at,
    measure.start[2] + (measure.end[2] - measure.start[2]) * at,
  ];
}

/*
  Give every label a place of its own, in authored order.

  Each one starts at the middle and slides along its own line — alternating
  sides, in growing steps — until it clears the labels already placed. Order is
  the authored order, so the answer is stable: adding a third measure never
  moves the first two, which is what keeps a scene from rearranging itself every
  time somebody writes one more line. A label that cannot find room inside the
  slide limit stays where it got to; a crowded label is still better read than a
  label that has wandered off its own line.
*/
function placeMeasureLabels(measures: ResolvedSceneMeasure[], clearance: number): void {
  const placed: Vector[] = [];
  const far = (point: Vector) =>
    placed.every(
      (other) =>
        Math.hypot(point[0] - other[0], point[1] - other[1], point[2] - other[2]) >= clearance,
    );
  for (const measure of measures) {
    let at = 0.5;
    if (!far(measurePoint(measure, at))) {
      for (let step = 1; step <= 4; step += 1) {
        const offset = (MAX_MEASURE_LABEL_SLIDE * step) / 4;
        const forward = 0.5 + offset;
        const back = 0.5 - offset;
        if (far(measurePoint(measure, forward))) {
          at = forward;
          break;
        }
        if (far(measurePoint(measure, back))) {
          at = back;
          break;
        }
        at = forward;
      }
    }
    measure.labelAt = at;
    placed.push(measurePoint(measure, at));
  }
}

/**
 * Dimension lines located in a scene, centre to centre.
 *
 * `positions` says where each named thing is; a measure naming something that
 * is not there is dropped — a line running to the origin is a wrong answer, and
 * no line is at least a visible absence. `radius` is the scene's own size,
 * which is what decides how close two labels may sit.
 */
export function locateSceneMeasures(
  measures: readonly SceneMeasure[],
  positions: ReadonlyMap<string, Vector>,
  unit: SceneLengthUnit | null,
  radius: number,
): ResolvedSceneMeasure[] {
  const resolved: ResolvedSceneMeasure[] = [];
  for (const measure of measures) {
    const start = positions.get(measure.from);
    const end = positions.get(measure.to);
    if (!start || !end) continue;
    const distance = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    resolved.push({
      ...measure,
      start,
      end,
      distance,
      text: formatSceneLength(distance, unit),
      labelAt: 0.5,
    });
  }
  placeMeasureLabels(resolved, radius * MEASURE_LABEL_CLEARANCE);
  return resolved;
}
