import ElkApi from "elkjs/lib/elk-api.js";
import ElkWorker from "elkjs/lib/elk-worker.min.js?worker";
import type { ELK, ELKConstructorArguments } from "elkjs";
import {
  layoutC4,
  type C4LayoutOptions,
  type C4LayoutProposal,
} from "@ponchia/visual-models/layout/c4";
import type { VisualModel } from "@ponchia/visual-models";
import {
  layoutDiagram,
  type DiagramLayoutOptions,
  type DiagramLayoutProposal,
} from "@ponchia/visual-models/layout/diagram";

/** Own the official ELK worker rather than nesting the in-process shim inside another worker. */
export function computeDiagramLayout(
  model: VisualModel,
  options: DiagramLayoutOptions,
  signal: AbortSignal,
): Promise<DiagramLayoutProposal> {
  return withLayoutWorker(signal, (engine) => layoutDiagram(model, options, { engine, signal }));
}
export function computeC4Layout(
  model: VisualModel,
  viewId: string,
  options: C4LayoutOptions,
  signal: AbortSignal,
): Promise<C4LayoutProposal> {
  return withLayoutWorker(signal, (engine) => layoutC4(model, viewId, options, { engine, signal }));
}
function withLayoutWorker<T>(
  signal: AbortSignal,
  request: (engine: ELK) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new ElkWorker();
    let complete = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const finish = (error?: Error, proposal?: T) => {
      if (complete) return;
      complete = true;
      cleanup();
      if (error) reject(error);
      else resolve(proposal!);
    };
    const abort = () => finish(new Error("Layout cancelled; nothing was saved."));
    const timer = setTimeout(
      () => finish(new Error("Layout exceeded the demo's 15 second budget; nothing was saved.")),
      15000,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(new Error("The local layout worker failed; nothing was saved."));
    try {
      const Constructor = ElkApi as unknown as { new (options: ELKConstructorArguments): ELK };
      const engine = new Constructor({ workerFactory: () => worker });
      void request(engine).then(
        (proposal) => finish(undefined, proposal),
        (error) => finish(error instanceof Error ? error : new Error("Layout could not complete.")),
      );
    } catch {
      finish(new Error("The local layout worker could not start; nothing was saved."));
    }
  });
}
