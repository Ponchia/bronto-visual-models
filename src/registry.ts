import {
  rendererDefinition,
  validateVisualContent,
  visualCollectionLimit,
  visualContentAdvice,
  type VisualRendererDefinition,
} from "./catalog.ts";
import type { VisualFamilyResolver } from "./family-resolver.ts";
import type { VisualFamily } from "./families/family.ts";
import { VISUAL_FAMILIES } from "./families/index.ts";
import { VISUAL_CAPABILITY_MEANINGS } from "./families/identity.ts";
import { VisualModelError } from "./model.ts";
import { assertAgentSchema, type ValidationIssue } from "./schema.ts";

/** Trusted family code; registries are local, immutable and never an executable plugin sandbox. */
export interface VisualRegistry extends VisualFamilyResolver {
  readonly families: readonly VisualFamily[];
  readonly renderers: readonly VisualRendererDefinition[];
  renderer(id: string): VisualRendererDefinition;
  validate(
    renderer: string,
    modelType: string,
    content: unknown,
  ): asserts content is Record<string, unknown>;
  collectionLimit(renderer: string, collection: string): number;
  advice(renderer: string, content: Record<string, unknown>): readonly ValidationIssue[];
}

function owned<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(owned)) as T;
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, child]) => [key, owned(child)])),
  ) as T;
}

/** Supply the whole installed set, or use the built-ins. Duplicate family IDs are refused. */
export function createVisualRegistry(
  input: readonly VisualFamily[] = VISUAL_FAMILIES,
): VisualRegistry {
  const entries = new Map<string, VisualFamily>();
  for (const original of input) {
    if (!/^[a-z][a-z0-9_-]{0,127}$/.test(original.id) || entries.has(original.id))
      throw new VisualModelError("invalid", "Families need unique, lowercase IDs");
    if (!Number.isSafeInteger(original.version) || original.version < 1)
      throw new VisualModelError("invalid", "Family version must be a positive integer");
    if (!original.modelType || new Set(original.records).size !== original.records.length)
      throw new VisualModelError(
        "invalid",
        "Family collections and model type must be unambiguous",
      );
    for (const adapter of original.adapters)
      if (adapter.capabilities.some((name) => !Object.hasOwn(VISUAL_CAPABILITY_MEANINGS, name)))
        throw new VisualModelError("invalid", "Unknown declared visual capability");
    assertAgentSchema(original.schema);
    entries.set(original.id, owned(original));
  }
  const families = Object.freeze([...entries.values()]);
  const registry: VisualRegistry = {
    families,
    renderers: Object.freeze(families.map(rendererDefinition)),
    family: (id) => entries.get(id),
    renderer(id) {
      const family = entries.get(id);
      if (!family) throw new VisualModelError("invalid", `Unknown renderer: ${id}`);
      return rendererDefinition(family);
    },
    validate(renderer, modelType, content) {
      validateVisualContent(renderer, modelType, content, registry);
    },
    collectionLimit: (renderer, collection) =>
      visualCollectionLimit(renderer, collection, registry),
    advice: (renderer, content) => visualContentAdvice(renderer, content, registry),
  };
  return Object.freeze(registry);
}
