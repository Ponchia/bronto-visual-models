import { canonicalVisualJson } from "./model.ts";

/** The longest viewpoint name a view saves or a capture asks for. */
export const MAX_VISUAL_CAPTURE_VIEWPOINT_CHARS = 64;

/**
 * What a capture asks a page to hold while it takes one picture.
 *
 * It travels in the address because the page is a headless browser opened at
 * one URL, and it is read once, from the address the tab opened at: the router
 * rewrites the URL before any view mounts.
 */
export interface VisualCaptureIntent {
  /** The page exists to be photographed: chrome is hidden and device-local framing is ignored. */
  readonly capture: boolean;
  /** Motion is held at rest, so two captures of one frame agree. */
  readonly still: boolean;
  /** The viewpoint asked of the one view the path names; other views keep their own. */
  readonly viewpoint?: string;
}

/** What the stage attests the accepted frame showed, as opposed to what was asked. */
export interface VisualCaptureApplied {
  /** The viewpoint the renderer resolved, or null when it has none or showed its default. */
  readonly viewpoint: string | null;
  /** Nothing in the frame moved on its own when it was acknowledged. */
  readonly still: boolean;
  /** The saved framing was shown; no device-local camera, window or zoom was restored. */
  readonly fit: boolean;
}

/** The query a capture opens a view with. `readVisualCapture` is its only reader. */
export function visualCaptureQuery(options: { viewpoint?: string } = {}): URLSearchParams {
  const query = new URLSearchParams({ still: "1", visualCapture: "1" });
  if (options.viewpoint) query.set("view", options.viewpoint);
  return query;
}

/** A path segment's text; a malformed escape names no node rather than throwing. */
function pathSegment(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/**
 * The capture intent for one view on the page at `page`.
 *
 * Capture and still rule the whole page: a page asking for either is a picture
 * nobody interacts with, and any motion or chrome on it is cost. The viewpoint
 * rules only the node the path names, so a link about one scene does not turn
 * every scene on the canvas.
 */
export function readVisualCapture(
  page: { pathname?: string; search?: string },
  nodeId: string,
): VisualCaptureIntent {
  const query = new URLSearchParams(page.search ?? "");
  const flag = (name: string) => {
    const value = query.get(name);
    return value !== null && value !== "0" && value !== "false";
  };
  const named = pathSegment((page.pathname ?? "").split("/").filter(Boolean).pop());
  const asked = query.get("view");
  const viewpoint =
    asked &&
    asked.length <= MAX_VISUAL_CAPTURE_VIEWPOINT_CHARS &&
    named !== undefined &&
    named === nodeId
      ? asked
      : undefined;
  return {
    capture: flag("visualCapture"),
    still: flag("still"),
    ...(viewpoint ? { viewpoint } : {}),
  };
}

/** The `data-visual-capture` value for what a frame applied. */
export function visualCaptureAttestation(applied: VisualCaptureApplied): string {
  return canonicalVisualJson({
    fit: applied.fit,
    still: applied.still,
    viewpoint: applied.viewpoint,
  });
}

/** Reads a stage's attestation; anything that is not one reads as none. */
export function parseVisualCaptureAttestation(
  value: string | null | undefined,
): VisualCaptureApplied | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.fit !== "boolean" || typeof record.still !== "boolean") return null;
  if (record.viewpoint !== null && typeof record.viewpoint !== "string") return null;
  return { viewpoint: record.viewpoint, still: record.still, fit: record.fit };
}

/**
 * What a capture page hides. Workspace connectors go (an embedded diagram owns
 * equally named layers, which stay), and so does any renderer chrome on a stage
 * that is being captured. The page installs this when it opens, so the renderer
 * lays out once, without its chrome, before it acknowledges a frame.
 */
export const VISUAL_CAPTURE_STYLE =
  ".react-flow__edges:not(.visual-stage .react-flow__edges),.react-flow__edgelabel-renderer:not(.visual-stage .react-flow__edgelabel-renderer),.visual-stage[data-visual-capture] [data-visual-chrome]{display:none!important}";
