import { VISUAL_RECORD_ID_SCHEMA as id } from "./model.ts";
import type { SemanticEntity } from "./semantic.ts";

/** C4 architecture is its own family, not a graph with lossy conversion rules. */
export const C4_ELEMENT_KINDS = ["person", "software-system", "container", "component"] as const;
export type C4ElementKind = (typeof C4_ELEMENT_KINDS)[number];
export const C4_VIEW_KINDS = ["landscape", "context", "container", "component"] as const;
export type C4ViewKind = (typeof C4_VIEW_KINDS)[number];
export const C4_KIND_LABELS: Readonly<Record<C4ElementKind, string>> = {
  person: "Person",
  "software-system": "Software system",
  container: "Container",
  component: "Component",
};
export const C4_VIEW_LABELS: Readonly<Record<C4ViewKind, string>> = {
  landscape: "System landscape",
  context: "System context",
  container: "Container diagram",
  component: "Component diagram",
};
export interface C4Element extends SemanticEntity {
  kind: C4ElementKind;
  description: string;
  /** A container belongs to a software system; a component belongs to a container. */
  parentId?: string;
  technology?: string;
  external?: boolean;
  shape?: "box" | "database" | "queue";
}
export interface C4Relationship extends SemanticEntity {
  source: string;
  target: string;
  technology?: string;
}
export interface C4Position {
  elementId: string;
  x: number;
  y: number;
}
export interface C4View extends SemanticEntity {
  kind: C4ViewKind;
  /** Required except for a system landscape. Never an implicit level conversion. */
  scope?: string;
  elementIds: string[];
  /** Omit to show the explicitly authored relationships whose endpoints are both included. */
  relationshipIds?: string[];
  /** Coordinates belong to this named diagram, never to the architecture element. */
  positions?: C4Position[];
}
export interface C4Content {
  elements: C4Element[];
  relationships: C4Relationship[];
  views: C4View[];
}
export const C4_LIMITS = {
  elements: 1000,
  relationships: 2000,
  views: 64,
  viewElements: 300,
} as const;
const text = (maxLength: number, minLength = 0) => ({ type: "string", minLength, maxLength });
const record = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const array = (items: unknown, maxItems: number) => ({ type: "array", items, maxItems });
const common = { id, label: text(240, 1), description: text(4000), entityId: id };
const coordinate = { type: "number", minimum: -100000, maximum: 100000 };
export const C4_SCHEMA = record(
  {
    elements: array(
      record(
        {
          ...common,
          description: text(4000, 1),
          kind: { type: "string", enum: C4_ELEMENT_KINDS },
          parentId: id,
          technology: text(240, 1),
          external: { type: "boolean" },
          shape: { type: "string", enum: ["box", "database", "queue"] },
        },
        ["id", "label", "description", "kind"],
      ),
      C4_LIMITS.elements,
    ),
    relationships: array(
      record({ ...common, source: id, target: id, technology: text(240, 1) }, [
        "id",
        "label",
        "source",
        "target",
      ]),
      C4_LIMITS.relationships,
    ),
    views: array(
      record(
        {
          ...common,
          kind: { type: "string", enum: C4_VIEW_KINDS },
          scope: id,
          elementIds: array(id, C4_LIMITS.viewElements),
          relationshipIds: array(id, C4_LIMITS.relationships),
          positions: array(
            record({ elementId: id, x: coordinate, y: coordinate }, ["elementId", "x", "y"]),
            C4_LIMITS.viewElements,
          ),
        },
        ["id", "label", "kind", "elementIds"],
      ),
      C4_LIMITS.views,
    ),
  },
  ["elements", "relationships", "views"],
);
