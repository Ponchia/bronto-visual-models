import { type ChartFill, chartFill } from "../families/vega-lite.ts";
import { visualRecord } from "../model.ts";
import type { View } from "vega";

/** A discrete axis never draws its bands thinner than this: below it the body scrolls. */
export const BAND_MIN = 12;
/** Nor thicker: a handful of categories draws bars, not slabs. */
export const BAND_MAX = 40;
/** A plot keeps at least this height: the chrome around it gives way first. */
export const PLOT_MIN = 80;

/**
 * The chrome that gives way to the plot, in the order it does. A legend sits
 * outside the axes, and an axis title outside its labels, so taking chrome
 * away in this order never moves what stays. One exception only overstates:
 * a title above a top legend would come down once the legend goes. The axes'
 * labels and the marks always stay.
 */
export const CHROME_YIELDS = ["legend", "title", "axis title"] as const;
/** A yield level past the list: even bare axes leave the plot under PLOT_MIN. */
export const TOO_SMALL = CHROME_YIELDS.length + 1;

type Spec = Record<string, unknown>;
interface Size {
  width: number;
  height: number;
}

const FIT = { type: "fit", contains: "padding" } as const;

/** A view without a size of its own, down through its layers: the top level holds the one size. */
function unsized(spec: Spec): Spec {
  const { width: _width, height: _height, autosize: _autosize, ...rest } = spec;
  return Array.isArray(rest.layer)
    ? { ...rest, layer: rest.layer.map((child) => (visualRecord(child) ? unsized(child) : child)) }
    : rest;
}

interface ChartFrame {
  spec: Spec;
  fill: ChartFill;
}

/** Every channel Vega-Lite can draw a legend for. */
const LEGEND_CHANNELS = [
  "color",
  "fill",
  "stroke",
  "opacity",
  "fillOpacity",
  "strokeOpacity",
  "strokeWidth",
  "strokeDash",
  "size",
  "shape",
];

/** The view with the first `level` CHROME_YIELDS taken away, down through its layers. */
function yieldChrome(spec: Spec, level: number, top = true): Spec {
  let out = spec;
  if (top && level >= 2) {
    const { title: _title, ...rest } = out;
    out = rest;
  }
  if (visualRecord(out.encoding)) {
    const encoding: Spec = { ...out.encoding };
    // A channel's own `legend: null` is the switch: config.legend.disable loses to a legend object.
    if (level >= 1)
      for (const channel of LEGEND_CHANNELS) {
        const definition = encoding[channel];
        if (visualRecord(definition)) encoding[channel] = { ...definition, legend: null };
      }
    // `axis.title: null` beats a channel's own title; config.axis.title does not.
    if (level >= 3)
      for (const channel of ["x", "y"]) {
        const definition = encoding[channel];
        if (visualRecord(definition) && definition.axis !== null)
          encoding[channel] = {
            ...definition,
            axis: { ...(visualRecord(definition.axis) ? definition.axis : {}), title: null },
          };
      }
    out = { ...out, encoding };
  }
  return Array.isArray(out.layer)
    ? {
        ...out,
        layer: out.layer.map((child) =>
          visualRecord(child) ? yieldChrome(child, level, false) : child,
        ),
      }
    : out;
}

/** Vega-Lite's padding on each side when neither the spec nor the theme names one. */
const DEFAULT_PADDING = 5;

/** The width a view's padding leaves its content. */
function contentWidth(spec: Spec, width: number): number {
  const { padding } = spec;
  const inset =
    typeof padding === "number"
      ? 2 * padding
      : visualRecord(padding)
        ? Number(padding.left ?? 0) + Number(padding.right ?? 0)
        : 2 * DEFAULT_PADDING;
  return Math.max(0, width - inset);
}

/**
 * The view's title held to its content's width. Vega's fit counts a wider
 * title as chrome beside the plot: a nightly chart's one-line subtitle of a
 * paragraph left the plot of a 900 px body 0 px wide. Past the limit Vega
 * ends the line with an ellipsis. A narrower limit of the spec's own stays.
 */
function titleWithin(spec: Spec, width: number): Spec {
  const { title } = spec;
  if (title === undefined || title === null) return spec;
  const limit = contentWidth(spec, width);
  if (!visualRecord(title)) return { ...spec, title: { text: title, limit } };
  const own = typeof title.limit === "number" && title.limit > 0 ? title.limit : limit;
  return { ...spec, title: { ...title, limit: Math.min(own, limit) } };
}

/** The view at `width` with the first `level` CHROME_YIELDS taken away, before its height is set. */
function framed(spec: Spec, width: number, level: number): Spec {
  return titleWithin(yieldChrome(unsized(spec), Math.min(level, CHROME_YIELDS.length)), width);
}

/**
 * The spec a view embeds at `size`. The renderer owns the size: a single or
 * layered view takes its body whatever width, height or step the stored spec
 * names. A stored size was chosen for another canvas, another device or by a
 * nightly script, so it is overridden here, never migrated: nothing stored
 * changes, and a revert is clean. The size is a number rather than
 * `"container"`, whose signals re-read the container on every window resize
 * and would undo a discrete axis's band height (`bandedHeight`). `yielded`
 * takes that many CHROME_YIELDS away (`yieldsFor`).
 */
