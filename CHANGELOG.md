# Changelog

## Unreleased

- Keep the focused C4 element wholly visible when its canvas shrinks below the card:
  a resize keeps the reading zoom while the card fits and zooms out instead of clipping it.
- Add scoped C4 automatic-layout proposals with a host-owned optional ELK runner,
  explicit preview/apply/discard, cancel-safe worker lifecycle and per-diagram writes.
- Add generation/content-bound C4 route caches and collision-aware protocol labels;
  malformed geometry and stale previews cannot silently rewrite architecture.

- Add the dedicated C4 family with named landscape, system-context, container and
  component diagrams, validated architecture hierarchy and independent layouts.
- Add a lazy purpose-built C4 renderer with typed notation, boundaries, protocol
  labels, search/focus, drill-down, detail editing and guarded pointer/keyboard
  position changes; retain read-only and late-refusal recovery boundaries.
- Prioritize rich family-specific visualization capabilities without requiring
  universal projections. No new runtime dependency or consumer upgrade is included.

- Accept the compatible Bronto UI 0.17 minor alongside 0.16.3 in the optional
  peer contract, so the updated packed UI consumers install without peer overrides.
- Resolve the latest Node 22 and 24 patch releases in CI on every run.
- Add a verified distribution manifest, public archive identity/checksum gate and
  a complete headless first-model example run by clean packed consumers.
- Separate development source from the published beta.5 installation path.
- Update reviewed CI actions and development tools while retaining the Node
  22/24 runtime matrix and the reviewed Node types major line.

## 0.1.0-beta.5

- Index graph endpoints, routes and port offsets once per content snapshot; selection
  retains unchanged node/edge objects instead of rebuilding visual geometry.
- Add explicit Find & focus for diagrams/networks, including namespaced relationship
  selection, no camera changes on typing, and bounded native search controls.
- Commit keyboard position edits through generation/revision/coordinate guards;
  readonly and refused edits do not leave renderer-only moved nodes.
- Add matrix filtering/order and parallel-relationship choices. Evaluate selection
  signal changes immediately; retain the compiled sparse matrix for filtering.
  Explicit scale ranks prevent a reused engine from retaining its old ordering.
- Measure matrix label gutters with the host font so short names keep their
  distinguishing suffixes; preserve full accessible labels for bounded clipping.
- Send minimal matrix tuples instead of copying authored prose/ports/edges into Vega.
- Add chart column pagination and expandable full cell values. Reuse discovered
  sparse columns across page changes, retaining source rows and their order.
- Add measured preparation benchmarks and independently packed browser exploration
  coverage. No new dependencies, saved formats or Spatial consumer changes.

## 0.1.0-beta.4

- Never acknowledge failed same-grammar chart data updates. Invalidate queued frame
  acknowledgements and stale row caches; preserve structured errors and recovery.
- Recreate partially failed dataflows on the next explicit request rather than
  reusing corrupted pulse state; healthy data updates still reuse their engine.
- Revoke withdrawn readiness callbacks, suppress late draw/error callbacks after
  hiding or disposal, and observe retained frames on reactivation. Add controlled
  promise-barrier browser regressions for callback ownership and supersession.
- Keep timeline redraw/navigation callbacks inactive after hide or disposal;
  preserve metadata-only chart descriptions without recompilation and prevent
  error-report loops caused by changing host callback identities.
- Cover repeated invalid calculation rows and repair without changing the grammar
  in the independently packed real-browser fixture.
- Handle malformed optional routing/port/label responses without TypeErrors;
  refuse invalid child collections with the public geometry error contract.
- Preserve the beta.3 features, existing stored formats and core/optional dependency
  boundaries. No Spatial package update or deployment is included.

## 0.1.0-beta.3

- Render ELK root-space connector paths from derived, fingerprinted caches without
  changing the stored model format. Suspend stale routes during drag and after
  relevant geometry, topology, label or element-lifetime changes.
- Place relationship labels using actual host-font measurements, avoiding nodes,
  group headers and other labels. Full text remains in a keyboard-readable list
  when the bounded placement cannot fit it.
- Add headless chart-encoding advice, CLI/view notes and semantically distinct
  categorical and temporal examples. Advice never rewrites valid source data.

- Standalone inline Vega-Lite chart rendering with controlled row/spec updates,
  responsive fitted charts, independently sized compositions and pause/resume.
