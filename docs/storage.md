# Storage and authority

## What must commit together

A durable integration must serialize or compare-and-swap against the state it
validated, and atomically persist the resulting model, operation receipt and undo
record. A pair of unrelated `load` and `save` functions is not sufficient. Do not
publish success before that commit is durable. A retry key is scoped to its store;
multiple principals sharing a store need host authorization on every command.

Authority is checked inside the serialized operation, before both a fresh write
and a replay. `MemoryModelStore` calls the supplied `authorize` callback with owned
copies. The host must check the current scope and, for a fork, both source access
and destination creation permission. The callback is trusted code: bound its
latency, do not recursively call the same store from it, and handle revocation in
the host. Read/list/snapshot/receipt authorization is also the host's responsibility.

The package does not implement distributed locking, offline merging, websocket
synchronization or a production database. Existing Yjs/Hocuspocus infrastructure
can remain the authoritative store while using the same pure model algorithms.

## Reference memory store

The default store admits 256 models, 4,096 receipts and 16 MiB of complete state.
Limits are configurable positive integers. Reaching a limit refuses a new write;
it does not evict receipt history and accidentally make old retries new again.
Getters, snapshots, callback arguments and receipts are cloned. Observer failures
cannot roll a committed write back. A failed operation does not poison its queue. Subscribers are captured at commit
notification time, so subscribing again during a callback cannot create an endless
notification loop. New listeners receive subsequent commits, not the current one.

Use `snapshot()` and restore with `new MemoryModelStore({ initial: snapshot })`.
Persist the entire snapshot, not just its models. Snapshot validation inspects
property descriptors before reading or serializing untrusted values. The complete
snapshot uses the store byte budget; each model retains its separate 2 MB limit. Snapshots are local trusted
storage records, not signed interchange packages. Validation is not authentication.

## Reference local file store

`executeFileCommand(path, command, context)` uses a cooperative exclusive lock,
loads the entire state, performs one transaction, fsyncs a same-directory staging
file, atomically renames it, then fsyncs the directory. Files are created mode 0600.
Symlink targets and corrupt input are refused. It does not overwrite a damaged
file with an empty store, silently steal a lock or clean up somebody else's lock.

Only writers honoring the same lock participate in these guarantees. This adapter
is intended for local files on a filesystem with atomic rename and directory fsync,
not NFS, distributed workers or an arbitrary cloud filesystem.

An existing lock is an operational refusal. Read its PID metadata, establish that
the original writer is no longer alive and inspect the committed store before
removing that lock manually. A late failure after rename reports an **unknown**
commit outcome. Read the store or retry the exact command with its original key;
never invent a replacement key merely because a response was lost.

The file CLI does not have a separate login mechanism. It runs with the operating
system user's permissions. Do not expose it as a public service without a host
authorization and resource-access boundary.

## Previewing without a transaction

`MemoryModelStore.preview` and `previewFileCommand` check proposed edits without
saving candidates or consuming retry keys. A file preview is a read of one committed
snapshot, not a lock or promise about a subsequent writer. See [previews](previews.md).

File commands capture caller input and author context before the first filesystem
await. Cancellation is checked before filesystem work and again before atomic
rename. Cancellation after publication cannot undo a committed transaction; use
the receipt and guarded undo rather than deleting or overwriting state.
