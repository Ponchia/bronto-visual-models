import type { VisualFamilyResolver } from "./family-resolver.ts";
import type { VisualModel } from "./model.ts";
import { sourceSnapshotKey } from "./source-snapshot.ts";

export type { ResolvedSourceRows as ResolvedChartRows } from "./source-snapshot.ts";

/**
 * A chart's host-provided rows must match its exact model/source lifetime.
 * A sourceKey is a staleness guard, NOT authorization or a credential.
 */
export function chartSourceKey(
  model: Pick<VisualModel, "id" | "generation" | "renderer" | "content">,
  registry?: VisualFamilyResolver,
): string | undefined {
  return model.renderer === "vega-lite" ? sourceSnapshotKey(model, registry) : undefined;
}
