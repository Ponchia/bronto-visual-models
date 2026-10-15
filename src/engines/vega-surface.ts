import { type RendererTokens, vegaConfig } from "@ponchia/ui/renderer";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { changeset, type TooltipHandler, type View } from "vega";
import { Handler } from "vega-tooltip";
import { createVisualRenderQueue } from "../render/visual-render-queue.ts";
import type { EngineLifecycle } from "./engine-lifecycle.ts";

interface SurfaceSize {
  width: number;
  height: number;
}
/** Below this container width a chart moves its legend under the plot and thins its ticks. */
export const NARROW_WIDTH = 480;
/** Named datasets the surface keeps in its view through changesets. */
export type SurfaceData = Record<string, readonly object[]>;
export interface SurfaceCreation {
  container: HTMLElement;
  bindings: HTMLElement | null;
  /** The measured container, or the fallback when it has no layout yet. */
  size: SurfaceSize;
  /** The datasets to draw first, so a new view never paints empty. */
  data: SurfaceData;
  /** The page's resolved tokens, for grammars that colour their own marks. */
  tokens: RendererTokens;
  /** The bronto chart theme for these tokens and this width: the one place a theme enters. */
  config(mode: "vega" | "vega-lite"): Record<string, unknown>;
  tooltip: TooltipHandler;
}
export interface VegaSurfaceOptions extends EngineLifecycle {
  /** Explicit resolved look; the library never subscribes to application appearance events. */
  tokens: RendererTokens;
  /**
   * Everything compiled into the view. A change builds another; so does a new
   * presentation (scheme, or crossing the narrow width), which carries `carry`.
   */
  identity: string;
  /**
   * The caller's own part of the presentation, such as how much chrome a small
   * body gives away. A change builds the view again and carries `carry`.
   */
  presentation?: string;
  create(input: SurfaceCreation): Promise<View>;
  /**
   * Exploration a new presentation keeps: each named parameter's signals and
   * its selection store, so a brush, zoom or bound value survives a theme switch
   * or the narrow crossing. A brush is drawn again from the data it selects.
   */
  carry?: readonly string[];
  /** `key` identifies the data; `sized` data is laid out again for every size. */
  data?: { key: string; sized?: boolean; sets(size: SurfaceSize): SurfaceData };
  /** Applies a container size; by default the view takes it as width and height. */
  resize?(view: View, size: SurfaceSize): void;
  /**
   * Lays the view out again after a run drew new rows or a new size, before the
   * frame is attested, as a discrete axis does when its bands follow the row
   * count, and runs the view itself if it changed it. Resolves true when the
   * caller is about to build another view instead, so this frame is not
   * attested.
   */
  settle?(view: View, size: SurfaceSize): Promise<boolean | undefined>;
  fallbackSize?: SurfaceSize;
  /** Called after each frame the surface drew. */
  onDrawn?(view: View): void;
  onError(message: string): void;
}
export interface VegaSurface {
  /** The current view; per-view listeners re-attach when it changes. */
  view: View | null;
  /** Serialises work against the current view; skipped while inactive. */
  run(work: (view: View) => Promise<void> | void): Promise<void>;
  /**
   * Attests again the frame last attested, after the view changed itself
   * (exploration). It never vouches for a frame the surface has not drawn.
   */
  attest(): void;
  idle(): Promise<void>;
}

interface Engine {
  view: View;
  identity: string;
  /** The caller's identity alone, without the presentation around it. */
  grammar: string;
  container: HTMLElement;
  bindings: HTMLElement | null;
  size: SurfaceSize;
  /** Whether this view was built with the narrow layout. */
  narrow: boolean;
  /** Whether its first frame was drawn and the view handed out as `view`. */
  shown: boolean;
  /** The brush pass its first frame still owes (`brushRederivation`). */
  rederive?: ViewState;
  /** Only a successfully evaluated/settled frame may carry this key. */
  dataKey: string | null;
  validFrame: boolean;
  /** Evaluation failures can leave internal pulses inconsistent; never reuse that dataflow. */
  failed: boolean;
  frameEpoch: number;
  held: Map<string, string>;
  release(): void;
}

