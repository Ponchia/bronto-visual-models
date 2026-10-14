/** Local source renderers are a reviewed, closed language surface, not an outbound service catalogue. */
export const DIAGRAM_LANGUAGES = ["d2", "graphviz", "mermaid"] as const;
export type DiagramLanguage = (typeof DIAGRAM_LANGUAGES)[number];
export const MAX_DIAGRAM_SOURCE_CHARS = 20_000;
export function isDiagramLanguage(value: unknown): value is DiagramLanguage {
  return typeof value === "string" && (DIAGRAM_LANGUAGES as readonly string[]).includes(value);
}
export const SOURCE_DIAGRAM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["language", "source"],
  properties: {
    language: { type: "string", enum: DIAGRAM_LANGUAGES },
    source: { type: "string", minLength: 1, maxLength: MAX_DIAGRAM_SOURCE_CHARS },
  },
} as const;

