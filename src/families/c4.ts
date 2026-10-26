import { C4_SCHEMA, type C4Content, type C4Element, type C4View } from "../c4.ts";
import { defineVisualFamily, SEMANTIC_FIELDS, type VisualIssue } from "./family.ts";

/** Allowed abstraction levels, rather than hiding invalid authored elements at render time. */
export function c4ElementAllowed(
  view: C4View,
  element: C4Element,
  elements: ReadonlyMap<string, C4Element>,
): boolean {
  if (view.kind === "landscape" || view.kind === "context")
    return element.kind === "person" || element.kind === "software-system";
  if (element.id === view.scope) return false; // The scope is a boundary, not also a card.
  if (element.kind === "person" || element.kind === "software-system") {
    const scope = elements.get(view.scope!);
    return element.id !== scope?.parentId;
  }
  if (view.kind === "container")
    return element.kind === "container" && element.parentId === view.scope;
  const scope = elements.get(view.scope!);
  return (
    (element.kind === "component" && element.parentId === view.scope) ||
    (element.kind === "container" && element.parentId === scope?.parentId)
  );
}
function issues(content: Record<string, unknown>): VisualIssue[] {
  const c4 = content as unknown as C4Content;
  const result: VisualIssue[] = [];
  const at = (path: string[], message: string) => result.push({ path, message });
  const elements = new Map(c4.elements.map((e) => [e.id, e]));
  const relationships = new Map(c4.relationships.map((r) => [r.id, r]));
  for (const [collection, rows] of [
    ["elements", c4.elements],
    ["relationships", c4.relationships],
    ["views", c4.views],
  ] as const)
    for (const row of rows) {
      if (!row.label.trim()) at([collection, row.id, "label"], "A C4 label cannot be blank");
      if ("technology" in row && row.technology !== undefined && !row.technology.trim())
        at([collection, row.id, "technology"], "Technology cannot be blank");
    }
  for (const element of c4.elements) {
    const path = (field: string) => ["elements", element.id, field];
    if (!element.description.trim())
      at(path("description"), "Describe this element's responsibility");
    const parentKind =
      element.kind === "container"
        ? "software-system"
        : element.kind === "component"
          ? "container"
          : undefined;
    if (parentKind) {
      if (!element.parentId || elements.get(element.parentId)?.kind !== parentKind)
        at(path("parentId"), `A ${element.kind} must belong to an existing ${parentKind}`);
      if (!element.technology?.trim())
        at(path("technology"), "Containers and components require a technology");
    } else if (element.parentId !== undefined)
      at(path("parentId"), "People and software systems are top-level elements");
  }
  for (const relation of c4.relationships) {
    for (const end of ["source", "target"] as const)
      if (!elements.has(relation[end]))
        at(["relationships", relation.id, end], "A C4 relationship endpoint must exist");
    if (relation.source === relation.target)
      at(
        ["relationships", relation.id],
        "A static C4 relationship must connect different elements",
      );
  }
  for (const view of c4.views) {
    const path = (field: string) => ["views", view.id, field];
    const scope = view.scope ? elements.get(view.scope) : undefined;
    if (view.kind === "landscape") {
      if (view.scope !== undefined)
        at(path("scope"), "A system landscape does not have a single scope");
    } else {
      const expected = view.kind === "component" ? "container" : "software-system";
      if (!scope || scope.kind !== expected)
        at(path("scope"), `This C4 view requires a ${expected} scope`);
    }
    const included = new Set(view.elementIds);
    if (included.size !== view.elementIds.length)
      at(path("elementIds"), "A view includes each element at most once");
    if (view.kind === "context" && !included.has(view.scope!))
      at(path("elementIds"), "A system context must include its software system");
    for (const id of included) {
      const element = elements.get(id);
      if (!element) at(path("elementIds"), `Absent C4 element: ${id}`);
      else if (!c4ElementAllowed(view, element, elements))
        at(path("elementIds"), `${id} is outside this C4 view's abstraction level or scope`);
    }
    if (view.relationshipIds) {
      if (new Set(view.relationshipIds).size !== view.relationshipIds.length)
        at(path("relationshipIds"), "A view includes each relationship at most once");
      for (const id of view.relationshipIds) {
        const relationship = relationships.get(id);
        if (
          !relationship ||
          !included.has(relationship.source) ||
          !included.has(relationship.target)
        )
          at(
            path("relationshipIds"),
            `Relationship ${id} must exist and both endpoints must be included`,
          );
      }
    }
    const placed = new Set<string>();
    for (const position of view.positions ?? []) {
      if (!included.has(position.elementId) || placed.has(position.elementId))
        at(path("positions"), "Positions name distinct elements included in this view");
      placed.add(position.elementId);
    }
  }
  return result;
}
const removalNote =
  "Remove dependent elements, relationships and view references in the same edit. No diagram or architecture element is silently deleted.";
export const c4Family = defineVisualFamily("c4", {
  schema: C4_SCHEMA,
  validate: issues,
  advise: (content) => {
    const c4 = content as unknown as C4Content;
    const kinds = new Map(c4.elements.map((e) => [e.id, e.kind]));
    return c4.relationships
      .filter(
        (r) =>
          !r.technology &&
          kinds.get(r.source) === "container" &&
          kinds.get(r.target) === "container",
      )
      .map((r) => ({
        path: ["relationships", r.id, "technology"],
        message: "Name the protocol for this container-to-container relationship",
      }));
  },
  collections: {
    elements: {
      search: ["label", "description", "technology", "kind", "entityId"],
      removalNote,
      fields: {
        ...SEMANTIC_FIELDS,
        kind: { label: "C4 abstraction", control: "choice" },
        technology: { label: "Technology", control: "text" },
        parentId: { label: "Belongs to", control: "ref", ref: "elements" },
        external: { label: "External" },
        shape: { label: "Notation", control: "choice" },
      },
    },
    relationships: {
      search: ["label", "description", "technology", "entityId"],
      removalNote,
      fields: {
        ...SEMANTIC_FIELDS,
        source: { label: "From", control: "ref", ref: "elements" },
        target: { label: "To", control: "ref", ref: "elements" },
        technology: { label: "Protocol", control: "text" },
      },
    },
    views: {
      search: ["label", "description", "kind"],
      fields: {
        ...SEMANTIC_FIELDS,
        kind: { label: "Diagram level", control: "choice" },
        scope: { label: "Scope", control: "ref", ref: "elements" },
        elementIds: { label: "Included elements" },
        relationshipIds: { label: "Included relationships" },
        positions: { label: "Diagram positions", hidden: true },
      },
    },
  },
});
