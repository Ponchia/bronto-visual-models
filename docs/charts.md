# Inline charts and source data

The reference React surface can render an inline `vega-lite` model. It reuses the
existing family, revision and host-commit contracts; it does not introduce a
second chart model or an implicit dataset service.

## Create and display

```tsx
import { MemoryModelStore } from '@ponchia/visual-models';
import { VisualModelView, useVisualModel } from '@ponchia/visual-models/react';
import '@ponchia/visual-models/styles.css';

const store = new MemoryModelStore();
await store.execute({
  type: 'create', key: 'create-throughput',
  model: {
    id: 'throughput', title: 'Example throughput', renderer: 'vega-lite',
    content: {
      spec: {
        mark: 'bar',
        encoding: {
          x: { field: 'service', type: 'nominal' },
          y: { field: 'requests', type: 'quantitative' },
        },
      },
      values: [{ service: 'Orders', requests: 120 }, { service: 'Search', requests: 180 }],
    },
  },
});

// Inside a component; store remains stable across renders.
const model = useVisualModel(store, 'throughput');
model && <VisualModelView model={model} height={360} />;
```

Install the reference-view peers listed in the README, including `vega-lite` and
`vega-interpreter`. The root model API and input-policy helper do not import them.
Single and layered charts fit the view. Concatenation, facet and repeat keep their
child sizes and can scroll within the view instead of overflowing the page.
The exact grammar remains Vega-Lite's responsibility: an invalid spec is a
reported renderer error, not a successful empty chart. Compilation receives only
the name of the source table, not its rows. Renderer error callbacks receive a
bounded generic message rather than an upstream dump of the spec or dataset.

To change rows or grammar, execute an edit with `ifRevision`, then pass the new
model. Row updates reuse the compiled view when the grammar is unchanged.
Presentation toggles, table pages and viewport changes never modify saved data.
An inactive chart does not draw or acknowledge a new revision; reactivation
applies the current input. `onReady` acknowledges the chart, not the table.

## Read the source table

The **Data table** button shows a semantic HTML table with column headers, row
headers and a caption. It shows raw `content.values`, before any filters,
aggregations or calculated fields from the chart. This distinction stays in its
caption; a chart's aggregated bar is not necessarily one source row.

The table displays 25 rows per page, discovers columns across the whole input,
and clamps its page after rows are removed. Empty values are supported. It shows
at most 40 columns, explicitly reports omitted columns, and abbreviates cells
after 240 characters. These are presentation limits, not data deletion. The
existing 2,000-row family limit still applies. Missing values display an em dash;
JSON `null`, false and zero remain distinct.

Row numbers are positional labels, not element targets. The adapter does not
invent `VisualTarget` IDs or route chart clicks to unrelated annotations. Text
that looks like HTML or a URL remains text; the table creates no automatic links.

## Resource and trust boundary

`prepareInlineChart` checks a deliberately narrower policy than the portable
stored chart family. It requires `spec` and explicit `values`. It refuses:

- Host `datasource`, `connection` or source `params`, even when inline rows are
  also present. Resolve access and data deliberately in the host first.
- `data` and `datasets` inside the spec, including layers, compositions and
  lookup transforms. The sole source of rows is `content.values`.
- Image marks, URL/href properties, interactive parameters, bindings and legacy
  selections. This reference view neither loads resources nor binds host DOM.
- Nonempty authored annotations, because silently omitting them would present an
  incomplete artifact as a complete one. Use a host adapter that draws them.

Refusal leaves source untouched and does not acknowledge a rendered revision.
A subsequent valid revision can recover; a failed compile hides a previous frame
rather than attributing stale pixels to the new source. This policy is not a
migration or a restriction on what other authorized host adapters may support.

A deny-all loader is installed in the Vega constructor, before any potential
resource loading. Canvas rendering and native text tooltips avoid interpreting
row values as SVG paint URLs or rich-tooltip image markup. The chart uses Vega's
expression interpreter instead of dynamic Function-constructor evaluation. A
packed browser fixture tests calculations with `script-src 'self'` and no
`unsafe-eval`; this claim is scoped to this chart adapter, not every renderer in
the package. Compiler/runtime defects are still upstream dependencies.

**This is not a hostile-code or computational-budget sandbox.** Complex Vega-Lite
transforms can be expensive despite bounded input rows. A host accepting arbitrary
untrusted specifications must add its own approval, execution isolation and
resource limits. Do not expose the library as an unbounded public rendering
service. No spec is fetched, no authentication is inferred, and no global renderer
registry or expression function is installed by this adapter.

## Upstream references

The implementation follows Vega's [constructor loader contract](https://vega.github.io/vega/docs/api/view/),
[expression interpreter instructions](https://vega.github.io/vega/usage/interpreter/),
and [Vega-Lite compilation API](https://vega.github.io/vega-lite/usage/compile.html).

## Encoding advice

The reference view now exposes advisory encoding notes, and the demo limits mark
choices according to whether the data is categorical or ordered. See
[chart encoding guidance](chart-guidance.md). Valid data is not rewritten by advice.

The shared **Inspect model** control inspects the authored model and identified
annotations. **Data table** inside the chart presents raw inline rows before
transforms. These labels distinguish metadata inspection from source values;
neither action fetches a connected dataset or changes the saved document.
