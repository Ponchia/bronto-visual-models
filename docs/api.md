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

## Unreleased standalone additions

Current source adds native Gantt and a paginated semantic data reader to
`VisualModelView`. `GanttModelView` at `/react/gantt`, paired with `/base.css`,
omits all third-party rendering engines. See [standalone views](standalone-views.md)
for the installation and guarded progress-edit contract. The beta.2 archive does
not include these additions. Neither the model nor store snapshot format changes.
