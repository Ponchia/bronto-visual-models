import type { DiagramRouting } from "../render/diagram-routing.ts";
import type { RendererTokens } from "@ponchia/ui/renderer";
import type { VisualFamilyResolver } from "../family-resolver.ts";
import type { VisualModel, VisualTarget } from "../model.ts";
import type { ModelEdit } from "../operations.ts";
export interface VisualModelViewProps {
  model: VisualModel;
  projection?: string;
  /** C4 only. Omit for local diagram navigation; unknown saved IDs are not silently substituted. */
  c4ViewId?: string;
  onC4ViewChange?(viewId: string): void;
  /** Optional derived routes returned by layoutDiagram; stale content/lifetimes are ignored. */
  diagramRouting?: DiagramRouting;
  registry?: VisualFamilyResolver;
  selected?: VisualTarget | null;
  onSelect?(target: VisualTarget | null): void;
  /** Absent means read-only. Authorization is checked by the host's transaction, never inferred from this prop. */
  onEdit?(patch: ModelEdit): Promise<unknown>;
  tokens?: RendererTokens;
  active?: boolean;
  height?: number;
  className?: string;
  onReady?(identity: {
    id: string;
    generation: string;
    revision: number;
    projection: string;
  }): void;
  onError?(message: string): void;
}
export interface AdapterProps extends VisualModelViewProps {
  tokens: RendererTokens;
  projection: string;
  ready(): void;
  report(message: string): void;
}
