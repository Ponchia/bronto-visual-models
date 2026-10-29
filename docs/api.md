# API

## Document identity

A `VisualModel` carries format version, ID, generation, revision, title,
description, family, content, role, timestamps and actor labels. A generation
identifies a document lifetime. Per-element incarnations prevent an old reference
or inverse from silently attaching to a replacement that reuses an element ID.

A revision is not a timestamp or a CRDT clock. It advances on a committed local
operation. The core preserves extra host fields when a generic operation receives
an extended model, but it does not interpret them as authority.

The format is version 2. `modelCompatibility` describes newer, retired, malformed
or unknown formats without rewriting them. The reference store refuses unsupported
records on load; a host that preserves unknown records needs its own read-only
storage envelope. The React surface shows unsupported content as unavailable and
never rewrites it to fit an older grammar.

## Operations

`createModel`, `editModel`, `undoModel` and `forkModel` are pure document operations:
they return owned candidates and do not persist them. Time and secure ID creation
can be supplied through `AuthorContext` for deterministic tests or host integration.

`MemoryModelStore.execute` serializes create, edit, undo and fork commands. Every
command needs a stable key. The fingerprint includes the actor; a key reused for a
different request or actor is a conflict. A replay reports its original revision,
not necessarily the document's latest revision, and does not repeat change lists.

`MemoryModelStore.preview(command, context)` returns a non-mutating `CommandPreview`:
`effect`, `base`, `model`, `replayed`, `changes` and `changesOmitted`. It shares
validation and serialization with execution. `getReceipt(key)` reads an owned
historical receipt. See [preview semantics and examples](previews.md).

Edits to identified collections use `items: [{ field, set, remove, order, replace }]`.
`set` patches name an ID and may supply `expect` values. `null` in an expectation
means absent. The whole edit is refused if any expectation fails. Removing a
record follows that family's cascade rules, so relationships and child records
cannot be stranded. A patch that fails later validation cannot modify its input.

Replacing content fields, changing status, reordering a collection or replacing a
subject needs `ifRevision`. `generation` can additionally guard the document lifetime.
Changing a title or individual field can remain granular. These are optimistic
preconditions, not automatic conflict merging.

Undo records guard their changed fields and element lifetimes. A disjoint later
edit survives; a superseding edit refuses undo. Templates and snapshots are
immutable until forked. A fork receives new document and element lifetimes and
records its source document/revision.

## Families and registries

`createVisualRegistry()` installs the built-in families. Passing an array installs
exactly that trusted family set, not a process-global plugin list. Definitions are
copied and frozen; duplicate IDs are refused. A custom `VisualFamily` declares a
model type, content schema, collections, search fields, validation and adapters.
An adapter declaration describes capabilities; the host must implement its UI.

Family schemas use the extracted **bounded JSON-Schema subset**, not arbitrary
JSON Schema. It has no external references or remote schema loading. Lengths use
UTF-16 code units, inherited properties do not satisfy required fields, and
numbers must be finite. Families add semantic checks for relationships, ordering,
geometry and similar rules. `assertSchema` rejects unsupported schema constructs.

`createDiagramFamily({ linkPattern })` and
`createVegaLiteFamily({ datasources, maxParameterChars })` let a host narrow its
admitted content. A datasource name is never a permission or a network request.
The portable graph grammar permits explicit HTTP(S), local paths and fragments;
a host can require only its own resource routes. The reference graph view does
not automatically navigate links.

## Trusted renderer extensions

The model-family registry and the UI-adapter registry are separate. A family can
declare its own adapter and projections without adding cases to
`VisualModelView`. The host installs executable React components explicitly,
once per application; saved model JSON never contains a module path or component.

