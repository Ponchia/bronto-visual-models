import type { VisualFamilyResolver } from "../family-resolver.ts";
import { VisualModelError, visualRecord } from "../model.ts";
import { offsetInstant } from "../timeline-source.ts";
import type { VisualFieldDescriptors } from "./family.ts";
import { visualFamily } from "./index.ts";

type Content = Record<string, unknown>;

/** The fields a family stores as epoch milliseconds, each as its dotted path. */
const epochFields = (fields: VisualFieldDescriptors | undefined) =>
  Object.entries(fields ?? {})
    .filter(([, descriptor]) => descriptor.format === "epoch-ms")
    .map(([name]) => name.split("."));

function withTimes(record: Content, paths: readonly string[][], owner: string): Content {
  let result = record;
  for (const path of paths) {
    const parents: Content[] = [result];
    for (const key of path.slice(0, -1)) {
      const next = parents.at(-1)?.[key];
      if (!visualRecord(next)) break;
      parents.push(next);
    }
    if (parents.length !== path.length) continue;
    const value = parents.at(-1)?.[path.at(-1) as string];
    if (typeof value !== "string") continue;
    const time = offsetInstant(value);
    if (!Number.isFinite(time))
      throw new VisualModelError(
        "invalid",
        `${owner}: ${path.join(".")} must be epoch milliseconds or an ISO timestamp with a timezone, such as 2026-10-01T09:00:00+02:00`,
      );
    // Copy the path down to the field, so the request itself is never rewritten.
    let replaced: unknown = time;
    for (let depth = path.length - 1; depth >= 0; depth -= 1)
      replaced = { ...parents[depth], [path[depth] as string]: replaced };
    result = replaced as Content;
  }
  return result;
}

/**
 * Authored times are stored as epoch milliseconds: the fields a family
 * describes with `format: "epoch-ms"`. A write may name one as an ISO
 * timestamp with an explicit offset, and it is stored as the instant that
 * names. Text without an offset is refused, because a device's timezone is not
 * the author's. Content with nothing to convert is answered as it came.
 */
export function withAuthoredTimes(renderer: string, content: Content, registry?: VisualFamilyResolver): Content {
  const family = visualFamily(renderer, registry);
  if (!family) return content;
  let result = content;
  for (const [collection, rules] of Object.entries(family.collections)) {
    const paths = epochFields(rules.fields);
    const items = content[collection];
    if (!paths.length || !Array.isArray(items)) continue;
    let changed: unknown[] | undefined;
    items.forEach((item, index) => {
      if (!visualRecord(item)) return;
      const next = withTimes(item, paths, `${collection} ${String(item.id)}`);
      if (next === item) return;
      changed ??= [...items];
      changed[index] = next;
    });
    if (changed) result = { ...result, [collection]: changed };
  }
  return withTimes(result, epochFields(family.fields), "content");
}
