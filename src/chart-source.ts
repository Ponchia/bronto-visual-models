import type { VisualFamilyResolver } from "./family-resolver.ts";
import { visualFamilyIdentity } from "./families/identity.ts";
import { sha256Hex } from "./hash.ts";
import { assertVisualJson, canonicalVisualJson, type VisualModel } from "./model.ts";

/**
 * Rows already resolved and authorized by the host. These bytes are presentation
 * inputs, not saved model content, a datasource request or proof of authority.
 */
export interface ResolvedChartRows {
  /** Identity of the model lifetime and its current, authored source inputs. */
  readonly sourceKey: string;
  /** The host's immutable source snapshot revision. */
  readonly revision: string;
  /** Already materialized JSON records. The view never fetches or mutates them. */
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

/**
 * An opaque fingerprint for the exact bound chart source. The digest contains
 * no raw parameters, connector IDs, dataset names or rows. It deliberately
 * includes the model generation, so a fork or replacement cannot reuse rows
 * from the former model even when the authored source is unchanged.
 *
 * This is a staleness check, NOT a credential, access grant or signature.
 */
export function chartSourceKey(
  model: Pick<VisualModel, "id" | "generation" | "renderer" | "content">,
  registry?: VisualFamilyResolver,
): string | undefined {
  if (model.renderer !== "vega-lite") return undefined;
  const family = visualFamilyIdentity("vega-lite", registry);
  const source = family?.source;
  if (!source) return undefined;
  const kind = source.kind(model.content);
  if (kind !== "dataset" && kind !== "render-data" && kind !== "connection") return undefined;
  // Optional source inputs legitimately contain undefined; validate their
  // author-controlled parent before computing a canonical fingerprint.
  assertVisualJson(model.content);
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
