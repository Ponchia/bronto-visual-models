import type { C4LayoutRunner } from "../layout/c4.ts";
import type { C4Routing } from "../render/c4-routing.ts";
import type { DiagramRouting } from "../render/diagram-routing.ts";
import type { RendererTokens } from "@ponchia/ui/renderer";
import type { VisualFamilyResolver } from "../family-resolver.ts";
import type { VisualModel, VisualTarget } from "../model.ts";
import type { ModelEdit } from "../operations.ts";
import type { VisualViewAdapterRegistry } from "./view-adapters.ts";
import type { ResolvedChartRows } from "../chart-source.ts";
import type { ResolvedTimelineRows } from "../timeline-source.ts";
import type { SourceRowTarget } from "../source-snapshot.ts";
export interface VisualModelViewProps {
  model: VisualModel;
  projection?: string;
  /** C4 only. Omit for local diagram navigation; unknown saved IDs are not silently substituted. */
  c4ViewId?: string;
  onC4ViewChange?(viewId: string): void;
  /** Optional host-owned cancellable layout runner. Keep the callback stable across renders. */
  c4Layout?: C4LayoutRunner;
  /** Derived routes for one diagram; any changed source geometry/lifetime invalidates them. */
  c4Routing?: C4Routing;
  /** Optional derived routes returned by layoutDiagram; stale content/lifetimes are ignored. */
  diagramRouting?: DiagramRouting;
  /**
   * Chart-only rows already authorized, resolved and revisioned by the host.
   * Must match chartSourceKey(model); never causes a fetch.
   */
  chartRows?: ResolvedChartRows;
  /**
   * Dataset timeline rows already authorized and read by the host.
   * The key must equal timelineSourceKey(model), and every row needs a unique
   * string rowId plus the fields declared by the model's timeline mapping.
   */
  timelineRows?: ResolvedTimelineRows;
  /** Controlled source-row selection, kept separate from persisted VisualTarget identities. */
  sourceSelected?: SourceRowTarget | null;
  onSourceSelect?(selection: SourceRowTarget | null): void;
  registry?: VisualFamilyResolver;
  /** Trusted host adapters for family-declared visualizations; can override a built-in viewer. */
  viewAdapters?: VisualViewAdapterRegistry;
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
    /** Present only after bound rows were actually drawn. */
    source?: { sourceKey: string; revision: string; digest: string };
  }): void;
  onError?(message: string): void;
}
export interface AdapterProps extends VisualModelViewProps {
  tokens: RendererTokens;
  projection: string;
  /** Animation-frame callers may supply their timestamp; it carries no source identity. */
  ready(source?: { sourceKey: string; revision: string; digest: string } | number): void;
  report(message: string): void;
}
