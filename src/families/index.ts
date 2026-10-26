import type { VisualFamilyResolver } from "../family-resolver.ts";
import { c4Family } from "./c4.ts";
import { analysisFamily } from "./analysis.ts";
import { diagramFamily } from "./diagram.ts";
import type { VisualFamily } from "./family.ts";
import { ganttFamily } from "./gantt.ts";
import { geographyFamily } from "./geography.ts";
import { VISUAL_FAMILY_IDENTITIES, type VisualRendererId } from "./identity.ts";
import { infographicFamily } from "./infographic.ts";
import { scene3dFamily } from "./scene3d.ts";
import { sourceDiagramFamily } from "./source-diagram.ts";
import { spatialLayersFamily } from "./spatial-layers.ts";
import { timelineFamily } from "./timeline.ts";
import { vegaLiteFamily } from "./vega-lite.ts";

const families = {
  c4: c4Family,
  scene3d: scene3dFamily,
  "spatial-layers": spatialLayersFamily,
  diagram: diagramFamily,
  timeline: timelineFamily,
  gantt: ganttFamily,
  analysis: analysisFamily,
  geography: geographyFamily,
  infographic: infographicFamily,
  "vega-lite": vegaLiteFamily,
  "source-diagram": sourceDiagramFamily,
} satisfies { [Id in VisualRendererId]: VisualFamily & { id: Id } };

/** Every family's authoring contract, in identity order. */
export const VISUAL_FAMILIES: readonly (VisualFamily & { id: VisualRendererId })[] = Object.freeze(
  VISUAL_FAMILY_IDENTITIES.map((identity) => families[identity.id]),
);

/** The one authoring lookup by renderer id; undefined for a renderer this build does not know. */
export function visualFamily(
  id: string,
  registry?: VisualFamilyResolver,
): VisualFamily | undefined {
  if (registry) return registry.family(id);
  return Object.hasOwn(families, id) ? families[id as VisualRendererId] : undefined;
}
