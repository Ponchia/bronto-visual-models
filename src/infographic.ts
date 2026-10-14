import { VISUAL_RECORD_ID_SCHEMA as identifier, VisualModelError, visualRecord } from "./model.ts";

const text = { type: "string", maxLength: 2000 };

export interface InfographicRecipe {
  id: string;
  label: string;
  family: "sequence" | "list" | "comparison" | "hierarchy" | "relationship";
  min: number;
  max: number;
  depth: number;
  roots?: readonly [number, number];
}

/** Reviewed structures, not every upstream style variant. These load no external assets or animations. */
export const INFOGRAPHIC_RECIPES: readonly InfographicRecipe[] = [
  {
    id: "sequence-timeline-simple",
    label: "Timeline explanation",
    family: "sequence",
    min: 0,
    max: 100,
    depth: 1,
  },
  {
    id: "sequence-steps-simple",
    label: "Numbered steps",
    family: "sequence",
    min: 0,
    max: 100,
    depth: 1,
  },
  {
    id: "list-row-simple-horizontal-arrow",
    label: "Horizontal progression",
    family: "list",
    min: 0,
    max: 100,
    depth: 1,
  },
  { id: "list-grid-badge-card", label: "Card grid", family: "list", min: 0, max: 100, depth: 1 },
  {
    id: "list-column-simple-vertical-arrow",
    label: "Vertical progression",
    family: "list",
    min: 0,
    max: 100,
    depth: 1,
  },
  {
    id: "compare-quadrant-quarter-simple-card",
    label: "Four perspectives",
    family: "comparison",
    min: 0,
    max: 4,
    depth: 1,
  },
  {
    id: "sequence-pyramid-simple",
    label: "Layered pyramid",
    family: "sequence",
    min: 0,
    max: 12,
    depth: 1,
  },
  {
    id: "sequence-funnel-simple",
    label: "Progressive funnel",
    family: "sequence",
    min: 0,
    max: 12,
    depth: 1,
  },
  { id: "sequence-circular-simple", label: "Cycle", family: "sequence", min: 2, max: 12, depth: 1 },
  {
    id: "sequence-roadmap-vertical-simple",
    label: "Winding roadmap",
    family: "sequence",
    min: 1,
    max: 16,
    depth: 1,
  },
  {
    id: "hierarchy-tree-lr-curved-line-rounded-rect-node",
    label: "Branching tree",
    family: "hierarchy",
    min: 1,
    max: 60,
    depth: 6,
    roots: [1, 1],
  },
  {
    id: "hierarchy-mindmap-branch-gradient-lined-palette",
    label: "Mind map",
    family: "hierarchy",
    min: 1,
    max: 40,
    depth: 6,
    roots: [1, 1],
  },
  {
    id: "spatial-comparison-columns",
    label: "Comparison columns",
    family: "comparison",
    min: 2,
    max: 32,
    depth: 2,
    roots: [2, 4],
  },
  {
    id: "relation-dagre-flow-lr-compact-card",
    label: "Relationship flow · across",
    family: "relationship",
    min: 1,
    max: 40,
    depth: 1,
  },
  {
    id: "relation-dagre-flow-tb-compact-card",
    label: "Relationship flow · down",
    family: "relationship",
    min: 1,
    max: 40,
    depth: 1,
  },
];

export interface InfographicItem extends Record<string, unknown> {
  id: string;
  label: string;
  parentId?: string;
  children?: InfographicItem[];
}
export interface InfographicContent extends Record<string, unknown> {
  template?: string;
  items: InfographicItem[];
  relations?: Array<{
    id: string;
    from: string;
    to: string;
    label: string;
    direction?: "forward" | "both" | "none";
  }>;
}

export function infographicRecipe(template: unknown): InfographicRecipe | undefined {
  return INFOGRAPHIC_RECIPES.find((entry) => entry.id === (template ?? "sequence-timeline-simple"));
}
const attributes = {
  type: "object",
  properties: {
    x: { type: "number", minimum: -4000, maximum: 4000 },
    y: { type: "number", minimum: -4000, maximum: 4000 },
    width: { type: "number", minimum: 0, maximum: 4000 },
    height: { type: "number", minimum: 0, maximum: 4000 },
    transform: { type: "string", maxLength: 512 },
    fill: { type: "string", maxLength: 80 },
    stroke: { type: "string", maxLength: 80 },
    "font-size": { type: "number", minimum: 8, maximum: 160 },
    "font-weight": {
      anyOf: [
        { type: "string", maxLength: 20 },
        { type: "number", minimum: 100, maximum: 1000 },
      ],
    },
    "font-family": { type: "string", maxLength: 120 },
    "text-anchor": { type: "string", enum: ["start", "middle", "end"] },
    opacity: { type: "number", minimum: 0, maximum: 1 },
  },
  additionalProperties: false,
};
const itemAttributes = {
  type: "object",
  properties: { label: attributes, desc: attributes, value: attributes },
  additionalProperties: false,
};
const item = {
  type: "object",
  required: ["id", "label"],
  properties: {
    id: identifier,
    entityId: identifier,
    parentId: identifier,
    label: { type: "string", minLength: 1, maxLength: 200 },
    desc: text,
    attributes: itemAttributes,
    value: { type: "number" },
    x: { type: "number", minimum: -2000, maximum: 2000 },
    y: { type: "number", minimum: -2000, maximum: 2000 },
  },
  additionalProperties: false,
};

