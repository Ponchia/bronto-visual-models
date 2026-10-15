# Visualization engines and model boundaries

Research checked 15 October 2026. This is an implementation decision record, not a
claim that every candidate below has been integrated or benchmarked.

## Decision

Keep the persistent model as the owner of meaning, identities and guarded edits.
Use specialized engines behind explicit adapters, and add an engine only when it
replaces meaningful work or unlocks a verified use case. A visually impressive
engine is not a reason to copy its mutable internal objects into stored documents.

The immediate addition is optional ELK layered layout for diagram proposals.
Retain React Flow for editable node surfaces and Vega-Lite for stored analytical
chart specifications. Do not add ECharts, Sigma or another universal scene model
to the core in this iteration. The package's graph grammar is bounded at 300 nodes
and 600 edges: large-graph renderer marketing is not evidence that the current
application needs another rendering stack.

## Why ELK, rather than a larger diagram framework

React Flow deliberately leaves automatic layout to other libraries. Its official
comparison describes Dagre as the simpler option and flags a nested-subflow issue
when edges cross group boundaries. ELK supports varying node sizes, compound
hierarchy and port constraints. This aligns with the diagram contract we already
have, rather than forcing us to discard ports or flatten groups.

Sources: [React Flow layout comparison][rf-layout], [ELK layered][elk-layered],
[ELK hierarchy][elk-hierarchy], [ELK ports][elk-ports].

ELK is larger and more complicated than Dagre. It is an optional, lazy peer, not a
root dependency. The reference demo requests layout in a short-lived local worker.
The demo uses ELK's official API plus an owned worker, not its bundled in-process
constructor nested inside another worker (that failed browser initialization in
our packed-consumer check). A proposal becomes a revision-guarded normal edit only after explicit review.
This also prevents a late layout from overwriting a manual or agent edit.

Dagre remains a useful lightweight baseline for flat directed diagrams. We include
it only as a development benchmark dependency, not another public layout choice.
D3 force layouts are useful for exploratory networks but require a convergence,
collision and deterministic-seeding policy. A simulation should not keep consuming
CPU on hidden canvases or silently change authored coordinates. D3 hierarchy is a
better semantic match for a rooted tree than a graph containing cycles or multiple
parents. These distinctions are supported by the same React Flow comparison.

The node-placement adapter does not yet use ELK's routed edge sections. Rendering
still uses React Flow smooth-step paths. Its spacing uses bounded approximate
edge-label measurements; real typography, route overlaps and complex group ports
need dedicated visual assessment. This limitation must remain explicit.

## Family-by-family assessment

| Family/use case | Decision | Important boundary |
| --- | --- | --- |
| Editable diagrams | React Flow plus optional ELK | Preserve IDs, nested parents, explicit port sides and authored sizes. Keep auto-layout opt-in and undoable. |
| Network exploration | Keep the bounded current projection; evaluate Sigma + Graphology only for demonstrated scale needs | GPU rendering and network analysis do not replace our guarded document model. Do not lose groups or pretend derived positions are authored coordinates. |
| Analytical charts | Keep Vega-Lite as the persisted grammar | Data source authority stays with the host. In-process spec execution is not a computational sandbox. |
| Highly specialized dashboard charts | Consider ECharts as a separate adapter when needed | ECharts 6 offers new chart types, theme switching and matrix coordinates, but an ECharts option tree is not a drop-in equivalent to a Vega-Lite spec. |
| Exploratory charts in code | Observable Plot is a good candidate for a code-oriented host | Its JavaScript marks/scales API is attractive, but accepting arbitrary callbacks in stored visual JSON would cross a different execution boundary. |
| Timelines | Retain vis-timeline for temporal items and ranges | Preserve explicit instants, timezone qualification and local exploration. Do not conflate temporal events with task-dependency semantics. |
| Quantitative flow | Retain D3 Sankey for valid flow data | A Sankey encodes directed flow in an acyclic network, not arbitrary links. Preserve measures and units; never silently drop cycles to make the image fit. |
| Infographics | Keep AntV Infographic as a candidate engine for narrative templates | Its design/data/theme/resource split is useful. Preserve identified source items and disclose unsupported resources or semantic omissions. |
| Geographic layers | deck.gl for analytical layers; MapLibre for a basemap when justified | GeoJSON/world coordinates are authored; view cameras and GPU buffers are not. Tile/asset requests need explicit host authorization. |

