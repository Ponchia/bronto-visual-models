import type { VisualFamilyResolver } from "./family-resolver.ts";
import { visualRenderer } from "./catalog.ts";
import { isVisualIncarnation, type VisualModel, VisualModelError, visualRecord } from "./model.ts";

/** The model service calls this after validation, while holding its commit owner. */
export function assignModelIncarnations<M extends VisualModel>(
  model: M,
  previous: VisualModel | undefined,
  mint: () => string,
  /** Per collection, the IDs that name a new subject rather than continue the old one. */
  fresh?: Readonly<Record<string, readonly string[]>>,
  registry?: VisualFamilyResolver,
): M {
  const elementIncarnations: NonNullable<VisualModel["elementIncarnations"]> = {};
  for (const collection of visualRenderer(model.renderer, registry).records) {
    const entries: Record<string, string> = {};
    const prior = previous?.elementIncarnations?.[collection];
    const present = new Set(
      ((previous?.content[collection] ?? []) as Array<{ id: string }>).map((item) => item.id),
    );
    for (const item of (model.content[collection] ?? []) as Array<{ id: string }>) {
      const continuing = present.has(item.id) && !fresh?.[collection]?.includes(item.id);
      entries[item.id] = (continuing ? prior?.[item.id] : undefined) ?? mint();
    }
    elementIncarnations[collection] = entries;
  }
  return { ...model, elementIncarnations };
}

/**
 * Every current record has exactly one lifetime; neither missing nor extra keys are accepted.
 * The membership of nothing is nothing, so a family's collections can change between builds:
 * a collection with no rows may have no map (the model was stored before its family declared
 * it), and a map for a collection this build does not declare may stand while it is empty (a
 * newer build declared it). The next write assigns exactly the declared maps.
 */
export function assertModelIncarnations(model: VisualModel, registry?: VisualFamilyResolver): void {
  const identities = model.elementIncarnations;
  const collections = visualRenderer(model.renderer, registry).records;
  if (
    !visualRecord(identities) ||
    Object.entries(identities).some(
      ([key, tokens]) =>
        !collections.includes(key) && !(visualRecord(tokens) && Object.keys(tokens).length === 0),
    )
  )
    throw new VisualModelError("invalid", "Invalid model element identities");
  const seen = new Set<string>();
  for (const collection of collections) {
    const tokens = identities[collection];
    const rows = (model.content[collection] ?? []) as Array<{ id: string }>;
    if (tokens === undefined && rows.length === 0) continue;
    if (!visualRecord(tokens) || Object.keys(tokens).length !== rows.length)
      throw new VisualModelError(
        "invalid",
        "Element identity membership differs from model content",
      );
    for (const { id } of rows) {
      const token = tokens[id];
      if (!isVisualIncarnation(token) || seen.has(token))
        throw new VisualModelError("invalid", "Invalid or duplicate element incarnation");
      seen.add(token);
    }
  }
}
