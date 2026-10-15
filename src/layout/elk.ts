import type { ELK } from "elkjs";
import type { VisualModel } from "../model.ts";
import {
  layoutDiagram as withEngine,
  type DiagramLayoutContext,
  type DiagramLayoutOptions,
  type DiagramLayoutProposal,
} from "./diagram.ts";
export type {
  DiagramLayoutContext,
  DiagramLayoutOptions,
  DiagramLayoutProposal,
} from "./diagram.ts";

/** Optional in-process convenience entry. Worker hosts use /layout/diagram instead. */
export function layoutDiagram(
  model: VisualModel,
  options: DiagramLayoutOptions = {},
  context: DiagramLayoutContext = {},
): Promise<DiagramLayoutProposal> {
  const held = { ...context };
  return withEngine(model, options, {
    ...held,
    engine: held.engine ?? {
      async layout(graph) {
        const module = await import("elkjs/lib/elk.bundled.js");
        held.signal?.throwIfAborted();
        const Constructor = module.default as unknown as { new (): ELK };
        // This constructor owns no real Worker; its in-process shim must not be terminated.
        return new Constructor().layout(graph);
      },
    },
  });
}
