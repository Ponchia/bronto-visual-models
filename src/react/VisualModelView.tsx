import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { modelCompatibility } from "../compatibility.ts";
import { resolveModelTarget, targetResolves } from "../targets.ts";
import { resolveVisualProjection } from "../projections.ts";
import { lightTheme } from "./theme.ts";
import type { VisualModelViewProps, AdapterProps } from "./types.ts";
const Graph = lazy(() => import("./GraphView.tsx"));
const Matrix = lazy(() => import("./MatrixView.tsx"));
const Timeline = lazy(() => import("./TimelineView.tsx"));
const Chart = lazy(() => import("./ChartView.tsx"));

class RendererBoundary extends Component<
  { children: ReactNode; resetKey: string; onError(message: string): void },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error.message);
  }
  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error)
      this.setState({ error: null });
  }
  render() {
    return this.state.error ? (
      <div role="alert">The renderer could not open: {this.state.error}</div>
    ) : (
      this.props.children
    );
  }
}

/** An embeddable view. Content, permission decisions and persistence belong to the supplied host. */
export function VisualModelView(props: VisualModelViewProps) {
  const { model, registry } = props;
  const compatibility = modelCompatibility(model, registry);
  const projection = resolveVisualProjection(model, props.projection, registry);
  const identity = `${model.id}:${model.generation}:${model.revision}:${projection}`;
  const [failure, setFailure] = useState<{ identity: string; message: string } | null>(null);
  const error = failure?.identity === identity ? failure.message : null;
  const report = useCallback(
    (message: string) => {
      setFailure({ identity, message });
      props.onError?.(message);
    },
    [props.onError, identity],
  );
  const ready = useCallback(
    () =>
      props.onReady?.({
        id: model.id,
        generation: model.generation,
        revision: model.revision,
        projection: projection ?? model.renderer,
      }),
    [props.onReady, model.id, model.generation, model.revision, projection, model.renderer],
  );
  const selected = props.selected
    ? resolveModelTarget(model, props.selected, undefined, registry)
    : null;
  const options: AdapterProps = {
    ...props,
    selected: selected && targetResolves(selected) ? selected.current : null,
    tokens: props.tokens ?? lightTheme,
    projection: projection ?? model.renderer,
    report,
    ready,
  };
  const supported =
    compatibility.ok &&
    projection &&
    ((model.renderer === "diagram" && ["diagram", "network", "matrix"].includes(projection)) ||
      (model.renderer === "timeline" && !model.content.datasource) ||
      (model.renderer === "vega-lite" && projection === "vega-lite"));
  const Renderer =
    projection === "matrix"
      ? Matrix
      : model.renderer === "timeline"
        ? Timeline
        : model.renderer === "vega-lite"
          ? Chart
          : Graph;
  return (
    <section
      className={`bvm-view ${props.className ?? ""}`}
      data-model-id={model.id}
      data-revision={model.revision}
      style={
        {
          "--bvm-edge": options.tokens.edge,
          "--bvm-line": options.tokens.line,
          "--bvm-accent": options.tokens.accent,
          "--bvm-focus": options.tokens.focus,
          "--bvm-panel": options.tokens.panel,
          "--bvm-panel-strong": options.tokens.panelStrong,
          "--bvm-text": options.tokens.text,
          "--bvm-danger": options.tokens.danger,
          fontFamily: options.tokens.sans,
          height: props.height ?? 420,
          color: options.tokens.text,
          background: options.tokens.panel,
        } as CSSProperties
      }
      aria-label={model.title}
    >
      {!supported ? (
        <div className="bvm-notice" role="status">
          {compatibility.ok
            ? "This package has no interactive adapter for the requested representation."
            : `This model cannot be interpreted: ${compatibility.reason}. Its source is preserved.`}
        </div>
      ) : (
        <RendererBoundary
          key={`${model.id}:${model.generation}:${projection}`}
          resetKey={identity}
          onError={report}
        >
          <Suspense
            fallback={
              <div className="bvm-notice" role="status">
                Loading visual renderer…
              </div>
            }
          >
            <Renderer {...options} />
          </Suspense>
        </RendererBoundary>
      )}
      {error && (
        <div className="bvm-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setFailure(null)} aria-label="Dismiss visual error">
            ×
          </button>
        </div>
      )}
    </section>
  );
}
