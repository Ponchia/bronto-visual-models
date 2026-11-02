# Diagram layout proposals

The optional ELK adapter arranges a validated diagram without changing saved state.
It does not replace React Flow or turn ELK's graph objects into the document format.

```sh
npm install elkjs
```

```ts
import { layoutDiagram } from "@ponchia/visual-models/layout/elk";

const saved = store.get("architecture");
if (!saved) throw new Error("Architecture is not available");
const layout = await layoutDiagram(saved, { direction: "RIGHT" });
const command = {
  type: "edit" as const,
  id: saved.id,
  key: "layout-review-001",
  patch: layout.patch,
};
const preview = await store.preview(command);
// Display preview.model read-only; keep command for an explicit Apply action.
// After review, await store.execute(command). This rechecks authorization/state.
```

`direction` is `RIGHT` or `DOWN`. Defaults are 48 pixels between nodes and 88
between layers; `spacing` accepts 24–240 and `layerSpacing` accepts 40–400.
Flat diagrams use network-simplex placement to avoid excessive whitespace in the
measured fixtures. Compound diagrams keep Brandes–Köpf placement: ELK 0.12.0's
network-simplex path failed a tested group-boundary case. This is an explicit
strategy choice, not a silent flattening or catch-and-retry workaround.

The adapter supports varied node sizes, declared ports, disconnected components,
cycles, parallel edges and nested groups. Children retain parent-relative
coordinates. Groups are resized by the layout to contain their children and a
heading band. Leaf dimensions, labels, graph order, relationships, source
provenance and element identities remain authored by the existing model.

A proposal carries `base`, `patch`, `algorithm`, counts and computed bounds.
The patch guards **both generation and the complete revision**: even a topology
change with unchanged node coordinates can invalidate a global arrangement.
A preview does not reserve those guards or grant permission to apply. Undo is the
ordinary guarded inverse of the committed edit, not a special layout undo stack.

## Runtime and resource boundary

The package root and reference React view do not load ELK. Import the optional
subpath when needed. The default runner loads the bundled peer on demand and runs
in-process. Its Promise does not make CPU computation interruptible or off-thread.

For an interactive application, supply an `elk-api` instance whose `workerFactory`
creates an owned ELK worker, as the reference demo does. Validation and translation
remain on the caller; the expensive layout runs in the worker. Its worker is
created only by Preview layout, uses same-origin bundled code, and is terminated
after success, failure, cancellation or 15 seconds. That deadline is a demo policy,
not a core-runtime timeout promise.

Do not embed the default bundled ELK constructor inside another worker: ELK 0.12.0
changes its worker-module initialization in that environment and does not expose
the same in-process worker shim. The demo uses the official API/worker pair instead.

An advanced host may supply `{engine, signal, registry}` as the third argument.
`engine.layout(graph)` is the trusted ELK-compatible boundary; a host-owned worker's
lifecycle is also the host's responsibility. Aborting suppresses a late proposal;
it does not preempt the default in-process engine. The adapter accepts the same
narrowed family registry used by the application's mutations.

Only opaque IDs, dimensions, label-size estimates, hierarchy and port geometry
reach the engine. Author text, source code, URLs, data rows and credentials are not
sent to it. There is no implicit server or remote-layout endpoint. The engine's
output must preserve node membership and hierarchy, retain leaf sizes, and contain
finite, bounded geometry before it can become a normal model patch.

## What this does not claim

The proposal includes a derived connector cache in addition to node placement.
Pass `routing` to the view's `diagramRouting` prop; it is never stored by the
layout patch. [Coordinate systems, label placement, invalidation and limits](routing.md)
are explicit. The original approximate label hints are not used to force extra
layers for single relationships: labels are measured and placed with the actual
host font after routing. Parallel edges sharing the same port pair reserve small
separate lanes; those groups can require more space.
There is no optimal-crossing claim or automatic reroute after every edit.

The bounded graph grammar remains 300 nodes and 600 edges. Layouts exceeding the
existing coordinate or group-size limits are refused, not clipped. Large or dense
graphs should be tested with the host's actual fonts and worker setup. A change of
renderer is not a reason to enlarge saved-model resource limits implicitly.

## Licensing

Bronto's adapter is MIT. The unmodified optional `elkjs` peer is separately licensed
under EPL-2.0 with upstream's secondary-license option; it is not relicensed by
this repository. See [third-party notices](../THIRD_PARTY_NOTICES.md). The demo
retains an upstream license notice with its shipped assets.

## Worker-only entry

Worker hosts can import `layoutDiagram` from
`@ponchia/visual-models/layout/diagram` and supply `context.engine`. That entry
contains the same guarded translation and validation but no optional bundled
ELK import. The existing `/layout/elk` convenience entry retains its lazy
in-process default. This split prevents a worker-backed application from
emitting both the worker payload and an unused bundled engine. The demo's
bundle gate refuses a second `elk.bundled` asset.
