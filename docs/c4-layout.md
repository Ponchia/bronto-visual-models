# C4 automatic layout

This is unreleased source built on the dedicated [C4 family](c4.md). It does not
change the published beta.5 package or upgrade Spatial.

## Scope and interaction

C4 layout is a proposal for **one named architecture diagram**. The renderer can
preview it, discard it or submit its guarded patch through the host's normal
`onEdit` callback. Computing, inspecting or cancelling a proposal creates no
receipt, model revision or saved coordinate. The preview has a dashed frame and
an explicit Apply button. It is never acknowledged as a committed drawn revision.

Context and landscape arrange their selected people and systems. Container and
component layouts keep the scoped elements in their existing system/container
boundary. Supporting elements stay outside. Architecture records, relationships,
view inclusions, other diagrams and element incarnations are unchanged. Existing
references are not flattened into a new graph document or guessed relationships.

The optional ELK adapter supports left-to-right and top-to-bottom arrangements.
It reserves space for the renderer's relationship/protocol label boxes. Routed
connectors are displayed with collision-aware label placement using existing
pure geometry utilities. Full labels remain available in Inspect relationship
when a safe position is unavailable; omitted routes use disclosed fallback paths.
This is not a guarantee of an optimal layout for every graph or arbitrary font.

Fit architecture shows the whole diagram; a long diagram can still be too small
to read at that scale. Read at 100% centers the selected element, the scoped
system or an element inside its boundary at readable 1:1 size. It changes only
the local camera, never architecture or layout. Pan/zoom and the inspector remain
available rather than claiming that every full-diagram overview is readable.

## Headless API

```ts
import { layoutC4 } from '@ponchia/visual-models/layout/c4-elk';

const model = store.get('commerce')!;
const proposal = await layoutC4(model, 'containers', { direction: 'RIGHT' });
const command = {
  type: 'edit' as const, id: model.id, key: 'arrange-containers', patch: proposal.patch,
};
const preview = await store.preview(command);
// Inspect the candidate, then deliberately commit the same guarded command.
await store.execute(command);
```

The convenience `/layout/c4-elk` import loads the existing optional `elkjs` peer
in process. Install that peer explicitly. It is suited to controlled headless
work, not a CPU sandbox or a cancellable browser thread.

`/layout/c4` imports no ELK runtime. Supply a host-owned engine:
`layoutC4(model, viewId, options, { engine, signal })`. The options are bounded:
`direction` RIGHT/DOWN; `spacing` 40–240; `layerSpacing` 80–500. The host owns
worker lifetime, timeouts and admission. Cancellation suppresses a late result;
only the owner of a worker can stop its underlying computation.

The `C4LayoutProposal` contains its source head, diagram ID, owned positions,
exact patch, bounds, counts and optional-use routing cache. `c4LayoutCandidate`
validates a provider's proposal before previewing it and refuses patches that
change anything except the requested diagram's positions. Apply rechecks the
source revision and generation. An unrelated concurrent edit also requires a
new layout preview; there is no automatic rebasing.

## React integration and worker ownership

Pass a stable `c4Layout: C4LayoutRunner` callback to `VisualModelView` to expose
Preview automatic layout, direction, Apply, Discard and Cancel controls. The
runner receives an owned model, named diagram, options and AbortSignal. The
reference demo's [worker adapter](../demo/layout.ts) uses the existing official
ELK worker with a 15-second budget and exactly-once termination. Both the old
diagram example and C4 use that adapter; no second in-process ELK bundle is added.

A read-only/inactive view cannot request or apply layout. Ordinary content edits
and drags are disabled while a proposal is being computed or inspected. Changing
the source, switching the named diagram, hiding/unmounting or replacing the
provider invalidates pending preview work. A late provider response cannot
reopen it. A host refusal restores authoritative geometry. An uncertain host
commit still needs host receipt recovery; the UI never automatically retries it.

## Derived routing and safety

`proposal.routing` can be retained locally or passed as `c4Routing`. It is never
part of the saved patch. Its fingerprint includes the model generation, diagram,
source content and element lifetimes. Source edits, undo, replaced subjects and
manual dragging invalidate it; old coordinates are not stretched onto new cards.
Reloading without the cache retains the saved card positions and uses ordinary
fallback connectors until a new layout is computed.

The worker receives opaque node/edge IDs, box sizes and topology, not model names,
responsibilities, protocols, links or source text. Output is inspected as bounded
plain JSON before traversal. Missing/repeated nodes, reparenting, changed card
sizes, out-of-range geometry, overlapping cards and outside elements placed inside
the scope boundary are refused. Route coordinates must be bounded orthogonal
paths that actually meet their referenced endpoint cards. Missing or invalid
routes are disclosed rather than treated as faithful routing.

The runner is still host-supplied trusted code; validation does not sandbox its
CPU, grant permissions or substitute for transactional storage. See
[storage and authority](storage.md).

## Verification and references

Focused core tests cover all four C4 views in both directions, scope preservation,
parallel relationships, preview/replay/undo, malformed runner output, getters,
cancellation, owned inputs and stale cache lifetimes. A separate packed browser
fixture runs the real worker and checks preview/apply/discard, source changes,
late cancellation, host refusal, keyboard routing invalidation, narrow-screen
layout, accessibility, zero external requests and worker termination. The full
browser matrix remains a hosted CI gate; local development uses focused checks.

The implementation follows [C4 notation guidance](https://c4model.com/diagrams/notation),
[ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
and the [ELK JSON graph contract](https://eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/jsonformat.html).
Diagram labels use explicit bounded dimensions because ELK does not measure text.
