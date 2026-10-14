import { SPATIAL_LAYER_SCHEMA, validateSpatialLayers } from "../spatial-layers.ts";
import { datasetSearchText, defineVisualFamily, issuesFrom, searchableItems } from "./family.ts";

export const spatialLayersFamily = defineVisualFamily("spatial-layers", {
  schema: SPATIAL_LAYER_SCHEMA,
  validate: (content) => issuesFrom(() => validateSpatialLayers(content)),
  collections: { layers: { search: ["label"] } },
  // Rows are authored meaning only while the model holds them; a dataset's rows are not a corpus.
  searchText: (content) => [
    ...datasetSearchText(content),
    ...(content.datasource ? [] : searchableItems(content.rows, ["label", "entityId"])),
  ],
});