export function chartFrame(spec: Spec, size: Size, yielded = 0): ChartFrame {
  if (chartFill(spec) === "composed")
    return {
      spec: { width: "container", height: "container", autosize: FIT, ...spec },
      fill: "composed",
    };
  return {
    spec: {
      ...framed(spec, size.width, yielded),
      width: size.width,
      height: size.height,
      autosize: FIT,
    },
    fill: "fit",
  };
}

/** A spec compiled and run without drawing, as the view would run it. */
type MeasureRun = (spec: Spec) => Promise<View>;

interface Box {
  y1: number;
  y2: number;
}

/** The height a view laid out with `autosize: pad` on y takes: its plot, chrome and padding. */
function laidOutHeight(view: View): number {
  // view.scenegraph() is typed as the root mark; at runtime it holds it as `root`.
  const bounds = (view.scenegraph() as unknown as { root: { bounds: Box } }).root.bounds;
  const plot = Number(view.height()),
    padding = view.padding();
  const vertical =
    typeof padding === "number" ? 2 * padding : (padding.top ?? 0) + (padding.bottom ?? 0);
  // Rounded as Vega's autosize rounds the bounds it adds up.
  return (
    Math.max(0, Math.ceil(-bounds.y1)) + plot + Math.max(0, Math.ceil(bounds.y2 - plot)) + vertical
  );
}

/**
 * The height a view needs to keep its plot PLOT_MIN tall with the first
 * `level` CHROME_YIELDS taken away. The view is laid out once with its plot
 * pinned at PLOT_MIN (autosize pad on y, fit on x), so a legend overhanging a
 * short plot and the axes' labels count as they would draw. Vega's fit cannot
 * answer this: it squeezes the plot to nothing once the chrome fills the
 * height, and a resized view can settle a few pixels from a fresh one. A plot
 * the chrome beside it leaves under PLOT_MIN wide, such as a legend or labels
 * wider than the body, fits at no height.
 */
async function floorHeight(
  spec: Spec,
  width: number,
  level: number,
  run: MeasureRun,
): Promise<number> {
  const view = await run({
    ...framed(spec, width, level),
    width,
    height: PLOT_MIN,
    autosize: { type: "fit-x", contains: "padding" },
  });
  try {
    return Number(view.width()) < PLOT_MIN ? Number.POSITIVE_INFINITY : laidOutHeight(view);
  } finally {
    view.finalize();
  }
}

/**
 * The fewest yields that keep the plot PLOT_MIN tall in a view of `size`, or
 * TOO_SMALL when even bare axes do not. `floors` holds the floor heights
 * measured so far, level by level, and gains one run for each level this
 * needs: the steps are bounded by the list's length, and a later size reads
 * them back without running anything. A fixed function of the size and the
 * floors, so at one size it never takes back chrome it gave away.
 */
export async function yieldsFor(
  spec: Spec,
  size: Size,
  floors: number[],
  run: MeasureRun,
): Promise<number> {
  for (let level = 0; level <= CHROME_YIELDS.length; level++) {
    floors[level] ??= await floorHeight(spec, size.width, level, run);
    if ((floors[level] ?? Number.POSITIVE_INFINITY) <= size.height) return level;
  }
  return TOO_SMALL;
}

/** What one run laid out: the total height it was given, and a discrete y's plot extent, step and categories. */
interface BandLayout {
  total: number;
  plot: number;
  step: number;
  count: number;
}

/** Float slack for rounding a height that is a whole number of pixels in exact arithmetic. */
const EPSILON = 1e-6;

/**
 * The total height that gives a discrete y the body's share per category, held
 * between BAND_MIN and BAND_MAX, in one pass. It is the body itself whenever
 * that share is in range, taller when the bands would be thinner (the body
 * scrolls), and shorter when they would be thicker. Titles, axes and legends
 * keep the height they took in `layout`. Vega's fit can settle a resized view
 * a few pixels from a fresh one, so a band can land just outside the range;
 * it is not corrected again (the stored-data check counts those).
 */
export function bandedHeight(layout: BandLayout, body: number): number {
  const { total, plot, step, count } = layout;
  if (!(body > 0 && count > 0 && plot > 0 && step > 0)) return body;
  const chrome = total - plot;
  const share = (step * (body - chrome)) / plot;
  if (share >= BAND_MIN && share <= BAND_MAX) return body;
  // Rounded into the range: a whole-pixel height never rounds a band out of it.
  return share < BAND_MIN
    ? Math.ceil(chrome + (plot * BAND_MIN) / step - EPSILON)
    : Math.floor(chrome + (plot * BAND_MAX) / step + EPSILON);
}

interface DiscreteScale {
  domain(): unknown[];
  range(): unknown[];
  step(): number;
}

/** A discrete y's layout in a view last laid out at `total`; undefined when y is continuous or absent. */
export function bandLayout(view: View, total: number): BandLayout | undefined {
  let scale: unknown;
  try {
    scale = view.scale("y");
  } catch {
    // A view with no y encoding has no scale of that name, and Vega throws on it.
    return undefined;
  }
  // Band and point scales have a step; continuous ones do not.
  if (typeof scale !== "function" || typeof (scale as Partial<DiscreteScale>).step !== "function")
    return undefined;
  const discrete = scale as unknown as DiscreteScale;
  const [start, end] = discrete.range();
  const plot = Math.abs(Number(end) - Number(start));
  return { total, plot, step: discrete.step(), count: discrete.domain().length };
}
