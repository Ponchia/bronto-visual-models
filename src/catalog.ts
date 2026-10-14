import type { VisualFamilyResolver } from "./family-resolver.ts";
import {
  AgentSchemaValidationError,
  describeIssues,
  limitIssues,
  type ValidationIssue,
  validateAgentSchemaValue,
} from "./schema.ts";
import { RESERVED_OBJECT_KEYS } from "./reserved-keys.ts";
import { CREATIVE_TEMPLATES } from "./creative-templates.ts";
import type { VisualRendererCategory, VisualRendererId } from "./families/identity.ts";
import { VISUAL_FAMILIES, visualFamily } from "./families/index.ts";
import { assertVisualJson, VisualModelError, visualRecord } from "./model.ts";
import { visualRetirement } from "./retired.ts";
import { SEMANTIC_TEMPLATES } from "./semantic-templates.ts";
import { SPATIAL_TEMPLATES } from "./spatial-templates.ts";

export interface VisualRendererDefinition {
  id: string;
  label: string;
  category: VisualRendererCategory;
  description: string;
  modelType: string;
  version: number;
  environment: "svg" | "webgl" | "frame" | "image" | "dom";
  records: readonly string[];
  capabilities: readonly string[];
  schema: Readonly<Record<string, unknown>>;
}
/** The catalog's view of each family: identity, its own adapter's capabilities and its schema. */
export const VISUAL_RENDERERS: readonly (VisualRendererDefinition & { id: VisualRendererId })[] =
  Object.freeze(
    VISUAL_FAMILIES.map((family) => ({
      id: family.id,
      label: family.label,
      category: family.category,
      description: family.description,
      modelType: family.modelType,
      version: family.version,
      environment: family.environment,
      records: family.records,
      capabilities: family.adapters[0]?.capabilities ?? [],
      schema: family.schema,
    })),
  );
