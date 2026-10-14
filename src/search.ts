import { searchableItems } from "./families/family.ts";
import { visualFamily } from "./families/index.ts";
import type { VisualModel } from "./model.ts";

const MAX_TEXT = 524288;
/** Only authored meaning is searchable. Rows, arbitrary app state, paths and credentials are not a corpus. */
export function visualSearchText(model: VisualModel): { text: string; truncated: boolean } {
  const family = visualFamily(model.renderer);
  const parts: unknown[] = [model.title, model.description, model.modelType];
  for (const [collection, rules] of Object.entries(family?.collections ?? {}))
    parts.push(...searchableItems(model.content[collection], rules.search));
  parts.push(...(family?.searchText?.(model.content) ?? []));
  const text = parts
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .normalize("NFC");
  return { text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
}