const DEFAULT_SIZE: SurfaceSize = { width: 640, height: 360 };

/**
 * The narrow layout starts below NARROW_WIDTH and ends only this far above it.
 * Each crossing rebuilds the view and moves its legend, so a width resting on
 * the boundary (a resize drag, a scrollbar coming and going) would rebuild it
 * at every pixel back and forth.
 */
export const NARROW_HYSTERESIS = 24;

/** The layout for `width`, given the one in use (`null` before the first measure). */
function narrowAt(width: number, narrow: boolean | null): boolean {
  return width < NARROW_WIDTH + (narrow ? NARROW_HYSTERESIS : 0);
}

function measure(element: HTMLElement): SurfaceSize | null {
  const width = Math.round(element.clientWidth),
    height = Math.round(element.clientHeight);
  return width >= 1 && height >= 1 ? { width, height } : null;
}

/**
 * Cut every reference from a finalized engine back into the canvas DOM.
 *
 * `view.finalize()` stops timers and listeners but keeps the view's containers
 * (`_el`, `_elBind`, the renderer's and handler's `_el`) and its rendered
 * `<svg>`. vega-scenegraph also keeps a module-level "current element"
 * pointer at the last `<path>` it drew (SVGRenderer.js `let element`,
 * vega-scenegraph 5.3.0), which nothing resets. Measured on the retention
 * experiment (long-session-retention.spec.ts): one stale pointer inside the
 * last chart drawn pinned the WHOLE detached canvas after the operator
 * switched away — 50 charts, ~12 MB of objects, every React fiber — because
 * the DOM parent chain runs from any element vega still holds up to the old
 * canvas root. Detaching the containers from that tree, and the `<svg>` from
 * them, leaves the pointer one chart's own subtree and no further.
 *
 * Only for an unmounted surface: a new identity reuses the same connected
 * elements, and this runs after the queue drains.
 */
function releaseSurfaces(surface: HTMLElement, bindings: HTMLElement | null): void {
  if (surface.isConnected) return;
  surface.replaceChildren();
  surface.remove();
  bindings?.replaceChildren();
  bindings?.remove();
}

/** Invalid internal dataflow state is not repaired by simply replaying a changeset. */
function poisonFrame(engine: Engine): void {
  engine.validFrame = false;
  engine.failed = true;
  engine.frameEpoch++;
  engine.dataKey = null;
  engine.held.clear();
}

/** Guard the actual engine being evaluated even if its React request was superseded. */
async function evaluateFrame<T>(engine: Engine, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    poisonFrame(engine);
    throw error;
  }
}

/** Replaces the named datasets the view does not already hold; true when any changed. */
async function hold(engine: Engine, sets: SurfaceData): Promise<boolean> {
  const held = new Map(engine.held);
  let changed = false;
  try {
    for (const [name, rows] of Object.entries(sets)) {
      const key = JSON.stringify(rows);
      if (held.get(name) === key) continue;
      engine.view.change(
        name,
        changeset()
          .remove(() => true)
          .insert(structuredClone(rows) as object[]),
      );
      held.set(name, key);
      changed = true;
    }
    if (changed) await engine.view.runAsync();
  } catch (error) {
    // Evaluation can fail after mutating the dataflow. Neither the old nor the
    // attempted rows may be assumed to remain held; a retry must reapply them.
    poisonFrame(engine);
    throw error;
  }
  engine.held = held;
  return changed;
}

/** A parameter's own signals and selection store, never a derived or size signal. */
function carriedState(view: View, names: readonly string[]) {
  const owns = (name: string) =>
    names.some((param) => name === param || name.startsWith(`${param}_`));
  return view.getState({
    signals: (name?: string) => !!name && owns(name) && !name.endsWith("_store"),
    data: (name?: string) => !!name && names.some((param) => name === `${param}_store`),
    recurse: true,
  });
}

/** A view's state as `getState` reads it, nested scopes under `subcontext`. */
interface ViewState {
  signals?: Record<string, unknown>;
  data?: Record<string, unknown>;
  subcontext?: ViewState[];
}