export function rendererDefinition(
  family: import("./families/family.ts").VisualFamily,
): VisualRendererDefinition {
  return {
    id: family.id,
    label: family.label,
    category: family.category,
    description: family.description,
    modelType: family.modelType,
    version: family.version,
    environment: family.environment,
    records: family.records,
    capabilities: family.adapters[0]?.capabilities ?? [],
    schema: family.schema,
  };
}
export function visualRenderer(
  id: string,
  registry?: VisualFamilyResolver,
): VisualRendererDefinition {
  if (registry) {
    const family = registry.family(id);
    if (!family) throw new VisualModelError("invalid", `Unknown renderer: ${id}`);
    return rendererDefinition(family);
  }
  const definition = VISUAL_RENDERERS.find((entry) => entry.id === id);
  if (!definition) throw new VisualModelError("invalid", `Unknown renderer: ${id}`);
  return definition;
}
/** The model type a renderer's models record: derived from the renderer, never a second choice. */
export function visualModelType(renderer: string, registry?: VisualFamilyResolver): string {
  return visualRenderer(renderer, registry).modelType;
}
/** How many items one editable collection holds: its family schema's bound, not a second copy. */
export function visualCollectionLimit(
  renderer: string,
  collection: string,
  registry?: VisualFamilyResolver,
): number {
  const definition = visualRenderer(renderer, registry);
  const properties = definition.schema.properties as
    | Readonly<Record<string, { maxItems?: unknown }>>
    | undefined;
  const limit = properties?.[collection]?.maxItems;
  if (!definition.records.includes(collection) || typeof limit !== "number")
    throw new VisualModelError("invalid", "This renderer has no such editable collection");
  return limit;
}
export function validateVisualContent(
  renderer: string,
  modelType: string,
  content: unknown,
  registry?: VisualFamilyResolver,
): asserts content is Record<string, unknown> {
  const definition = visualRenderer(renderer, registry);
  if (modelType !== definition.modelType)
    throw new VisualModelError(
      "invalid",
      `Renderer ${renderer} draws model type ${definition.modelType}, not ${modelType}; omit modelType and it is derived`,
    );
  assertVisualJson(content);
  if (!visualRecord(content))
    throw new VisualModelError("invalid", "Model content must be an object");
  // A write naming a retired field says why it went; a load strips it first (decision 0130).
  for (const field of Object.keys(content)) {
    const retirement = visualRetirement(renderer, field);
    if (retirement)
      throw new VisualModelError("invalid", `${field} was retired: ${retirement.reason}`);
  }
  // The record-id rule refuses these too, as "has an invalid format"; this says
  // why a well-formed name is refused, and replaces that issue on its path.
  const reserved: ValidationIssue[] = [];
  for (const field of definition.records) {
    const values = content[field];
    if (!Array.isArray(values)) continue;
    for (const entry of values)
      if (
        visualRecord(entry) &&
        typeof entry.id === "string" &&
        RESERVED_OBJECT_KEYS.includes(entry.id)
      )
        reserved.push({
          path: [field, entry.id, "id"],
          message: "This id is reserved; choose another",
        });
  }
  try {
    validateAgentSchemaValue(definition.schema, content);
  } catch (error) {
    if (!(error instanceof AgentSchemaValidationError)) throw error;
    const named = new Set(reserved.map((issue) => issue.path.join("\0")));
    const report = limitIssues([
      ...reserved,
      ...error.issues
        .map((issue) => ({ ...issue, path: recordPath(issue.path, content, definition.records) }))
        .filter((issue) => !named.has(issue.path.join("\0"))),
    ]);
    // The schema's own uncounted issues stay counted.
    const issues = { ...report, issuesOmitted: report.issuesOmitted + error.issuesOmitted };
    throw new VisualModelError("invalid", describeIssues(issues), { report: issues });
  }
  if (reserved.length) {
    const report = limitIssues(reserved);
    throw new VisualModelError("invalid", describeIssues(report), { report });
  }
  for (const field of definition.records) {
    const values = content[field];
    if (values === undefined) continue;
    if (!Array.isArray(values)) throw new VisualModelError("invalid", `${field} must be an array`);
    const ids = new Set<string>();
    for (const entry of values) {
      if (!visualRecord(entry) || typeof entry.id !== "string" || !entry.id || ids.has(entry.id))
        throw new VisualModelError("invalid", `${field} requires unique stable IDs`);
      ids.add(entry.id);
    }
  }
  const report = limitIssues(visualFamily(renderer, registry)?.validate?.(content) ?? []);
  if (report.issues.length)
    throw new VisualModelError("invalid", describeIssues(report), { report });
}

/** What valid content says that its renderer draws otherwise: the author's warnings. */
export function visualContentAdvice(
  renderer: string,
  content: Record<string, unknown>,
  registry?: VisualFamilyResolver,
): readonly ValidationIssue[] {
  return visualFamily(renderer, registry)?.advise?.(content) ?? [];
}

/**
 * A schema issue's path with a record's index replaced by its id, the way a
 * family rule names it, so both kinds of issue on one field share a path. An
 * item without a usable id keeps its index.
 */
