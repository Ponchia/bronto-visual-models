# Bronto Visual Models

[![CI](https://github.com/Ponchia/bronto-visual-models/actions/workflows/ci.yml/badge.svg)](https://github.com/Ponchia/bronto-visual-models/actions/workflows/ci.yml)

Persistent, editable visual artifacts for people, applications and agents.

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
npm install https://github.com/Ponchia/bronto-visual-models/releases/download/v0.1.0-beta.1/ponchia-visual-models-0.1.0-beta.1.tgz
```

Core requires Node 22.18+ or a modern browser. UI engines are optional peers;
headless consumers do not need React, a DOM, a Spatial server or an account.
The default ID generator needs `crypto.randomUUID`; other environments can
supply a cryptographically secure `mint` callback.

For the reference React views and stylesheet, also install their peers:

```sh
npm install react react-dom @xyflow/react vega vega-tooltip vis-timeline vis-data @ponchia/ui
```

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

## Embed a view

```tsx
import { VisualModelView } from '@ponchia/visual-models/react';
import '@ponchia/visual-models/styles.css';

<VisualModelView
  model={model}
  projection="diagram"
  onSelect={(target) => selectElement(target)}
  onEdit={(patch) => applyAuthorizedEdit(patch)}
/>
```

The view is controlled: the host passes the updated model after committing an
edit. Omitting `onEdit` makes the reference view read-only; providing it is not
an authorization grant. Cameras, hover and exploratory layout stay local.

## Scope of this beta

The core carries validated contracts for diagram, timeline, Gantt, analysis,
geography, infographic, Vega-Lite, 3D scene, spatial layers and source diagrams.

The standalone React surface currently implements **diagram, network, matrix
and authored timeline** views. Other families are core contracts and renderer
integration utilities, not claims of ten complete standalone editors. Existing
Spatial adapters can continue using the extracted engine hooks independently.
Dataset-backed timelines require host source resolution and are not rendered by
the reference component.

Registries are instance-local. Custom trusted family definitions can supply
schemas, identified collections, validation and projections without mutating a
global registry. The reference React surface does not automatically invent a UI
for a new family. [Extension contract](docs/api.md#families-and-registries).

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
npx playwright install chromium
npm run test:browser
```

CI checks Node 22 and 24, a genuinely separate packed headless consumer, and a
React demo built from the archive installed into another independent directory.
The browser tests exercise manual and agent edits, conflicts, replay, undo,
projection changes and desktop/mobile layout. A green build is not a claim that
an untested browser, database adapter or collaboration mode works.

[Architecture and boundaries](docs/architecture.md) ·
[Spatial integration](docs/spatial-integration.md) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## License

MIT. Copyright © 2026 Zeno Trevisan.
Third-party engines retain their own licenses. No Spatial user data, credentials
or private Git history is included. [Source provenance](docs/extraction-manifest.json).