- A keyboard-accessible source-data table with pagination, empty states, sparse
  column discovery and disclosed display limits; no invented row identities.
- Explicit refusals for host sources, nested data, images, links, parameter
  bindings and unimplemented annotations; saved source is never rewritten.
- Interpreted chart expressions, constructor-time deny-all resource loader and
  plain-text tooltips. The chart fixture exercises a strict script CSP without
  unsafe-eval; this is not a claim about all existing renderer engines or a CPU
  sandbox for arbitrary untrusted specifications.
- Compilation never receives source rows; renderer error callbacks do not expose
  upstream dumps of datasets or specifications.
- New headless policy/data-table tests, a packed chart browser consumer, and a
  public demo for chart-type changes and source-data updates.

Adds `vega-interpreter` as an optional chart peer (and a development test
requirement), not a core dependency. The stored model format remains version 2;
this release does not update Spatial's separately pinned version.

- Native Gantt schedules with identified task/dependency selection, guarded
  progress editing and an engine-free React entry/base stylesheet.
- Paginated, filterable semantic model data with keyboard-operable selection.
- Chromium, Firefox and WebKit CI; automated accessibility scans, keyboard
  scenarios and compressed bundle regression gates.
- Validate completed model envelopes before publication; add fixed-seed
  edit/undo/replacement/restart regressions and avoid cloning bodies for lists.

### Diagram layouts

- Explicit ELK layered proposals for RIGHT/DOWN diagrams, guarded by source
  generation and revision. Preview, apply and undo use the existing operations.
- Same-origin worker-backed demo previews with discard/cancel and bounded lifetime.
- Implicit top/bottom ports, distributed same-side custom ports and direction-aware
  fallback handles; graph chrome uses supplied theme tokens.
- Optional `elkjs` peer; Dagre is a development-only comparison. No core dependency,
  persisted-format or Spatial integration change.
- Source-linked engine assessment, reproducible benchmark, and geometry/preview tests.

### Store and view performance

- Enforce in-memory store byte budgets incrementally and exactly in UTF-8,
  without re-serializing unrelated models and receipt history per edit.
- Avoid redundant controlled React reads, cache nested graph depths, and reuse
  unchanged graph edge descriptions while retaining subscription catch-up.
- Accept a persisted file snapshot at the exact JSON byte budget, including
  the file adapter's trailing newline; cover restart and replay at that boundary.
- Add byte-for-byte capacity regressions, packed React subscription checks and
  a reproducible synthetic store performance benchmark.

## 0.1.0-beta.2

- Non-mutating, serialized previews for create/edit/undo/fork with the same
  validation, authority checks and capacity constraints as execution.
- File previews and CLI `--dry-run`, model listing, receipt lookup and structured
  validation issue reports. Previews do not create files, locks or directories.
- A cached `useVisualModel` React subscription hook, including server rendering
  and controlled model/store changes. No new runtime dependency.
- Reference demo preview/discard/apply, guarded redo and keyboard element selection.
  Independent panel columns avoid stretched desktop blank space; initial graph fit
  shows the whole model on narrow screens.
- Refuse malformed snapshot JSON (including `null`) instead of overwriting it;
  inspect untrusted snapshot descriptors before reading or serializing values.
- Preserve aggregate snapshot capacity while retaining per-model validation limits.
- Capture file-command input before asynchronous I/O, honor cancellation before
  commit and protect subscriber iteration against reentrant subscription changes.
- Restore current host state after delayed drag refusal, handle synchronous host
  errors, detach stale selections and recover renderer errors on newer revisions.
- Expanded headless, packed React and desktop/mobile browser verification.
- Remove the vulnerable documentation globbing dependency chain; use direct
  Markdown linting with the existing rules.

Stored model format remains version 2. Spatial's separately pinned beta.1 is not
changed by publishing this release.

## 0.1.0-beta.1

Initial extraction of Spatial's visual-model domain into the Bronto family.

- Portable identified models, ten family contracts, local registries, validation,
  compatible projections and guarded edit/undo operations.
- Bounded reference memory store, cooperative atomic file store and structured CLI.
- Optional React diagram, circular network, matrix and authored timeline views.
- Existing Vega/vis-timeline lifecycles and geometry helpers behind host inputs.
- Packed headless and React consumer verification, Node 22/24 tests and actual
  desktop/mobile Chromium interactions.

This beta does not ship every Spatial visual editor, a distributed database, an
offline collaboration engine or a replacement for the underlying render libraries.
