import type { ELK } from "elkjs";
import type { VisualModel } from "../model.ts";
import { layoutC4 as withEngine, type C4LayoutOptions, type C4LayoutContext } from "./c4.ts";
export type { C4LayoutOptions, C4LayoutContext, C4LayoutProposal, C4LayoutRunner } from "./c4.ts";
/** In-process convenience only; interactive applications should supply a cancellable worker. */
export function layoutC4(
  model: VisualModel,
  viewId: string,
  options: C4LayoutOptions = {},
  context: C4LayoutContext = {},
) {
  const held = { ...context };
  return withEngine(model, viewId, options, {
    ...held,
    engine: held.engine ?? {
      async layout(graph) {
        const module = await import("elkjs/lib/elk.bundled.js");
        held.signal?.throwIfAborted();
        const Constructor = module.default as unknown as { new (): ELK };
        return new Constructor().layout(graph);
      },
    },
  });
}
