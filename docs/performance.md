# Performance and profiling

This beta supports small, independently editable models and bounded reference
stores. Performance must be qualified on the consuming host's devices and data;
a successful headless benchmark is not evidence of smooth canvas interaction.

## Store writes

The reference `MemoryModelStore` enforces an exact **UTF-8** capacity over the
serialized snapshot: model bodies, receipts and inverses plus their array
separators and envelope. A committed edit measures the candidate model, new
receipt and new inverse; it does **not** serialize every unrelated model or
historical receipt for capacity accounting. A snapshot restore still validates
and measures the full untrusted input. Replays and previews do not consume
capacity. All three maps commit synchronously, after authority, guard, inverse
and capacity checks, before any subscriber is notified.

This optimization changes neither the snapshot format (version 1) nor the model
format (version 2). It does not eliminate the cost of validating, cloning,
diffing and serializing the *edited* model or the cost of persisting a full file
snapshot. Production persistence still needs the host's transactional storage.

## React and rendering

`useVisualModel(source, id)` reads and freezes a model initially and after
matching commit notifications. Unrelated parent renders and commits to different
model IDs reuse the same frozen snapshot without calling the source getter.
The hook rereads after subscription setup to close the render-to-subscribe gap.
A source **must notify after every committed change** and advance the generation
or revision whenever its model changes. Silent, in-place mutations are outside
that contract. Returned snapshots never expose a mutable host-owned object.

The reference graph view caches ancestor depths during its node layout sort.
It also reuses edge descriptions until edge content, selection or resolved
theme tokens change. These are rendering optimizations, not persisted
layout changes; hosts remain responsible for their own renderer lifecycles.

## Reproduce the store benchmark

From a source checkout with dependencies installed:

```sh
npm run bench:store
```

The script creates synthetic models and measures 60 small, serialized edits with
1, 32 and 128 preexisting models, after 20 warm-up edits. It rotates case
order across three rounds and reports the median, individual samples and final
snapshot size as machine-readable JSON. It intentionally excludes model
seeding and disk I/O. Run on the same machine and Node version when
comparing commits; do not use absolute timing as a CI gate.

Release qualification requires correctness tests, packed consumers and browser
interaction tests in addition to any benchmark. The next Spatial integration
review should separately measure initial mount, model-edit acknowledgement,
selection, pan/zoom, canvas resizing, memory after unmount and large collections,
with realistic data and a recorded hardware/browser profile.

## Listing and bounded data views

`list()` removes content and element-incarnation maps before cloning summaries,
so opening a library list no longer clones every model body. Nested host metadata
in summaries remains owned by the caller. The semantic data reader paginates
identified records rather than mounting a full collection at once. Stored-field
JSON is resolved and formatted only when its disclosure is opened, not for every
closed row on the current page.

Complete created, edited, forked and undone models are checked against the JSON
budget after generated metadata is added. This validation cost is deliberate:
a successful operation must not emit a model that fails on the next read.

## Bundle regression gates

Run `npm run check:bundle` after `npm run site:build:packed`. The guard traverses
the built manifest's static imports, leaving dynamic renderers out of the
initial-JavaScript count. It refuses accidentally eager renderer entries and
records raw/gzip sizes. Limits are kept in `scripts/bundle-budget.mjs`: 128 KiB
initial JavaScript, 600 KiB application JavaScript, 215 KiB per application
JavaScript asset, 12 KiB aggregate CSS and 10 KiB for each native renderer/data
reader asset. The optional ELK worker retained from the diagram-layout work
has a separate 650 KiB budget; total JavaScript including that worker is bounded
at 1,250 KiB. It is not an initial renderer dependency.
These are gzip transfer limits, not memory budgets or frame-rate claims.

The dedicated native Gantt consumer uses `/react/gantt` and `/base.css`, with no
React Flow, Vega or vis-timeline installation. The aggregate stylesheet remains
available for hosts using those engines. A separate packed install proves that
the small native view is not merely a tree-shaking assumption.

The worker-backed demo imports `/layout/diagram`, whose engine is supplied by
its host. `/layout/elk` remains the in-process convenience entry. This separation
keeps the duplicate bundled ELK engine out of the demo instead of hiding it
behind a larger asset limit.

## Optional chart transfer budget

Beta.3 introduces an independently bounded **110 KiB gzip** allowance for the
lazy `ChartView` compiler/interpreter chunk. The initial JavaScript ceiling
(128 KiB), pre-existing application ceiling (600 KiB), total JavaScript ceiling
(1,250 KiB), maximum application asset, CSS and native-renderer ceilings are not
raised. Shared Vega engine code remains counted against the pre-existing
application budget; only the new ChartView chunk is accounted separately.
A check refuses eager loading of ChartView or the shared Vega surface.

The first combined production bundle measured 90,090 gzip bytes for that chunk,
104,042 for its entry, 547,324 for pre-existing application assets and 1,071,955
total including the optional ELK worker. These are one build's transfer sizes,
not memory or frame-time claims; every qualifying build records its own report.

## Graph interaction preparation (beta.5)

A caller-scoped graph index replaces repeated endpoint, route and port-array scans
with maps. It caches parent ordering and the handle choices for this snapshot.
Graph selection is a separate overlay: choosing another node changes at most two
renderer node objects, while positions, styles, node data and route geometry stay
referentially stable. The node body is memoized. Search is a child-local control;
its keystrokes neither regenerate the graph nor remove nonmatching nodes.

The index has no global lifetime and is rebuilt when content or valid routing
changes. It does not weaken route fingerprints, model generations, target
incarnations or the explicit layout-commit boundary. Hosts still supply immutable
snapshots and notify after commits.

`npm run bench:exploration` records `.tmp/benchmark-exploration.json`. It compares
reproductions of the prior scans against the indexed path, including index
construction, for synthetic 30/150/300-node graphs with 16 ports each. Both paths
must produce equivalent handle/route/port results. It uses ten warmups and three
rounds of 40 preparations; no absolute time is a CI pass/fail gate.

In the retained [ARM64 Node 24 measurement](research/exploration-benchmark-20261015.json),
300 nodes / 600 relationships / 4,800 ports took **18.810 ms** with repeated scans
and **1.450 ms** with the full indexed preparation. Selecting a different node
retained 298 of 300 node objects. This is a measured helper-workload improvement,
not a 13x whole-application speed claim, browser frame-rate guarantee or measured
heap reduction. Small graphs, actual labels, device speed and contention differ.

The same fixture reduced serialized matrix renderer data from **641,168** to
**72,438 bytes** by omitting raw node descriptions/ports and nested edge records
which the grammar never reads. The original model and explicit cell edge IDs
remain intact. The grid still draws sparse O(nodes + relationships) marks, not
all empty cell combinations. Raw column names are discovered once per chart-row
collection, independent of its current row/column page.

References: [React Flow performance](https://reactflow.dev/learn/advanced-use/performance)
and [Vega signal/dataflow evaluation](https://vega.github.io/vega/docs/api/view/).
