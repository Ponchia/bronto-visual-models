import type { VisualFamilyResolver } from "./family-resolver.ts";
import { type VisualFamilyIdentity, visualFamilyIdentity } from "./families/identity.ts";
import { supportedModelVersion, VISUAL_MODEL_VERSION, VisualModelError } from "./model.ts";

/** Why this build cannot interpret a model. Each reader or writer decides what that means for it. */
export type VisualIncompatibility =
  /** A newer model format; a compatible build reads it, and nothing here rewrites it. */
  | "newer-model"
  /** A retired model format: retain its bytes without interpreting its content. */
  | "retired-model"
  /** A model version no build wrote. */
  | "malformed-model"
  /** A renderer this build does not install, such as one since removed. */
  | "unknown-renderer"
  /** Content written by a newer version of an installed renderer. */
  | "newer-renderer"
  /** A renderer version no build wrote. */
  | "malformed-renderer-version";
export type VisualCompatibility =
  | { readonly ok: true; readonly family: VisualFamilyIdentity }
  | { readonly ok: false; readonly reason: VisualIncompatibility };

/**
 * Whether this build can interpret a model: its format, its renderer and that
 * renderer's version. One reading for every reader and writer, so a model is
 * never editable in one place and refused as unreadable in another.
 */
export function modelCompatibility(model: {
  readonly schemaVersion: unknown;
  readonly renderer: unknown;
  readonly rendererVersion?: unknown;
}, registry?: VisualFamilyResolver): VisualCompatibility {
  const { schemaVersion } = model;
  if (schemaVersion === 1) return { ok: false, reason: "retired-model" };
  if (typeof schemaVersion === "number" && schemaVersion > VISUAL_MODEL_VERSION)
    return { ok: false, reason: "newer-model" };
  if (!supportedModelVersion(schemaVersion)) return { ok: false, reason: "malformed-model" };
  const family =
    typeof model.renderer === "string" ? visualFamilyIdentity(model.renderer, registry) : undefined;
  if (!family) return { ok: false, reason: "unknown-renderer" };
  const version = model.rendererVersion === undefined ? 1 : model.rendererVersion;
  if (!Number.isSafeInteger(version) || Number(version) < 1)
    return { ok: false, reason: "malformed-renderer-version" };
  if (Number(version) > family.version) return { ok: false, reason: "newer-renderer" };
  return { ok: true, family };
}

/** What a refusal says for each reason: one table, so the wording cannot drift between writes. */
export const VISUAL_INCOMPATIBILITY_MESSAGES: Readonly<Record<VisualIncompatibility, string>> = {
  "newer-model":
    "This model needs a newer model implementation: a newer format wrote it. Its content is preserved",
  "retired-model":
    "This model uses retired schema version 1. Use the pre-retirement release to adopt its identities before opening it here. Its stored content is preserved",
  "malformed-model": "This model's format version is not one any build wrote",
  "unknown-renderer":
    "This model needs a compatible renderer: this build does not install its renderer. Its content is preserved",
  "newer-renderer":
    "This model needs a compatible renderer: a newer version of its renderer wrote it. Its content is preserved",
  "malformed-renderer-version":
    "This model needs a compatible renderer: its renderer version is not one any build wrote. Its content is preserved",
};

/**
 * Refuses a model this build cannot interpret, with the table's message and the
 * reason in the refusal's detail, so an agent branches on the reason, not prose.
 */
export function assertModelCompatible(
  model: Parameters<typeof modelCompatibility>[0],
  code: "forbidden" | "invalid" = "forbidden",
  registry?: VisualFamilyResolver,
): VisualFamilyIdentity {
  const compatibility = modelCompatibility(model, registry);
  if (!compatibility.ok)
    throw new VisualModelError(code, VISUAL_INCOMPATIBILITY_MESSAGES[compatibility.reason], {
      reason: compatibility.reason,
    });
  return compatibility.family;
}