export const INFOGRAPHIC_SCHEMA = {
  type: "object",
  required: ["items"],
  additionalProperties: false,
  properties: {
    template: { type: "string", enum: INFOGRAPHIC_RECIPES.map((recipe) => recipe.id) },
    items: { type: "array", maxItems: 100, items: item },
    relations: {
      type: "array",
      maxItems: 80,
      items: {
        type: "object",
        required: ["id", "from", "to", "label"],
        additionalProperties: false,
        properties: {
          id: identifier,
          from: identifier,
          to: identifier,
          label: text,
          direction: { type: "string", enum: ["forward", "both", "none"] },
        },
      },
    },
    attributes: {
      type: "object",
      properties: { title: attributes, desc: attributes },
      additionalProperties: false,
    },
    theme: { type: "string", enum: ["default", "dark", "hand-drawn"] },
  },
} as const;

export function validateInfographicStructure(content: Record<string, unknown>): void {
  const recipe = infographicRecipe(content.template);
  if (!recipe) throw new VisualModelError("invalid", "Unsupported infographic recipe.");
  const { items, relations = [] } = content as InfographicContent;
  if (items.length < recipe.min || items.length > recipe.max)
    throw new VisualModelError(
      "invalid",
      `${recipe.label} supports ${recipe.min}–${recipe.max} readable items; no items are silently hidden.`,
    );
  const byId = new Map(items.map((item) => [item.id, item]));
  const roots = items.filter((item) => !item.parentId);
  if (recipe.roots && (roots.length < recipe.roots[0] || roots.length > recipe.roots[1]))
    throw new VisualModelError(
      "invalid",
      `${recipe.label} requires ${recipe.roots[0]}–${recipe.roots[1]} root items. Start with a compatible template or explicitly prepare the hierarchy.`,
    );
  for (const item of items) {
    const seen = new Set([item.id]);
    let parent = item.parentId;
    while (parent) {
      if (seen.has(parent))
        throw new VisualModelError("invalid", "Infographic parents must be acyclic.");
      const ancestor = byId.get(parent);
      if (!ancestor)
        throw new VisualModelError("invalid", "An infographic parent must name an existing item.");
      seen.add(parent);
      parent = ancestor.parentId;
    }
    if (seen.size > recipe.depth)
      throw new VisualModelError(
        "invalid",
        `${recipe.label} displays at most ${recipe.depth} levels; choose a compatible hierarchy layout.`,
      );
  }
  if (relations.length && recipe.family !== "relationship")
    throw new VisualModelError(
      "invalid",
      "Choose a relationship layout to keep every authored relationship visible.",
    );
  for (const relation of relations)
    if (!byId.has(relation.from) || !byId.has(relation.to))
      throw new VisualModelError(
        "invalid",
        "A relationship must name existing source and target items.",
      );
}

/** Expand flat stable-ID records for the engine only. The canonical document remains flat. */
export function infographicTree(content: InfographicContent): InfographicItem[] {
  if ((infographicRecipe(content.template)?.depth ?? 1) === 1)
    return content.items.map((item) => ({ ...item }));
  const nodes = new Map(
    content.items.map((item) => [item.id, { ...item, children: [] as InfographicItem[] }]),
  );
  const roots: InfographicItem[] = [];
  for (const item of content.items) {
    const node = nodes.get(item.id);
    if (!node) continue;
    if (item.parentId) nodes.get(item.parentId)?.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function infographicIndexPath(raw: string | null | undefined): number[] | undefined {
  if (!raw || !/^\d+(?:,\d+){0,5}$/.test(raw)) return;
  const path = raw.split(",").map(Number);
  return path.every((index) => Number.isSafeInteger(index) && index >= 0 && index < 100)
    ? path
    : undefined;
}

export function infographicAtPath(
  items: readonly InfographicItem[],
  path: readonly number[] | undefined,
): InfographicItem | undefined {
  if (!path?.length || path.length > 6) return;
  let current = items;
  let item: InfographicItem | undefined;
  for (const index of path) {
    if (!Number.isSafeInteger(index) || index < 0) return;
    item = current[index];
    if (!item) return;
    current = item.children ?? [];
  }
  return item;
}

export function validateInfographicAttributes(content: Record<string, unknown>): void {
  const validate = (value: unknown) => {
    if (!visualRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (
        key === "transform" &&
        typeof child === "string" &&
        !/^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([0-9eE.,+\-\s]+\)\s*)+$/.test(child)
      )
        throw new VisualModelError("invalid", "Only numeric SVG transforms are permitted");
      if (typeof child === "string" && /url\s*\(|javascript:|data:|<|>/i.test(child))
        throw new VisualModelError(
          "invalid",
          "Infographic styling cannot load resources or markup",
        );
      if (visualRecord(child)) validate(child);
    }
  };
  validate(content.attributes);
  for (const item of content.items as Array<Record<string, unknown>>) validate(item.attributes);
}
