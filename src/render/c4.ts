import {
  C4_KIND_LABELS,
  type C4Content,
  type C4Element,
  type C4Position,
  type C4View,
} from "../c4.ts";
import {
  assertVisualJson,
  assertKnownFields,
  VisualModelError,
  type VisualModel,
} from "../model.ts";
import { assertVisualModel, type ModelEdit } from "../operations.ts";

export const C4_CARD = { width: 260, height: 216 } as const;
export interface C4SceneElement {
  element: C4Element;
  x: number;
  y: number;
}
export interface C4Scene {
  view: C4View;
  elements: C4SceneElement[];
  relationships: C4Content["relationships"];
  boundary?: { element: C4Element; x: number; y: number; width: number; height: number };
}
/** For validated content. No inferred/rolled-up relationships, network or saved writes. */
export function c4Scene(content: C4Content, viewId: string): C4Scene {
  const view = content.views.find((v) => v.id === viewId);
  if (!view) throw new VisualModelError("not-found", `C4 diagram ${viewId} does not exist`);
  const index = new Map(content.elements.map((e) => [e.id, e]));
  const included = new Set(view.elementIds);
  const explicit = view.relationshipIds ? new Set(view.relationshipIds) : undefined;
  const relationships = content.relationships.filter(
    (r) => included.has(r.source) && included.has(r.target) && (!explicit || explicit.has(r.id)),
  );
  const positions = new Map(view.positions?.map((p) => [p.elementId, p]));
  const scope = view.scope ? index.get(view.scope) : undefined;
  const bounded = view.kind === "container" || view.kind === "component";
  const primary = new Set(
    view.elementIds.filter((id) =>
      bounded ? index.get(id)?.parentId === view.scope : id === view.scope,
    ),
  );
  const receivesFromPrimary = new Set(
    relationships.filter((r) => primary.has(r.source)).map((r) => r.target),
  );
  const counts = [0, 0, 0];
  const elements = view.elementIds.map((id) => {
    const element = index.get(id);
    if (!element) throw new VisualModelError("invalid", `Absent C4 element: ${id}`);
    const receives = receivesFromPrimary.has(id);
    const column = primary.has(id)
      ? 1
      : element.kind === "person" || (!receives && element.kind === "container")
        ? 0
        : 2;
    const row = counts[column]++;
    const saved = positions.get(id);
    return { element, x: saved?.x ?? column * 500, y: saved?.y ?? row * 320 + 100 };
  });
  const inside = elements.filter((e) => primary.has(e.element.id));
  let boundary: C4Scene["boundary"];
  if (bounded && scope && inside.length) {
    const x = Math.min(...inside.map((e) => e.x)) - 32;
    const y = Math.min(...inside.map((e) => e.y)) - 72;
    boundary = {
      element: scope,
      x,
      y,
      width: Math.max(...inside.map((e) => e.x + C4_CARD.width)) - x + 32,
      height: Math.max(...inside.map((e) => e.y + C4_CARD.height)) - y + 32,
    };
  }
  return { view, elements, relationships, ...(boundary ? { boundary } : {}) };
}
export function c4ElementText(element: C4Element): string {
  return [
    element.label,
    C4_KIND_LABELS[element.kind],
    element.technology,
    element.description,
    element.external ? "External" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}
function architecture(model: VisualModel): C4Content {
  assertVisualModel(model);
  if (model.renderer !== "c4")
    throw new VisualModelError("invalid", "This operation requires a C4 architecture model");
  return model.content as unknown as C4Content;
}
/** Conservative revision guard also prevents editing a replacement that reused an element ID. */
export function c4RecordEdit(
  model: VisualModel,
  collection: "elements" | "relationships",
  id: string,
  values: { label?: string; description?: string; technology?: string | null },
): ModelEdit {
  const content = architecture(model);
  assertVisualJson(values);
  assertKnownFields(values, ["label", "description", "technology"]);
  if (!Object.keys(values).length) throw new VisualModelError("invalid", "No C4 fields changed");
  const row = content[collection].find((e) => e.id === id);
  if (!row) throw new VisualModelError("not-found", `C4 ${collection} record does not exist`);
  const record = row as unknown as Record<string, unknown>;
  return {
    generation: model.generation,
    ifRevision: model.revision,
    items: [
      {
        field: collection,
        set: [
          {
            id,
            ...structuredClone(values),
            expect: Object.fromEntries(
              Object.keys(values).map((field) => [field, record[field] ?? null]),
            ),
          },
        ],
      },
    ],
  };
}
/** Layout is per named diagram. The reviewed base is checked again by preview/execute. */
export function c4PositionEdit(
  model: VisualModel,
  viewId: string,
  positions: C4Position[],
): ModelEdit {
  const content = architecture(model);
  assertVisualJson(positions);
  const view = content.views.find((v) => v.id === viewId);
  if (!view) throw new VisualModelError("not-found", "C4 diagram does not exist");
  return {
    generation: model.generation,
    ifRevision: model.revision,
    items: [
      {
        field: "views",
        set: [
          {
            id: viewId,
            positions: structuredClone(positions),
            expect: { positions: view.positions ?? null },
          },
        ],
      },
    ],
  };
}
