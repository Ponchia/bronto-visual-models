import { lazy, type ComponentType } from "react";
import type { AdapterProps } from "./types.ts";

/**
 * A host installs trusted visual components, never components named by model JSON.
 * A loader is invoked only when its declared family/adapter is displayed.
 */
export type VisualViewAdapterDefinition =
  | { readonly id: string; readonly component: ComponentType<AdapterProps>; readonly load?: never }
  | {
      readonly id: string;
      readonly load: () => Promise<{ default: ComponentType<AdapterProps> }>;
      readonly component?: never;
    };

export interface VisualViewAdapterRegistry {
  readonly ids: readonly string[];
  /** The host's component for a family-declared adapter, if installed. */
  get(id: string): ComponentType<AdapterProps> | undefined;
}

/**
 * One application's adapters, with no global registry or implicit module discovery.
 * The registry is constructed once, outside React render, to keep lazy component
 * identities stable across edits and changes of projection.
 */
export function createVisualViewAdapters(
  definitions: readonly VisualViewAdapterDefinition[],
): VisualViewAdapterRegistry {
  const adapters = new Map<string, ComponentType<AdapterProps>>();
  for (const definition of definitions) {
    if (!/^[a-z][a-z0-9_-]{0,127}$/.test(definition.id) || adapters.has(definition.id))
      throw new Error("View adapters require unique, lowercase IDs");
    if ("component" in definition === "load" in definition)
      throw new Error("A view adapter needs exactly one component or loader");
    const component =
      definition.component ??
      (typeof definition.load === "function" ? lazy(definition.load) : undefined);
    if (!component) throw new Error("A view adapter needs a component or loader");
    adapters.set(definition.id, component);
  }
  return Object.freeze({
    ids: Object.freeze([...adapters.keys()]),
    get: (id: string) => adapters.get(id),
  });
}
