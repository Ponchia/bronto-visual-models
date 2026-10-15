import { useMemo, useSyncExternalStore } from "react";
import type { CommandResult } from "../memory.ts";
import type { VisualModel } from "../model.ts";

/** Host adapters can implement this read-only surface without using the reference store. */
export interface VisualModelSource {
  get(id: string): VisualModel | undefined;
  subscribe(listener: (result: CommandResult) => void): () => void;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

/**
 * A cached, immutable snapshot for a controlled React view. Read authorization stays in the host.
 * Sources must advance revision or generation when a model changes and notify after committing.
 */
export function useVisualModel(source: VisualModelSource, id: string): VisualModel | undefined {
  const adapter = useMemo(() => {
    let snapshot: VisualModel | undefined;
    // React may call getSnapshot several times for a single render, and parent
    // state can re-render the view without a model commit. A host getter may
    // clone megabytes; only read it initially or after a matching notification.
    let dirty = true;
    const getSnapshot = () => {
      if (!dirty) return snapshot;
      const next = source.get(id);
      if (
        next?.id !== snapshot?.id ||
        next?.generation !== snapshot?.generation ||
        next?.revision !== snapshot?.revision
      )
        snapshot = next ? freeze(structuredClone(next)) : undefined;
      dirty = false;
      return snapshot;
    };
    return {
      getSnapshot,
      subscribe: (notify: () => void) => {
        const stop = source.subscribe((result) => {
          if (result.receipt.id === id) {
            dirty = true;
            notify();
          }
        });
        // Close the gap between render-time getSnapshot and effect-time
        // subscribe, even if a host committed without another notification.
        dirty = true;
        return stop;
      },
    };
  }, [source, id]);
  // SSR hosts must initialize the client source with the same serialized snapshot.
  return useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot);
}
