import type { InfographicContent, InfographicItem } from "../index.ts";

/**
 * Geometry a recipe computes for its text. A saved offset belongs to the
 * recipe it was measured in; carried into another layout it lands the label
 * somewhere arbitrary. Styling (fill, font, opacity) carries over.
 */
const PLACEMENT = new Set(["x", "y", "width", "height", "transform"]);

type RoleAttributes = Record<string, unknown>;

function withoutPlacement(attributes: unknown): { attributes: RoleAttributes; stripped: boolean } {
  if (!attributes || typeof attributes !== "object") return { attributes: {}, stripped: false };
  const kept: RoleAttributes = {};
  let stripped = false;
  for (const [role, style] of Object.entries(attributes)) {
    if (!style || typeof style !== "object") {
      kept[role] = style;
      continue;
    }
    const styling = Object.entries(style).filter(([key]) => !PLACEMENT.has(key));
    if (styling.length !== Object.keys(style).length) stripped = true;
    if (styling.length) kept[role] = Object.fromEntries(styling);
  }
  return { attributes: kept, stripped };
}

/** The content patch that switches an explanation to another recipe. */
export function infographicLayoutChange(
  content: InfographicContent,
  template: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { template };
  let itemsChanged = false;
  const strip = (items: InfographicItem[]): InfographicItem[] =>
    items.map((item) => {
      const next: InfographicItem = item.children
        ? { ...item, children: strip(item.children) }
        : { ...item };
      const { attributes, stripped } = withoutPlacement(item.attributes);
      if (!stripped) return next;
      itemsChanged = true;
      if (Object.keys(attributes).length) next.attributes = attributes;
      else delete next.attributes;
      return next;
    });
  const items = strip(content.items);
  if (itemsChanged) patch.items = items;
  const root = withoutPlacement(content.attributes);
  if (root.stripped)
    patch.attributes = Object.keys(root.attributes).length ? root.attributes : null;
  return patch;
}
