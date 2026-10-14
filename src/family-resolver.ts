import type { VisualFamily } from "./families/family.ts";
/** A registry is supplied per consumer, never installed into global mutable state. */
export interface VisualFamilyResolver {
  family(id: string): VisualFamily | undefined;
}
