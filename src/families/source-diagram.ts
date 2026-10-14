import { SOURCE_DIAGRAM_SCHEMA } from "../source-diagram.ts";
import { defineVisualFamily } from "./family.ts";

export const sourceDiagramFamily = defineVisualFamily("source-diagram", {
  schema: SOURCE_DIAGRAM_SCHEMA,
  collections: {},
  searchText: (content) => [content.source],
});
