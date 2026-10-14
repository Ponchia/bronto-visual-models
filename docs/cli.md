# CLI and recovery

`bronto-visual-models --help` is the authoritative command synopsis. The CLI runs
from the installed archive and emits JSON; it does not need a Spatial server.

| Command | Input and result |
| --- | --- |
| `catalog` | Installed family metadata, schemas and starting templates. |
| `validate --file input.json` | `{renderer, modelType?, content}`; normalized content or structured refusal. No store write. |
| `create --file model.json --store state.json --key key` | Create input from the README; derived ID when omitted. |
| `show id --store state.json` | Full current model. |
| `inspect id --store state.json` | Model summary, canonical targets and projection metadata. |
| `edit id --file patch.json --store state.json --key key` | Typed edit with revision or field expectations. |
| `undo id --operation original --store state.json --key new-key` | Guarded inverse of a retained edit. |
| `fork id --as new-id --if-rev revision --store state.json --key key` | Independent identity and source provenance. |
| `export id --store state.json` | Authored model, with `dependenciesIncluded: false`. |

`--actor` applies to writes and defaults to `local-cli`. A new operation gets a new
key; a retry of the same operation retains its key, payload and actor. Unknown,
repeated and inapplicable flags are refused. JSON input files are bounded to 2 MB.

## Outcomes

Success goes to stdout as `{ok: true, ...}`. Refusals go to stderr as
`{ok: false, error: {code, message, detail?}, effect}`.

| Exit | Meaning |
| --- | --- |
| 0 | Success, including a replay. |
| 2 | Invalid input or a missing required precondition. |
| 3 | Model or reversible operation not found. |
| 4 | Revision, field expectation, lifetime or idempotency-key conflict. |
| 5 | Operation forbidden. |
| 6 | Unavailable storage/lock or an uncertain file commit. |

An uncertain commit reports `effect: "unknown"`. A successful receipt is not an
assertion that the model still has that revision later. `show` reads its current
state. Export does not bundle external assets, datasets or rendering dependencies.