```tsx
import { createVisualRegistry, VISUAL_FAMILIES } from "@ponchia/visual-models";
import { createVisualViewAdapters, VisualModelView } from "@ponchia/visual-models/react";
import type { AdapterProps } from "@ponchia/visual-models/react";

// myScorecardFamily implements the documented VisualFamily schema and declares
// adapters: [{ adapter: "scorecard", capabilities: ["select", "edit"] }].
const registry = createVisualRegistry([...VISUAL_FAMILIES, myScorecardFamily]);
const viewAdapters = createVisualViewAdapters([
  { id: "scorecard", load: () => import("./ScorecardView.tsx") },
]);
// <VisualModelView
//   model={model} registry={registry} viewAdapters={viewAdapters}
//   selected={selected} onSelect={setSelected} onEdit={commitAuthorizedEdit}
// />
```

A definition provides either a direct React component or a lazy `load`
function returning `{ default: Component }`. IDs must be unique lowercase
slugs. The registry is immutable and instance-local. Construct it outside React
render so the same lazy component identity survives model updates; a loader
is only called when that view mounts. A host may deliberately override a built-in
adapter (for example, a connected-data chart), or leave all built-in adapters
unmodified. If no installed adapter matches a model-family declaration, the
reference viewer shows an unavailable notice and preserves the model.

The custom component receives `AdapterProps`: a controlled model, selection
and edit callbacks, theme tokens, activity state, `ready()` and `report()`.
It must report ready only after it has presented the current revision.
Passing `onEdit` is not authorization; the host still checks and commits writes.
Custom components and lazy loaders are **trusted application code**, not an
untrusted plugin sandbox. Install no component from saved document content,
URLs or arbitrary user-supplied code.

The independently packed React consumer verifies lazy loading, typed custom
family operations, host override of the built-in diagram, read-only behavior
and guarded updates in an actual browser.

## Diagram appearance and authoring

Diagram renderer version 2 adds bounded optional appearance fields:
`nodes[].shape` (`box`, `rounded`, `pill`, `database`, `queue`),
`nodes[].tone` and `edges[].tone` (`neutral`, `accent`, `info`,
`success`, `warning`, `danger`), and `edges[].line` (`solid`,
`dashed`, `dotted`). These are theme-aware semantic tokens, not CSS,
HTML, SVG or executable expressions. Existing version-1 diagrams load;
a successful edit updates their renderer version. Older builds refuse version-2
documents instead of silently dropping newer authored fields.

The reference diagram now offers an **Author diagram** disclosure with node
creation at the viewport center, explicit relationship creation and a selected
item's label, description, shape, tone and line inspector. All changes go through
the host `onEdit` callback with generation/revision or field-value
preconditions. An edit does not take effect until the host supplies the new
model. Draft fields are held while unrelated revisions arrive; use **Reload
fields** after a conflicting edit. Without `onEdit`, the authoring controls are
absent. A host without controlled selection can use the diagram's local selection
for inspection. This is an initial authoring surface, not a replacement for
large-graph virtualisation, gesture-based link creation, domain importers or
a full node-component plugin API.

## Views and targets

`modelTargets` and `resolveModelTarget` resolve canonical element identity.
`visualProjectionChoices` and `visualViewCapabilities` describe the representation
actually selected. Pass the same registry to creation, validation, edits and target
resolution; an unrelated registry is not assumed to know a custom family.

`VisualModelView` is a controlled React surface. Provide `model`, optional
`projection`, `selected`, `onSelect`, `onEdit`, `tokens`, `height` and `onReady`.
The host must pass a newly committed model after `onEdit` succeeds. `onReady`
identifies the model generation and revision the adapter acknowledged.

`useVisualModel(source, id)` bridges a `VisualModelSource` (`get`, `subscribe`) to
React with `useSyncExternalStore`. Sources notify after commits and advance the
revision or generation whenever content changes. The hook does not reread model
content for unrelated React renders or commits to another model; it always
rechecks after subscription setup to handle a concurrent commit. Returned
snapshots are deeply
frozen and cached by ID/generation/revision; use the store's normal getter for a
mutable draft. SSR hosts must initialize the browser source from the same
serialized snapshot used on the server. The hook itself needs React, not the
renderer engines or styles, and is also available at
`@ponchia/visual-models/react/useVisualModel`.

