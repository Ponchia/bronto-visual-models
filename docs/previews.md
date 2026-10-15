# Previewing a guarded operation

A preview answers **what this command would do to the state read now**. It is not
a commit, a reserved revision or permission to bypass the host's authorization.

## Preview, review, then execute

```ts
import { MemoryModelStore, type ModelCommand } from '@ponchia/visual-models';

const store = new MemoryModelStore();
await store.execute({
  type: 'create', key: 'seed',
  model: {
    id: 'architecture', title: 'Architecture', renderer: 'diagram',
    content: { nodes: [{ id: 'api', label: 'API', x: 0, y: 0 }], edges: [] },
  },
});
const command: ModelCommand = {
  type: 'edit', id: 'architecture', key: 'rename-api',
  patch: {
    items: [{ field: 'nodes', set: [{
      id: 'api', label: 'Orders API', expect: { label: 'API' },
    }] }],
  },
};

const preview = await store.preview(command);
// preview.effect === 'none'
// preview.base.revision === 1; preview.model.revision === 2
// store.get('architecture').revision is still 1.
console.log(preview.changes); // identified, bounded change summaries

// After review, submit the ORIGINAL command, not the candidate model.
// All guards and authorization are evaluated again at execution time.
const result = await store.execute(command);
```

Create, edit, undo and fork all use the same serialized evaluation path as real
commands. A preview waits for earlier operations on that memory store. It checks
content, references, revision/field expectations, identity, receipt-key reuse,
model count, receipt count and the configured byte capacity.

It does not change saved models, receipts or inverses, consume the operation key,
or notify subscribers. The returned candidate is an owned copy. Trusted host
callbacks (authorization and lifetime minting) still run; their own external
side effects are outside the store's guarantees. Do not recursively await another
operation on the same store inside its authorizer.

## Result contract

| Field | Meaning |
| --- | --- |
| `effect` | Always `"none"`: no store commit happened. |
| `base` | Source ID, renderer, generation and revision at evaluation time; `null` for a fresh create. For a fork, this names the source, not the proposed new model. |
| `model` | Candidate document. On a replay, the current saved target, which may be newer than the original receipt. |
| `replayed` | The same key, command and actor already committed. No new changes are proposed. |
| `changes` | Bounded summaries of affected records, fields, orders and cascades. Empty for a replay. |
| `changesOmitted` | Number of additional changes not listed in the bounded summary. |

A new candidate's timestamps and lifetime tokens are provisional. An eventual
create or fork can mint different tokens. A preview does not promise that future
execution succeeds: another writer, permission revocation, cancellation or a
capacity change may invalidate it. Granular expectations still permit unrelated
edits; use `ifRevision` when the whole reviewed document must stay unchanged.

`getReceipt(key)` retrieves an owned copy of a committed receipt without retrying
the command. Its revision describes the historical commit; use `get(id)` for the
current model. Read authorization belongs to the host for both methods.

## Local files and agents

```sh
bronto-visual-models edit architecture --file patch.json \
  --store models.json --key rename-api --dry-run
bronto-visual-models edit architecture --file patch.json \
  --store models.json --key rename-api
bronto-visual-models receipt rename-api --store models.json
bronto-visual-models list --store models.json
```

The programmatic equivalent is
`previewFileCommand(path, command, context, options)` from
`@ponchia/visual-models/node`. It reads one atomic file snapshot and does not create
parent directories, a lock, a staging file or a store. An existing writer's lock
is neither acquired nor removed; the preview may inspect an older committed
snapshot while that writer works. Actual execution must still acquire its lock.

Corrupt state, including JSON `null`, is refused rather than reinterpreted as an
empty store. Missing files represent an empty store; malformed existing files do
not. Preview errors use the same structured refusal codes as actual writes.

The interactive demo exercises preview/discard/apply, a preview becoming stale,
and undo/redo. Its examples are deterministic commands, not calls to an AI service.
