# Bronto Visual Models

[![CI](https://github.com/Ponchia/bronto-visual-models/actions/workflows/ci.yml/badge.svg)](https://github.com/Ponchia/bronto-visual-models/actions/workflows/ci.yml)

Persistent, editable visual artifacts for people, applications and agents.

Purpose-built visual tools with rich family-specific semantics and interactions.
Shared identity and guarded operations support those tools; every artifact need
not translate into every visualization. [Visual quality direction](docs/visual-quality.md).

**New in beta.6:** a dedicated C4 architecture family provides landscape,
system-context, container and component diagrams, scoped drill-down, typed notation
and guarded detail/layout edits.
[Implemented C4 features and limits](docs/c4.md) · [Automatic layout previews](docs/c4-layout.md).

**[Try the demo](https://ponchia.github.io/bronto-visual-models/)** ·
[Documentation](docs/README.md) ·
[Beta packages](https://github.com/Ponchia/bronto-visual-models/releases)

Bronto Visual Models separates authored visual content from the surface showing
it. A graph can appear as a diagram, network or matrix while retaining the same
identified elements. Edits can name the values they read; stale edits are refused
without discarding unrelated changes. Repeating a committed operation key returns
its receipt instead of applying the edit again.

The demo’s agent buttons execute deterministic example commands; they do not call
an AI service. Real agents can use the same typed API or CLI.

This is an extracted library, not a canvas application, database, CRDT or a new
rendering engine. It builds on React Flow, Vega and vis-timeline. The host owns
access control, persistence, data access and navigation. It belongs to the Bronto
family and is extracted from Spatial's production implementation.

## Install the beta

The package name is `@ponchia/visual-models`. Beta archives are distributed through
GitHub Releases; npm registry publication is not required to install them.

```sh
npm install https://github.com/Ponchia/bronto-visual-models/releases/download/v0.1.0-beta.7/ponchia-visual-models-0.1.0-beta.7.tgz
```

Core requires Node 22.18+ or a modern browser. UI engines are optional peers;
headless consumers do not need React, a DOM, a Spatial server or an account.
The default ID generator needs `crypto.randomUUID`; other environments can
supply a cryptographically secure `mint` callback.

For the reference React views and stylesheet, also install their peers:

```sh
npm install react react-dom @xyflow/react vega vega-lite vega-interpreter vega-tooltip vis-timeline vis-data @ponchia/ui
```

The verified public archive is **0.1.0-beta.7**. This source prepares the next
development version; publication and source versions are deliberately separate.
Start with the [first-model walkthrough](docs/getting-started.md) for a complete
headless example with executable assertions, or use the interactive demo above.

## Change an artifact, not the whole application

```ts
import { MemoryModelStore } from '@ponchia/visual-models';

const store = new MemoryModelStore();
await store.execute({
  type: 'create', key: 'create-architecture',
  model: {
    id: 'architecture', title: 'Order service', renderer: 'diagram',
    content: {
      nodes: [{ id: 'api', label: 'Orders API', x: 100, y: 80 }],
      edges: [],
    },
  },
});

const edit = {
  type: 'edit' as const, id: 'architecture', key: 'rename-api',
  patch: {
    items: [{ field: 'nodes', set: [{
      id: 'api', label: 'Orders service', expect: { label: 'Orders API' },
    }] }],
  },
};

await store.execute(edit);
const replay = await store.execute(edit); // replayed: true; no second edit
const model = store.get('architecture');
```

`MemoryModelStore` is a bounded single-process reference implementation. It is
not durable unless its complete snapshot is persisted. Production integrations
must commit the model, receipt and inverse atomically. See
[storage and authority](docs/storage.md).

## Review changes before committing

`store.preview(command)` evaluates the same guards, authority callback and capacity
checks as `execute`, without writing or consuming an operation key. It returns an
owned candidate and identified change summaries, including cascaded removals.
Execution rechecks everything; the candidate is not a reservation or a receipt.

The CLI supports `--dry-run` on create, edit, undo and fork, plus `list` and
`receipt` for read-only discovery and recovery. [Preview guide](docs/previews.md).

## Embed a view

```tsx
import { VisualModelView, useVisualModel } from '@ponchia/visual-models/react';
import '@ponchia/visual-models/styles.css';

// Inside your component; store is a stable MemoryModelStore or compatible host adapter.
const model = useVisualModel(store, 'architecture');

model && <VisualModelView
  model={model}
  projection="diagram"
  onSelect={(target) => selectElement(target)}
  onEdit={(patch) => applyAuthorizedEdit(patch)}
/>
```

The view is controlled: the host passes the updated model after committing an
edit. `useVisualModel` subscribes to committed changes and supplies a cached,
immutable snapshot; it also handles a changed store or model ID. Omitting `onEdit` makes the reference view read-only; providing it is not
an authorization grant. Cameras, hover and exploratory layout stay local.

## Scope of this beta

The core carries validated contracts for diagram, timeline, Gantt, analysis,
geography, infographic, Vega-Lite, 3D scene, spatial layers and source diagrams.

The beta.7 standalone React surface implements **C4 architecture, diagram, network,
matrix, authored timeline, native Gantt and inline Vega-Lite charts**, plus a paginated
semantic reader and an engine-free Gantt entry. See
[standalone views](docs/standalone-views.md). Other families are core contracts and renderer
integration utilities, not claims of ten complete standalone editors. Existing
Spatial adapters can continue using the extracted engine hooks independently.
Dataset-backed timelines require host source resolution and are not rendered by
the reference component.

Charts render explicit `content.values` with Vega-Lite, without automatically
loading data, images or links. A paginated table exposes the original rows rather
than pretending that transformed/aggregated chart marks are persistent elements.
The chart adapter uses the optional expression interpreter; the core still needs
no React or rendering engines. [Inline charts, data tables and boundaries](docs/charts.md).

Registries are instance-local. Custom trusted family definitions can supply
schemas, identified collections, validation and projections without mutating a
global registry. The reference React surface does not automatically invent a UI
for a new family. [Extension contract](docs/api.md#families-and-registries).

## Extend renderers and author diagrams

Applications can install trusted, lazy React adapters for their own model families
with `createVisualViewAdapters`, alongside the instance-local
`createVisualRegistry`. `VisualModelView` uses the family-declared adapter,
supports an explicit override of its built-in viewers and never resolves module
names from saved content. Adapters are controlled components: they receive
model and selection state and propose writes through the host's authority
callback. [API and standalone example](docs/api.md#trusted-renderer-extensions).

Editable diagrams now retain theme-aware node shapes and tones plus edge
line styles (renderer version 2). Expand **Author diagram** in the reference
React view to add nodes/relationships or edit a selected item; previewed
or refused writes still need the host to commit. Existing version-1 diagrams
remain readable. [Appearance and editing contract](docs/api.md#diagram-appearance-and-authoring).

## Optional diagram layouts

The ELK adapter proposes a layout; it does not change the saved diagram.
Install `elkjs` and import `layoutDiagram` from
`@ponchia/visual-models/layout/elk`. Review its guarded patch with the normal
preview API, then commit explicitly. Nested groups, port sides and variable
node sizes are retained. The demo runs this operation in a local worker.
`layoutDiagram` also returns an optional route cache. Pass it as `diagramRouting`
to display the computed connector paths and font-measured labels; stale geometry
is discarded rather than stretched onto newer content.
[Routing and label contract](docs/routing.md) ·
[Layout contract and limitations](docs/layouts.md) ·
[Engine research and selection](docs/research/visualization-engines-20261015.md).

## Explore without rewriting the artifact

The diagram and network views include **Find & focus**: type a name or identifier,
choose an exact node or relationship, then Reveal. Typing does not hide nodes,
rearrange the diagram or take over the camera. Diagram keyboard position edits
cross the same guarded host boundary as mouse edits.

**Explore matrix** filters nodes and orders the current matrix by authored order,
name or connection count without changing the model. A cell containing parallel
relationships opens an explicit chooser instead of selecting an arbitrary edge.

Chart data remains paginated, but every column is now reachable and long cells
can be expanded to read their complete original value. These are local reading
controls, not new persistent identities or unrequested downloads.
[Exploration guide](docs/exploration.md).

## Truthful chart encodings

`chartEncodingGuidance(content)` flags common semantic pitfalls without changing
valid specifications. The inline view and CLI expose those advisory notes. The demo
separates unordered service comparisons from ordered time observations instead of
offering a line chart over arbitrary categories.
[Guidance and limits](docs/chart-guidance.md).

## CLI

From a source checkout, after installation and build:

```sh
npx --no-install bronto-visual-models create --file examples/architecture.json \
  --store models.json --key create-architecture
npx --no-install bronto-visual-models edit architecture --file examples/rename.json \
  --store models.json --key rename-api
npx --no-install bronto-visual-models inspect architecture --store models.json
npx --no-install bronto-visual-models undo architecture --operation rename-api \
  --store models.json --key undo-rename
```

Use `bronto-visual-models --help` for all commands. Output and errors are structured
JSON. The local file adapter uses an exclusive cooperative lock and atomically
replaces the entire state. It never guesses that an existing lock is stale.
[CLI and recovery](docs/cli.md).

## Development and verification

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:pack
npm run site:build:packed
npx playwright install chromium firefox webkit
BVM_BROWSER=chromium npm run test:browser
BVM_BROWSER=firefox npm run test:browser
BVM_BROWSER=webkit npm run test:browser
npm run check:bundle
```

CI checks Node 22 and 24, a genuinely separate packed headless consumer, and a
React demo built from the archive installed into another independent directory.
The Chromium, Firefox and WebKit browser tests exercise manual and agent edits, conflicts, replay, undo,
projection changes and desktop/mobile layout. Separate packed React fixtures cover
StrictMode subscriptions, replaced selections and delayed or synchronous edit refusals. A green build is not a claim that
an untested browser, database adapter or collaboration mode works.
[Browser and accessibility verification](docs/verification.md) describes the
viewport profiles, automated scans, keyboard tests and remaining manual checks.

[Architecture and boundaries](docs/architecture.md) ·
[Performance and benchmarking](docs/performance.md) ·
[Spatial integration](docs/spatial-integration.md) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## License

MIT. Copyright © 2026 Zeno Trevisan.
Third-party engines retain their own licenses. No Spatial user data, credentials
or private Git history is included. [Source provenance](docs/extraction-manifest.json).
