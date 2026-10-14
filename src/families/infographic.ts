import {
  INFOGRAPHIC_SCHEMA,
  validateInfographicAttributes,
  validateInfographicStructure,
} from "../infographic.ts";
import { defineVisualFamily, issuesFrom } from "./family.ts";

export const infographicFamily = defineVisualFamily("infographic", {
  schema: INFOGRAPHIC_SCHEMA,
  validate: (content) =>
    issuesFrom(() => {
      validateInfographicStructure(content);
      validateInfographicAttributes(content);
    }),
  collections: { items: { search: ["label", "desc"] }, relations: { search: ["label"] } },
});