A selection from a replaced element or different model no longer highlights the
new element by accident. Drag refusals, including synchronously thrown host
errors, restore the latest host-supplied state rather than an old closure. Renderer
errors are scoped to model, generation, revision and projection; a newer model can
recover without resetting a healthy renderer's camera on every edit.

The diagram reference adapter uses React Flow, preserving authored coordinates.
Its network view uses an exploratory circular placement, not persisted layout or
an automatic semantic transformation. Matrix rendering uses the extracted Vega
grammar and explicit relationship selection for parallel edges. Timeline rendering
uses the extracted vis-timeline lifecycle. Data loading and authentication are not
part of these components.

Optional lower-level subpaths expose the extracted Vega and vis-timeline engine
hooks plus geometry helpers. Hooks accept host instrumentation (`onAcquire`) and
explicit resolved theme tokens. A host's observers and appearance events stay
outside the package. Import the relevant engine stylesheet in that host.

## Inline charts

`VisualModelView` now renders the `vega-lite` family with explicit inline rows.
The same controlled-model API applies: commit through the host and pass a new
revision to update data or encoding. The chart's internal Chart/Data table toggle
is local presentation, never a saved mutation. It is not a new model projection
and does not add synthetic row identities to the stored document.

The reference chart uses canvas and interpreted expressions. It acknowledges
only drawn chart frames, not a data-table display; `active={false}` defers chart
work until reactivation. It does not implement the broader family catalog's
annotation editor, parameter bindings, selection targets, export or connected
sources. Families describe potential host capabilities, not a claim that every
reference adapter implements them. See the [chart guide](charts.md).

Headless tools can call `prepareInlineChart(content)` from
`@ponchia/visual-models/render/inline-chart` to check the reference adapter's input
policy without loading a compiler, React, DOM or network. This returns owned spec
and rows plus `fill` (`fit` or `composed`). Passing that check is not proof of valid
Vega-Lite grammar or bounded compute cost; compilation/rendering can still refuse.

## Routed connector caches and chart advice

`VisualModelView` accepts `diagramRouting`, the derived cache from a
`layoutDiagram` proposal. Cache validity depends on content and element lifetimes,
not merely a revision number. Relevant edits and active drags invalidate routes;
full labels remain readable when visual label placement is unavailable.
See [routing](routing.md).

`chartEncodingGuidance` is an advisory core API. Its bounded notes do not fail an
otherwise valid model, fetch data, or modify content. The reference inline chart
and CLI validation display the same notes. See [chart guidance](chart-guidance.md).

## Standalone additions

Beta.3 adds native Gantt and a paginated semantic data reader to
`VisualModelView`. `GanttModelView` at `/react/gantt`, paired with `/base.css`,
omits all third-party rendering engines. See [standalone views](standalone-views.md)
for the installation and guarded progress-edit contract. These additions are included with beta.3. Neither the model nor store snapshot format changes.

## Local exploration and chart data windows

Diagram/network Find & focus controls resolve current canonical targets and move
only the local viewport. Matrix filtering and ordering never commit a model edit.
Parallel cells require an explicit identified relationship choice. See
[exploration](exploration.md) for keyboard controls and limitations.

`chartTablePage(rows, rowPage, columnPage)` at `/render/chart-table` preserves the
existing two-argument call and adds optional column paging. A host scanning the
same rows repeatedly can call `chartTableColumns(rows)` once and reuse that schema
with `chartTableWindow(rows, columns, rowPage, columnPage)`. These helpers accept
already validated rows; regenerate their schema when the row collection changes.
They return owned array windows while row records remain read-only references to
the supplied source. `chartCellFullText` gives plain text; it does not create HTML.
