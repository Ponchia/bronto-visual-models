# Changelog

## Unreleased

- Native Gantt schedules with identified task/dependency selection, guarded
  progress editing and an engine-free React entry/base stylesheet.
- Paginated, filterable semantic model data with keyboard-operable selection.
- Chromium, Firefox and WebKit CI; automated accessibility scans, keyboard
  scenarios and compressed bundle regression gates.
- Validate completed model envelopes before publication; add fixed-seed
  edit/undo/replacement/restart regressions and avoid cloning bodies for lists.

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