function recordPath(
  path: readonly string[],
  content: Record<string, unknown>,
  records: readonly string[],
): readonly string[] {
  const [field, index, ...rest] = path;
  if (field === undefined || index === undefined || !records.includes(field)) return path;
  const items = content[field];
  const item = Array.isArray(items) && /^\d+$/u.test(index) ? items[Number(index)] : undefined;
  const id = visualRecord(item) ? item.id : undefined;
  return typeof id === "string" && id ? [field, id, ...rest] : path;
}
/** Former built-in template ids, each with what a request for it is told instead. */
const RENAMED_VISUAL_TEMPLATES: Readonly<Record<string, string>> = Object.freeze({
  diagram:
    "Template diagram was renamed source-diagram (a local D2, Graphviz or Mermaid source). " +
    "The editable graph is the diagram renderer: use --template architecture",
});
export function renamedVisualTemplate(id: unknown): string | undefined {
  return typeof id === "string" && Object.hasOwn(RENAMED_VISUAL_TEMPLATES, id)
    ? RENAMED_VISUAL_TEMPLATES[id]
    : undefined;
}
export interface VisualTemplate {
  id: string;
  title: string;
  description: string;
  renderer: string;
  version: number;
  content: Record<string, unknown>;
}
export const VISUAL_TEMPLATES: readonly VisualTemplate[] = Object.freeze([
  {
    id: "process",
    title: "Process explanation",
    description: "A sequence of identified, editable stages.",
    renderer: "infographic",
    version: 1,
    content: {
      template: "sequence-timeline-simple",
      items: [
        { id: "understand", label: "Understand", desc: "Establish the evidence." },
        { id: "change", label: "Change", desc: "Make the smallest useful change." },
        { id: "verify", label: "Verify", desc: "Check the result with people and agents." },
      ],
    },
  },
  {
    id: "comparison",
    title: "Option comparison",
    description: "Compare identified options without copying their content into a picture.",
    renderer: "infographic",
    version: 1,
    content: {
      template: "list-grid-badge-card",
      items: [
        { id: "a", label: "Option A", desc: "Strengths, constraints and evidence." },
        { id: "b", label: "Option B", desc: "Strengths, constraints and evidence." },
      ],
    },
  },
  {
    id: "chart",
    title: "Data exploration",
    description: "Explicit sample rows; replace these with your measurements.",
    renderer: "vega-lite",
    version: 1,
    content: {
      spec: {
        title: "Untitled chart",
        mark: { type: "bar" },
        encoding: {
          x: { field: "label", type: "nominal", title: null },
          y: { field: "value", type: "quantitative" },
        },
      },
      values: [
        { label: "a", value: 3 },
        { label: "b", value: 7 },
        { label: "c", value: 5 },
      ],
    },
  },
  {
    id: "source-diagram",
    title: "Source diagram",
    description: "A source diagram compiled locally without a remote rendering endpoint.",
    renderer: "source-diagram",
    version: 1,
    content: { language: "d2", source: "Understand -> Change -> Verify" },
  },
  {
    id: "quadrants",
    title: "Four perspectives",
    description:
      "Four identified viewpoints; a bounded quadrant explanation, not a numeric scatterplot.",
    renderer: "infographic",
    version: 1,
    content: {
      template: "compare-quadrant-quarter-simple-card",
      items: [
        { id: "understand", label: "Understand", desc: "Establish what matters." },
        { id: "explore", label: "Explore", desc: "Compare possible approaches." },
        { id: "build", label: "Build", desc: "Make the idea usable." },
        { id: "verify", label: "Verify", desc: "Check against evidence." },
      ],
    },
  },
  {
    id: "pyramid",
    title: "Layers of explanation",
    description: "A short ordered hierarchy of identified stages.",
    renderer: "infographic",
    version: 1,
    content: {
      template: "sequence-pyramid-simple",
      items: [
        { id: "purpose", label: "Purpose", desc: "Why it matters" },
        { id: "principles", label: "Principles", desc: "How decisions are made" },
        { id: "practice", label: "Practice", desc: "What people do" },
      ],
    },
  },
  {
    id: "funnel",
    title: "Progressive focus",
    description: "An illustrative narrowing process with editable identified stages.",
    renderer: "infographic",
    version: 1,
    content: {
      template: "sequence-funnel-simple",
      items: [
        { id: "signals", label: "Signals", desc: "Gather context" },
        { id: "options", label: "Options", desc: "Compare alternatives" },
        { id: "decision", label: "Decision", desc: "Choose and verify" },
      ],
    },
  },
  ...SPATIAL_TEMPLATES,
  ...SEMANTIC_TEMPLATES,
  ...CREATIVE_TEMPLATES,
]);
