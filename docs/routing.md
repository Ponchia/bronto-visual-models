# Connector routing and readable relationship labels

`layoutDiagram` now returns a `routing` cache alongside its guarded `patch`.
The patch still contains only authored node geometry and direction. Routes,
label placement and port offsets are derived presentation data; they are never
inserted into model JSON, receipts or undo records.

```tsx
const proposal = await layoutDiagram(savedModel);
const command = { type: 'edit' as const, id: savedModel.id,
  key: 'arrange-architecture-02', patch: proposal.patch };
const preview = await store.preview(command);

// Show the proposal without saving it.
<VisualModelView model={preview.model} diagramRouting={proposal.routing} />;

// After explicit approval, commit command and pass the newly read model.
// The same routing object can accompany that content; it does not grant authority.
```

## Coordinate and invalidation contract

ELK exports edge sections in **ROOT** coordinates while nodes retain **PARENT**
coordinates. This prevents double-offset or missing-offset errors when an edge
crosses a group boundary. The importer maps only known binary relationships,
checks their source and target identities, and preserves separate routes for
parallel edges and self-loops. Relationships with the exact same pair of ports
receive a small center-lane reservation: ELK otherwise returns coincident paths
even with edge merging disabled. This may add a layer around a parallel-edge
group; normal single relationships do not pay that spacing cost. Real label text
is still measured by the host, not supplied to the engine. Unsupported multi-section or missing routes are
listed in `routing.omitted` and use the view's fallback connector.

The cache fingerprints the document ID and generation, content and element
incarnations. Changes to topology, coordinates, sizes, groups, port definitions,
relationship labels or an element lifetime invalidate it. Revision alone is not
a geometric fingerprint: an unrelated document-title edit may retain routes.
The entire cache becomes stale after a relevant change, including an obstacle
that is not an endpoint of a particular edge.

The view suspends routes **during** a drag, before any commit occurs. A stale or
malformed cache never supplies SVG/CSS paths. Missing routes, and routes that no
longer attach to measured handles, use normal React Flow connector geometry.
Small along-segment offsets (up to 8 pixels) account for React Flow's outer handle
edge versus ELK's node-boundary anchor. Perpendicular or larger disagreements do
not stretch an old route to fit a changed model.

Source and target points, bend points and optional label boxes are finite and
bounded. Node membership, hierarchy and JSON descriptors are validated before
translating a runner response. A forged fingerprint is not an authorization
mechanism: hosts still own the input model, the trusted runner and mutation policy.

## Labels and ports

ELK routes are drawn as rounded orthogonal polylines. The host font is measured in
the browser, then labels are placed deterministically around route segments while
avoiding node rectangles, group heading bands and previously placed labels.
Font-load completion causes measurement again. Rendering uses the same explicit
font as measurement; generic host button styles cannot quietly change the metrics.

A short bounded candidate search is not a global optimization. A label with no
non-overlapping position is not drawn over a node: its complete text remains in
the expandable, keyboard-accessible **Relationship labels** list. Long displayed
labels are abbreviated, with complete title/accessible text and a full reading
entry. Explicit routes missing from the cache remain relationships; none are
removed to make the drawing look clean.

Derived port offsets are retained so group-boundary connectors use their actual
ELK attachment points. A geometry change discards them with the route cache and
returns to the normal authored-side port placement. A change of diagram into a
network or matrix does not reuse diagram-specific routes.

## Deliberate limits

There is no always-running router, implicit layout commit, obstacle-aware reroute
after every mouse movement, or new stored-model format. After editing geometry,
request another layout proposal to obtain fresh routed connectors. Fallback
connectors can cross obstacles; the UI identifies stale cached routes rather than
claiming they remain optimal.

Collision checks concern **displayed label rectangles**, node rectangles and group
headings. They are not a proof of minimum crossings, absence of every label/line
intersection, or ideal typography on arbitrary custom styles. The browser tests
cover concrete flat and compound diagrams, parallel relationships, a self-loop,
font measurements, remote-obstacle moves, drag invalidation and replacement IDs.

## Primary references

- [ELK coordinate systems](https://eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/coordinatesystem.html).
- [ELK JSON sections and label sizes](https://eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/jsonformat.html).
- [React Flow custom edge labels](https://reactflow.dev/learn/customization/edge-labels).
- [React Flow BaseEdge](https://reactflow.dev/api-reference/components/base-edge).
