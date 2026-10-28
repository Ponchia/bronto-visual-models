# Chart encoding guidance

A valid chart specification can still invite a misleading reading.
`chartEncodingGuidance(content)` provides a bounded set of **advisory** notes for
common Vega-Lite patterns without rewriting or rejecting a deliberate exception.
It belongs to the headless core and does not import a renderer, run a transform,
fetch rows or send data anywhere.

```ts
import { chartEncodingGuidance, chartMarkChoices } from "@ponchia/visual-models";

const guidance = chartEncodingGuidance({
  spec: {
    mark: "line",
    encoding: {
      x: { field: "service", type: "nominal" },
      y: { field: "requests", type: "quantitative" },
    },
  },
  values: [
    { service: "Billing", requests: 90 },
    { service: "Orders", requests: 110 },
  ],
});
// guidance.notes contains a nominal-path note. Input remains unchanged.
chartMarkChoices("nominal"); // ['bar', 'point']
```

## What is checked

- Connected line/area/trail marks over unordered nominal categories, except an
  explicitly declared order or sort sequence. Intentional slope charts and paths
  remain possible; the library does not decide their meaning for an author.
- Zero-excluding value scales for bar/area magnitude, and logarithmic length/area
  scales. A ranged interval with `x2`/`y2`, or a continuous horizontal domain, is
  not mistaken for a magnitude baseline.
- Independent position scales inside layered views, which need clear units and
  ranges to avoid implying a relationship through arbitrary axis choices.
- Simple encoded fields absent from every raw inline row. Transform outputs,
  count aggregates and nested field paths are not declared missing by this pass.
- Empty inline rows: no observation is not the same thing as a measured zero.

The reader follows layers, concatenations, facets/repeats and inherited encoding
fields. At most 24 notes are returned, with `truncated` indicating more. Each note
has a stable code, path and message. No message dumps inline row values.

This is not a full Vega-Lite compiler, an exhaustive visualization-quality checker,
a statistical audit, or proof that a chart without notes is truthful. It does not
infer units, causal meaning, data collection quality or the semantics of an
arbitrary transformation. Interpret its notes in the application's context.

## View, CLI and demo

The inline chart view exposes **Encoding notes** without modifying the model or
calling its error callback for an advisory. The CLI's `validate` command includes
`guidance` for Vega-Lite content while preserving a successful exit status for a
valid specification.

The demo separates a service comparison from a time series. Service categories
have bar/point choices. Line/area choices are available for explicitly timestamped
observations on a UTC time scale. Changing the example's rows and grammar is one
revision-guarded edit, not a silent relabeling of existing categories as time.
The table shows the original rows before any chart transformations.

## References

- [Vega-Lite line semantics and path order](https://vega.github.io/vega-lite/docs/line.html).
- [Vega-Lite explicit sorting](https://vega.github.io/vega-lite/docs/sort.html).
- [Vega-Lite scale domains and zero](https://vega.github.io/vega-lite/docs/scale.html).
- [Vega-Lite mark types](https://vega.github.io/vega-lite/docs/mark.html).
