import { SCENE_3D_SCHEMA, validateScene3D } from "../scene3d.ts";
import { defineVisualFamily, issuesFrom, nestedCascade } from "./family.ts";

const placed = { search: ["label", "entityId"] } as const;
export const scene3dFamily = defineVisualFamily("scene3d", {
  schema: SCENE_3D_SCHEMA,
  validate: (content) => issuesFrom(() => validateScene3D(content)),
  collections: {
    nodes: {
      ...placed,
      // An object takes what it holds, and a dimension line leaves with either end.
      cascade: nestedCascade("nodes", "measures", ["from", "to"]),
      removalNote:
        "Removing this object also removes the objects it holds and the measures that reach it. The change is saved to the model source.",
    },
    assets: placed,
    viewpoints: placed,
    measures: {
      search: ["label"],
      fields: {
        from: { label: "From", control: "ref", ref: "nodes" },
        to: { label: "To", control: "ref", ref: "nodes" },
      },
    },
  },
});