/**
 * A carried brush is its data extent, its selection store and its pixel extent,
 * and the pixels were measured in the old view: at another width, or beside a
 * legend that has moved, they cover other data than the store selects.
 * Vega-Lite re-derives the pixels from the data extent whenever the brush's
 * scale changes, through `<param>_scale_trigger`, and a rebuilt view is such a
 * change. So this fires that trigger in every scope where the brush is set
 * (its `_tuple`): unset, Vega-Lite's own derivation would read a null extent.
 * A brush on a band or point scale is cleared here, Vega-Lite's rule for a
 * discrete scale that changed.
 */
function brushRederivation(state: ViewState, names: readonly string[]): ViewState | undefined {
  const signals: Record<string, unknown> = {};
  for (const name of names) {
    const trigger = `${name}_scale_trigger`;
    if (state.signals && trigger in state.signals && state.signals[`${name}_tuple`])
      signals[trigger] = {};
  }
  const subcontext = state.subcontext?.map((scope) => brushRederivation(scope, names));
  if (Object.keys(signals).length === 0 && !subcontext?.some(Boolean)) return undefined;
  return { signals, subcontext: subcontext?.map((scope) => scope ?? {}) };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * One owner for a Vega engine: it builds the view once per identity, keeps it
 * across data and size changes, serialises every change, and finalizes and
 * releases it after the last change drains.
 */
export function useVegaSurface(
  container: RefObject<HTMLElement | null>,
  options: VegaSurfaceOptions,
  bindings?: RefObject<HTMLElement | null>,
): VegaSurface {
  const tokens = options.tokens;
  // Any change of look (scheme, skin, contrast, surface) is a new presentation.
  const look = useMemo(() => JSON.stringify(tokens), [tokens]);
  const latest = useRef(options);
  latest.current = options;
  const queue = useRef<ReturnType<typeof createVisualRenderQueue> | null>(null);
  const engine = useRef<Engine | null>(null);
  const [shown, setShown] = useState<View | null>(null);
  /** The acknowledgement of the frame last attested. */
  const attested = useRef<(() => void) | undefined>(undefined);
  // Unknown until the container is first measured; it is part of the presentation.
  const [narrow, setNarrow] = useState<boolean | null>(null);
  const identity = JSON.stringify([options.identity, look, narrow, options.presentation ?? ""]);
  const dataKey = options.data?.key ?? "";
  const { active } = options;

  /**
   * What the props ask for, read together when a unit of work begins: the
   * acknowledgement belongs to exactly these rows. Reading it again when the
   * work completes would vouch for a newer frame that was never drawn.
   */
  const request = useCallback(() => {
    const { data, onReady } = latest.current;
    return { data, key: data?.key ?? "", ack: onReady };
  }, []);
  const invalidate = useCallback((current: Engine | null) => {
    attested.current = undefined;
    if (current) {
      current.validFrame = false;
      current.frameEpoch++;
    }
    latest.current.onInvalidate?.();
  }, []);
  /** Acknowledgement belongs to one successful frame of one still-mounted engine. */
  const acknowledge = useCallback((current: Engine, ack: (() => void) | undefined) => {
    if (!current.validFrame || engine.current !== current || !queue.current) return;
    const epoch = current.frameEpoch;
    attested.current = ack;
    if (ack)
      requestAnimationFrame(() => {
        if (
          queue.current &&
          engine.current === current &&
          current.validFrame &&
          current.frameEpoch === epoch &&
          latest.current.active
        )
          ack();
      });
  }, []);
  const drawn = useCallback(
    (current: Engine, ack: (() => void) | undefined) => {
      current.validFrame = true;
      latest.current.onDrawn?.(current.view);
      acknowledge(current, ack);
    },
    [acknowledge],
  );
  const fail = useCallback((error: unknown) => {
    const current = engine.current;
    // Even a queued onReady callback must not attest a partly evaluated frame.
    attested.current = undefined;
    if (current) poisonFrame(current);
    setShown(null);
    latest.current.onError(message(error));
  }, []);
  // Lays the retained view out again when its container measures differently.
  const relayout = useCallback(async () => {
    const current = engine.current;
    const size = current && measure(current.container);
    if (!current || current.failed || !size || !latest.current.active) return;
    if (
      current.validFrame &&
      current.size.width === size.width &&
      current.size.height === size.height
    )
      return;
    // Crossing the narrow width is a new presentation: the create effect rebuilds.
    const narrow = narrowAt(size.width, current.narrow);
    if (narrow !== current.narrow) {
      setNarrow(narrow);
      return;
    }
    await evaluateFrame(current, async () => {
      const { data, key, ack } = request();
      invalidate(current);
      const { resize } = latest.current;
      if (resize) resize(current.view, size);
      else current.view.width(size.width).height(size.height);
      if (data?.sized) {
        await hold(current, data.sets(size));
      }
      await current.view.runAsync();
      if (await latest.current.settle?.(current.view, size)) return;
      current.size = size;
      if (data?.sized) current.dataKey = key;
      // Rows still queued belong to a frame their own work will attest.
      if (current.dataKey === key) drawn(current, ack);
      else {
        current.validFrame = true;
        latest.current.onDrawn?.(current.view);
      }
    });
  }, [request, drawn, invalidate]);

  useEffect(() => {
    const owned = createVisualRenderQueue();
    queue.current = owned;
    const mounted = container.current,
      mountedBindings = bindings?.current ?? null;
    return () => {
      queue.current = null;
      attested.current = undefined;
      owned.close(() => {
        const current = engine.current;
        engine.current = null;
        current?.view.finalize();
        current?.release();
        const surface = current?.container ?? mounted;
        if (surface) releaseSurfaces(surface, current?.bindings ?? mountedBindings);
      });
    };
  }, [container, bindings]);

  useEffect(() => {
    const owned = queue.current;
    if (!active || !owned) return;
    let cancelled = false;
    /**
     * An engine's first frame: the brush pass it owes, then drawn, attested
     * and handed out. A cancelled run's view is replaced or left unshown by the
     * run after it, so it is never attested or shown: capture would call ready
     * a picture that never appears.
     */
    const present = async (current: Engine, frame: ReturnType<typeof request>) => {
      await evaluateFrame(current, async () => {
        const { view } = current;
        // A hidden, never-presented engine can be resumed over newer rows. Its
        // newest acknowledgement must not describe the old constructor seed.
        invalidate(current);
        if (frame.data) await hold(current, frame.data.sets(current.size));
        if (cancelled) return;
        if (current.rederive) {
          await view.runAsync();
          if (cancelled) return;
          view.setState(current.rederive);
          current.rederive = undefined;
        }
        await view.runAsync();
        if (cancelled) return;
        const superseded = await latest.current.settle?.(view, current.size);
        if (cancelled || superseded) return;
        current.dataKey = frame.key;
        drawn(current, frame.ack);
        current.shown = true;
        setShown(view);
      });
    };
    void owned
      .run(async () => {
        const target = container.current;
        if (cancelled || !target) return;
        const current = engine.current;
        if (current?.identity === identity && !current.failed) {
          await relayout();
          // Built by a run cancelled before its first frame (hidden meanwhile).
          if (!current.shown && !cancelled) await present(current, request());
          return;
        }
        const size = measure(target) ?? latest.current.fallbackSize ?? DEFAULT_SIZE;
        const layout = narrowAt(size.width, narrow);
        if (narrow !== layout) {
          setNarrow(layout);
          return;
        }
        const grammar = latest.current.identity;
        const previous = engine.current;
        engine.current = null;
        const carried =
          previous?.grammar === grammar && !previous.failed && latest.current.carry?.length
            ? carriedState(previous.view, latest.current.carry)
            : undefined;
        if (previous) {
          previous.view.finalize();
          previous.release();
        }
        const { data, key, ack } = request();
        invalidate(previous);
        const sets = data?.sets(size) ?? {};
        const controls = bindings?.current ?? null;
        const view = await latest.current.create({
          container: target,
          bindings: controls,
          size,
          data: structuredClone(sets),
          tokens,
          config: (mode) => vegaConfig(tokens, { mode, narrow: layout }),
          tooltip: new Handler().call,
        });
        if (cancelled) {
          view.finalize();
          return;
        }
        engine.current = {
          view,
          identity,
          grammar,
          container: target,
          bindings: controls,
          size,
          narrow: layout,
          shown: false,
          // A second pass: the carried state's own values hold through the first.
          rederive: carried && brushRederivation(carried, latest.current.carry ?? []),
          dataKey: null,
          validFrame: false,
          failed: false,
          frameEpoch: 0,
          held: new Map(Object.entries(sets).map(([name, rows]) => [name, JSON.stringify(rows)])),
          release: latest.current.onAcquire?.() ?? (() => {}),
        };
        if (carried) view.setState(carried);
        await present(engine.current, { data, key, ack });
      })
      .catch((error) => {
        if (!cancelled) fail(error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    identity,
    dataKey,
    active,
    container,
    bindings,
    tokens,
    narrow,
    request,
    relayout,
    drawn,
    fail,
    invalidate,
  ]);

  useEffect(() => {
    const owned = queue.current;
    if (!active || !owned || !shown) return;
    let cancelled = false;
    void owned
      .run(async () => {
        const current = engine.current;
        const { data, key, ack } = request();
        if (cancelled || current?.view !== shown || current.failed || !data) return;
        // Held already: this render's rows, or newer ones a later task drew.
        if (current.validFrame && (current.dataKey === dataKey || current.dataKey === key)) return;
        await evaluateFrame(current, async () => {
          const wasValid = current.validFrame;
          invalidate(current);
          const changed = await hold(current, data.sets(current.size));
          if (!changed && !wasValid) await current.view.runAsync();
          if (await latest.current.settle?.(current.view, current.size)) return;
          // Publish the identity only after every draw/settle step has succeeded.
          current.dataKey = key;
          drawn(current, ack);
        });
      })
      .catch((error) => {
        if (!cancelled) fail(error);
      });
    return () => {
      cancelled = true;
    };
  }, [dataKey, shown, active, request, drawn, fail, invalidate]);

  // A new acknowledgement over rows the view already holds: queued after the
  // data above, and only for this render's rows, so it never vouches for rows
  // that are pending or newer.
  const ready = options.onReady;
  useEffect(() => {
    const owned = queue.current;
    if (!active || !owned || !shown || !ready) return;
    void owned
      .run(async () => {
        const current = engine.current;
        if (current?.view !== shown || !current.validFrame || current.dataKey !== dataKey) return;
        acknowledge(current, ready);
      })
      .catch(fail);
  }, [ready, dataKey, shown, active, fail, acknowledge]);

  useEffect(() => {
    const target = container.current;
    if (!target) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        void queue.current?.run(relayout).catch(fail);
      });
    });
    observer.observe(target);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [container, relayout, fail]);

  const run = useCallback(async (work: (view: View) => Promise<void> | void) => {
    await queue.current?.run(async () => {
      const current = engine.current;
      if (current && latest.current.active) {
        if (current.failed)
          throw new Error("The failed visual engine requires a fresh data or grammar request");
        try {
          await work(current.view);
        } catch (error) {
          // The caller still owns error presentation, but a failed exploration
          // cannot retain a reusable acknowledgement of a partly changed view.
          attested.current = undefined;
          poisonFrame(current);
          setShown(null);
          throw error;
        }
      }
    });
  }, []);
  const idle = useCallback(async () => {
    await queue.current?.idle();
  }, []);
  const attest = useCallback(() => {
    if (latest.current.active && engine.current?.validFrame) attested.current?.();
  }, []);
  return { view: shown, run, idle, attest };
}

/** A parsed grammar whose named datasets start with the surface's first data. */
export function seededSpec<S extends { data?: Array<{ name: string }> }>(
  spec: S,
  data: SurfaceData,
): S {
  return {
    ...spec,
    data: spec.data?.map((entry) =>
      Object.hasOwn(data, entry.name) ? { ...entry, values: data[entry.name] } : entry,
    ),
  };
}
