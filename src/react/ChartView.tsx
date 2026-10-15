import { useEffect, useMemo, useRef, useState } from "react";
import { logger, None, parse, View, type Loader } from "vega";
import { compile, type TopLevelSpec } from "vega-lite";
import { expressionInterpreter } from "vega-interpreter";
import { seededSpec, useVegaSurface } from "../engines/vega-surface.ts";
import { chartEncodingGuidance } from "../chart-guidance.ts";
import { canonicalVisualJson } from "../model.ts";
import { chartFrame } from "../render/chart-fill.ts";
import { chartCellText, chartTablePage } from "../render/chart-table.ts";
import {
  inlineChartLoader,
  prepareInlineChart,
  type InlineChartInput,
} from "../render/inline-chart.ts";
import type { AdapterProps } from "./types.ts";

function ChartSurface(props: AdapterProps & { input: InlineChartInput; showing: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const { input } = props;
  const frame = `${props.model.id}:${props.model.generation}:${props.model.revision}`;
  const [failedFrame, setFailedFrame] = useState<string | null>(null);
  useVegaSurface(container, {
    identity: `${props.model.id}:${props.model.generation}:${canonicalVisualJson(input.spec)}`,
    active: props.active !== false && props.showing,
    tokens: props.tokens,
    data: {
      key: `${props.model.generation}:${props.model.revision}`,
      sets: () => ({ bvm_rows: input.values }),
    },
    resize: (view, size) => {
      if (input.fill === "fit") view.width(size.width).height(size.height);
      view.resize();
    },
    create: async ({ container: element, size, config, data }) => {
      const framed = chartFrame(input.spec, size);
      // The compiler never receives private rows, even in its diagnostic strings.
      const spec = { ...framed.spec, data: { name: "bvm_rows" } };
      const diagnostics = logger(None);
      diagnostics.error = () => {
        throw new Error("Inline chart evaluation failed");
      };
      const compiled = compile(spec as TopLevelSpec, {
        config: config("vega-lite"),
        logger: diagnostics,
      });
      // Interpret parsed expressions rather than generating Function-constructor code.
      const runtime = parse(seededSpec(compiled.spec, data), undefined, { ast: true });
      const view = new View(runtime, {
        renderer: "canvas",
        container: element,
        expr: expressionInterpreter,
        loader: inlineChartLoader() as Loader,
        logger: diagnostics,
      });
      // Native text tooltips avoid rich tooltip handlers that can embed image URLs from rows.
      view.description(props.model.description || props.model.title);
      return view;
    },
    onReady: () => {
      setFailedFrame(null);
      props.ready();
    },
    onError: () => {
      setFailedFrame(frame);
      // Upstream exceptions may interpolate source data or the full specification.
      props.report("The inline chart could not be rendered. Check its Vega-Lite grammar.");
    },
  });
  return (
    <div
      className="bvm-engine"
      ref={container}
      style={{ visibility: failedFrame === frame ? "hidden" : "visible" }}
    />
  );
}

function ChartBody(props: AdapterProps & { input: InlineChartInput }) {
  const [table, setTable] = useState(false);
  const advice = useMemo(() => chartEncodingGuidance(props.model.content), [props.model.content]);
  const [requestedPage, setPage] = useState(0);
  const page = useMemo(
    () => chartTablePage(props.input.values, requestedPage),
    [props.input.values, requestedPage],
  );
  return (
    <div className="bvm-chart">
      <div className="bvm-chart-toolbar" role="group" aria-label="Chart presentation">
        <button type="button" aria-pressed={!table} onClick={() => setTable(false)}>
          Chart
        </button>
        <button type="button" aria-pressed={table} onClick={() => setTable(true)}>
          Data table
        </button>
        <span>{props.input.values.length} inline rows</span>
      </div>
      {!!advice.notes.length && (
        <details className="bvm-chart-advice">
          <summary>
            Encoding notes ({advice.notes.length}
            {advice.truncated ? "+" : ""})
          </summary>
          <ul>
            {advice.notes.map((note, index) => (
              <li key={index}>{note.message}</li>
            ))}
          </ul>
          <p>Advisory only. The saved specification and rows are unchanged.</p>
        </details>
      )}
      <div className="bvm-chart-surface" hidden={table}>
        <ChartSurface {...props} showing={!table} />
      </div>
      {table && (
        <div className="bvm-chart-data">
          <div
            className="bvm-chart-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Scrollable chart data"
          >
            <table>
              <caption>{props.model.title} — source rows, before chart transforms</caption>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  {page.columns.map((column) => (
                    <th scope="col" key={column}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row, index) => (
                  <tr key={page.start + index}>
                    <th scope="row">{page.start + index + 1}</th>
                    {page.columns.map((column) => (
                      <td key={column}>{chartCellText(row[column])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!page.total && (
              <p role="status">No inline rows. There is no external source to load.</p>
            )}
          </div>
          <div className="bvm-chart-pagination" role="group" aria-label="Chart data pages">
            <button type="button" disabled={page.page === 0} onClick={() => setPage(page.page - 1)}>
              Previous rows
            </button>
            <span role="status">
              {page.total ? page.start + 1 : 0}–{page.start + page.rows.length} of {page.total} rows
            </span>
            <button
              type="button"
              disabled={page.page + 1 >= page.pageCount}
              onClick={() => setPage(page.page + 1)}
            >
              Next rows
            </button>
          </div>
          {page.omittedColumns > 0 && (
            <p className="bvm-chart-table-note">
              Showing the first {page.columns.length} columns; {page.omittedColumns} more remain in
              the model.
            </p>
          )}
          <p className="bvm-chart-table-note">
            Text cells are abbreviated after 240 characters. Row numbers are positions, not
            persistent element identities.
          </p>
        </div>
      )}
    </div>
  );
}

/** An inline, read-only chart. All content edits, permissions and source resolution remain with the host. */
export default function ChartView(props: AdapterProps) {
  const prepared = useMemo(() => {
    try {
      return { input: prepareInlineChart(props.model.content) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [props.model.content]);
  useEffect(() => {
    if (prepared.error) props.report(prepared.error);
  }, [prepared.error, props.report]);
  if (!prepared.input)
    return (
      <div className="bvm-notice" role="status">
        {prepared.error} The saved source is unchanged.
      </div>
    );
  return <ChartBody {...props} input={prepared.input} />;
}
