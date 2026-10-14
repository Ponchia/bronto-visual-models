import { canonicalVisualJson, type VisualModel, visualRecord } from "./model.ts";
export interface VisualDifference {
  path: string;
  before: unknown;
  after: unknown;
}
/** Bounded, value-only comparison of saved models. It never resolves live sources. */
export function compareVisualModels(
  left: VisualModel,
  right: VisualModel,
  limit = 200,
): { changes: VisualDifference[]; truncated: boolean } {
  const changes: VisualDifference[] = [];
  let truncated = false;
  const add = (path: string, before: unknown, after: unknown) => {
    if (changes.length < limit) changes.push({ path, before, after });
    else truncated = true;
  };
  const compare = (before: unknown, after: unknown, path: string) => {
    if (
      truncated ||
      before === after ||
      (before !== undefined &&
        after !== undefined &&
        canonicalVisualJson(before) === canonicalVisualJson(after))
    )
      return;
    if (visualRecord(before) && visualRecord(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
        compare(before[key], after[key], `${path}.${key}`);
    } else if (
      Array.isArray(before) &&
      Array.isArray(after) &&
      [...before, ...after].every((entry) => visualRecord(entry) && typeof entry.id === "string")
    ) {
      const a = new Map(before.map((item) => [item.id, item])),
        b = new Map(after.map((item) => [item.id, item]));
      for (const id of new Set([...a.keys(), ...b.keys()]))
        compare(a.get(id), b.get(id), `${path}[${id}]`);
      const from = before.map((item) => item.id),
        to = after.map((item) => item.id);
      if (canonicalVisualJson(from) !== canonicalVisualJson(to)) add(`${path}.$order`, from, to);
    } else add(path, before, after);
  };
  compare(
    {
      title: left.title,
      description: left.description,
      renderer: left.renderer,
      modelType: left.modelType,
      content: left.content,
    },
    {
      title: right.title,
      description: right.description,
      renderer: right.renderer,
      modelType: right.modelType,
      content: right.content,
    },
    "model",
  );
  return { changes, truncated };
}
