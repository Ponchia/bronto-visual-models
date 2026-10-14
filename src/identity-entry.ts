/**
 * What an eager surface may import: family identity, projection routing, target
 * resolution and model identity. No schema, template or validator is reachable
 * from here, so first paint never pays for authoring; `./visual-models` is the
 * authoring entry.
 */
export * from "./compatibility.ts";
export * from "./families/identity.ts";
export * from "./model.ts";
export * from "./projections.ts";
export * from "./targets.ts";
