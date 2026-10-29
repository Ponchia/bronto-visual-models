import type { VisualFamilyResolver } from "./family-resolver.ts";
import { visualFamilyIdentity } from "./families/identity.ts";
import { sha256Hex } from "./hash.ts";
import { assertVisualJson, canonicalVisualJson, type VisualModel } from "./model.ts";

/** Already-authorized data handed to the viewer; never a request to fetch it. */
export interface ResolvedSourceRows {
  readonly sourceKey: string;
  readonly revision: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

/**
 * Identity of the currently authored data binding, independent of presentation.
 * No access grant, connector credential or permission is implied by this key.
 * It intentionally excludes data rows, which carry their own revision + digest.
 */
export function sourceSnapshotKey(
  model: Pick<VisualModel, "id" | "generation" | "renderer" | "content">,
  registry?: VisualFamilyResolver,
): string | undefined {
  const source = visualFamilyIdentity(model.renderer, registry)?.source;
  if (!source) return undefined;
  // Invalid payloads are refused before any family-specific callback can read
  // caller-controlled accessors. This API is used only on trusted model data.
  assertVisualJson(model.content);
  const kind = source.kind(model.content);
  if (kind !== "dataset" && kind !== "render-data" && kind !== "connection") return undefined;
  const inputs = source.inputs(model.content);
  return sha256Hex(
    canonicalVisualJson({
      id: model.id,
      generation: model.generation,
      renderer: model.renderer,
      kind,
      inputs,
    }),
  );
}

/** Revisions name host snapshots; they aren't URLs or executable selectors. */
export function validSourceRevision(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

export interface SourceRowTarget {
  readonly modelId: string;
  readonly generation: string;
  readonly sourceKey: string;
  readonly revision: string;
  readonly rowId: string;
  readonly entityId?: string;
}