Sources: [Sigma][sigma], [ECharts 6][echarts6], [ECharts accessibility][echarts-aria],
[Observable Plot][plot], [vis-timeline][timeline], [D3 Sankey][sankey],
[AntV Infographic concepts][antv], [deck.gl][deck], [MapLibre][maplibre].

## The model refinements that matter more than adding engines

**Separate three states:** semantic content, authored presentation, and temporary
exploration. A deliberate saved node position is presentation; panning a camera,
highlighting an entity or exploring a force layout should not become a document
edit automatically. Renderer metadata belongs to an adapter; an opaque provider
name does not authorize resource access.

**Make data meaning explicit:** line/area encodings require a meaningful ordering
or continuous/time domain; they are not merely alternative styles for unrelated
service categories. Sankey flow must preserve direction and magnitude. Geography
and 3D need coordinate systems and units. Derived hierarchy projections must not
invent single-parent semantics for a multi-parent graph without disclosure.
These are design acceptance rules, not claims that all such validation has shipped.

**Do not hide losses:** unsupported annotations, missing rows or failed asset
loads must not be shown as a complete rendering. Keep raw values accessible even
when the visual aggregates them. A row index is not an invented persistent ID.
The unpublished inline-chart work is a separate candidate and is not included in
this layout change.

**Theme and access are part of correctness:** selected states, connector ports,
focus rings and error surfaces should use supplied host tokens, not fixed green
or white CSS. The layout change corrects these graph styles and spreads multiple
ports on a side. Explicit top/bottom endpoints now have real rendered handles.
Color alone is not sufficient for meaning: ECharts' patterns/ARIA work is a useful
reference, but it is not a reason to replace all existing renderers.

**Keep execution boundaries honest:** Vega's interpreter avoids runtime code
construction for expressions and can have a performance cost. Its CSP support is
not a guarantee of bounded execution time for arbitrary specifications. Worker
termination, row limits, no-network loaders and source-redacted errors are separate
concerns. See [Vega interpreter][vega-interpreter] and [elkjs workers][elkjs].

## Measurements and remaining work

Run `npm run build && npm run benchmark:layout`. The script writes
`.tmp/layout-benchmark.json` for 12, 60, 180 and 300 nodes with variable rectangle
sizes. It compares local layout duration, bounds and rectangle overlap pairs using
one warmup and three measurements. The ELK path includes public validation and
proposal conversion; Dagre is the raw baseline. This is deliberately not presented
as an unbiased library-speed ranking, a browser benchmark or proof of optimal
edge routes. Import/worker cold starts, text/edge overlaps and memory retention are
not measured by that script.

The next decision gate for a different network engine is a representative, measured
read-only network workload and a mapped capability contract, not another demo-only
integration. The next chart-quality gate is truthful encoding choices, accessible
source rows, selective data updates and no hidden resource fetch. Maps and 3D should
stay optional until an independent consumer demonstrates their actual needs.

[rf-layout]: https://reactflow.dev/learn/layouting/layouting
[elk-layered]: https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
[elk-hierarchy]: https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html
[elk-ports]: https://eclipse.dev/elk/reference/options/org-eclipse-elk-portConstraints.html
[elkjs]: https://github.com/kieler/elkjs
[sigma]: https://www.sigmajs.org/docs/
[echarts6]: https://echarts.apache.org/handbook/en/basics/release-note/v6-feature/
[echarts-aria]: https://echarts.apache.org/handbook/en/best-practices/aria/
[plot]: https://observablehq.com/plot/
[timeline]: https://visjs.github.io/vis-timeline/docs/timeline/
[sankey]: https://github.com/d3/d3-sankey
[antv]: https://infographic.antv.vision/learn/core-concepts
[deck]: https://deck.gl/docs/developer-guide/performance
[maplibre]: https://maplibre.org/maplibre-gl-js/docs/
[vega-interpreter]: https://vega.github.io/vega/usage/interpreter/
