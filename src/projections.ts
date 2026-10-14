import type { VisualFamilyResolver } from "./family-resolver.ts";
import {
  VISUAL_FAMILY_IDENTITIES,
  type VisualAdapterId,
  type VisualCapability,
  type VisualRendererId,
  visualFamilyIdentity,
} from "./families/identity.ts";
import { canonicalVisualJson, type VisualModel } from "./model.ts";

/** Authored presentation belongs to a placement, never to another view's layout. */
export interface VisualViewSettings<SourceBindings = unknown> {
  projection?: string;
  viewpoint?: string;
  buildId?: string;
  sourceBindings?: SourceBindings;
}

/** Every named projection a view may save, with the family and adapter that draw it. */
export const VISUAL_PROJECTIONS: readonly {
  id: string;
  label: string;
  renderer: VisualRendererId;
  adapter: VisualAdapterId;
  requirement: string;
}[] = Object.freeze(
  VISUAL_FAMILY_IDENTITIES.flatMap((family) =>
    family.adapters.flatMap((entry) =>
      entry.projection
        ? [{ ...entry.projection, renderer: family.id, adapter: entry.adapter }]
        : [],
    ),
  ),
);

function shownAdapter(model: Pick<VisualModel, "renderer" | "content">, requested?: string, registry?: VisualFamilyResolver) {
  const projection = resolveVisualProjection(model, requested, registry);
  if (!projection) return;
  const adapters = visualFamilyIdentity(model.renderer, registry)?.adapters;
  return adapters?.find((entry) => entry.projection?.id === projection) ?? adapters?.[0];
}

/** Compatibility belongs to the shared contract. Browser hosts never invent
 * routing exceptions for a new representation. Unknown formats stay unrendered. */
export function visualAdapterId(
  model: Pick<VisualModel, "renderer" | "content">,
  requested?: string,
  registry?: VisualFamilyResolver,
): string | undefined {
  return shownAdapter(model, requested, registry)?.adapter;
}

/** What the representation a view shows can do; one it cannot show can do nothing. */
export function visualViewCapabilities(
  model: Pick<VisualModel, "renderer" | "content">,
  requested?: string,
  registry?: VisualFamilyResolver,
): readonly VisualCapability[] {
  return shownAdapter(model, requested, registry)?.capabilities ?? [];
}

/**
 * Whether a view emphasises an entity another view announces: its
 * representation declares `linked-entity`, and its family says the content
 * asks for it.
 */
export function visualFollowsEntity(
  model: Pick<VisualModel, "renderer" | "content">,
  requested?: string,
  registry?: VisualFamilyResolver,
): boolean {
  return (
    visualViewCapabilities(model, requested, registry).includes("linked-entity") &&
    (visualFamilyIdentity(model.renderer, registry)?.followsEntity?.(model.content) ?? true)
  );
}

export function visualProjectionChoices(model: Pick<VisualModel, "renderer" | "content">, registry?: VisualFamilyResolver) {
  const family = visualFamilyIdentity(model.renderer, registry);
  const projections = registry ? (family?.adapters ?? []).flatMap((entry) => entry.projection
    ? [{ ...entry.projection, renderer: family!.id, adapter: entry.adapter }] : []) : VISUAL_PROJECTIONS;
  return projections.filter(
    (entry) =>
      entry.renderer === model.renderer &&
      (family?.eligible?.(entry.id, model.content).eligible ?? true),
  );
}

/** Unknown or incompatible saved settings are preserved, not silently substituted. */
export function resolveVisualProjection(
  model: Pick<VisualModel, "renderer" | "content">,
  requested?: string,
  registry?: VisualFamilyResolver,
): string | undefined {
  const choices = visualProjectionChoices(model, registry);
  const family = visualFamilyIdentity(model.renderer, registry);
  const fallback = family?.defaultProjection?.(model.content) ?? model.renderer;
  if (!requested) return fallback;
  return choices.length
    ? choices.find((entry) => entry.id === requested)?.id
    : requested === fallback
      ? fallback
      : undefined;
}

/**
 * What a view asks to show, whether its model can show it, and what it may ask
 * for. `shown` is what a reader sees: the request when the model can show it,
 * otherwise the model's own default. An incompatible saved request is set
 * aside, never drawn as a missing renderer.
 */
export function visualViewProjection(
  model: Pick<VisualModel, "renderer" | "content">,
  requested?: string,
  registry?: VisualFamilyResolver,
) {
  const resolved = resolveVisualProjection(model, requested, registry);
  const choices = visualProjectionChoices(model, registry).map((entry) => entry.id);
  return {
    projection: requested ?? null,
    resolved: resolved ?? null,
    shown: resolved ?? resolveVisualProjection(model, undefined, registry) ?? model.renderer,
    compatible: resolved !== undefined,
    // A family with one representation is chosen by its default.
    choices: choices.length ? choices : [resolveVisualProjection(model, undefined, registry) ?? model.renderer],
  };
}

/** A capture binds every authored render setting. */
export function visualViewIdentity(view?: VisualViewSettings): string {
  return canonicalVisualJson({
    projection: view?.projection ?? null,
    viewpoint: view?.viewpoint ?? null,
    buildId: view?.buildId ?? null,
    ...(view?.sourceBindings ? { sourceBindings: view.sourceBindings } : {}),
  });
}
