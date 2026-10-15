# Exploring a visual model

These beta.5 controls improve reading without rewriting authored content. Model
format 2 and store snapshot format 1 are unchanged. The public package and demo
are independent of Spatial's separately pinned integration.

## Find and reveal a graph element

Open **Find & focus** in a diagram or network. Search a label or identifier,
choose a matching node or relationship, and activate **Reveal element**. Search
matches include collection names and exact IDs to disambiguate repeated labels
and IDs reused by nodes and relationships. Native inputs, a select and a submit
button provide ordinary keyboard interaction without a custom combobox protocol.

Typing never moves the camera, hides unrelated nodes or rearranges the graph.
Reveal moves the local camera to the chosen node or the endpoints of the selected
relationship, and emits the current target when the host supplies `onSelect`.
Without that callback it is still possible to reveal an element; it does not
invent saved selection state. No-match results disable Reveal. A model switch or
new generation resets the control; selection lifetimes use the existing resolver.

Search disclosures and full relationship lists mount their controls only when
opened. At most the bounded model's identified records can appear. This does not
claim efficient navigation of an unbounded graph or a replacement for screen-
reader testing of the underlying graphical engine.

## Keyboard position edits

Focus a diagram node and press Enter or Space to select it; Escape clears its
controlled selection. Arrow keys request a 10-unit position change, or 40 units
with Shift. The request carries the captured generation, revision and previous
coordinates. The host still validates and commits the edit, and passes the newly
committed model back. Only one keyboard write is submitted at a time.

Unlike a renderer-local nudge, this does not display unsaved coordinates as if they
were committed. Refusals report an error and keep the current host state. Read-only
views, immutable templates/snapshots and inactive surfaces cannot submit moves.
Network positions remain exploratory and are not authored by these keys. This is
a single-focused-node action, not multi-object keyboard layout or automatic
rescheduling of related content. Pointer drag editing retains its existing guards.

## Explore a directed matrix

Open **Explore matrix** to filter node names/IDs and choose authored, name or
connection-count order. Rows are source nodes and columns are targets. Filtering
shows the induced relationships between matching endpoints, and the controls
state the visible counts against the complete graph. **Reset matrix view** restores
the authored ordering and all nodes. The model itself is never filtered or sorted.

A cell can stand for parallel relationships. Clicking such a cell opens a list of
those exact edge IDs; it does not arbitrarily choose the first relationship. The
existing relationship select remains available as a keyboard alternative.
Selections update emphasis immediately by evaluating the changed Vega signals,
not by waiting for the next unrelated resize or model edit. Filtering and ordering
retain the compiled matrix engine. Label gutters use the actual host font and
refresh after fonts load; complete labels remain in accessible descriptions when
a genuinely long name cannot fit the bounded gutter. The sparse grid can scroll in a small host;
it is not forced into unreadably small cells to claim every node fits at once.

## Read the full chart data

The chart's **Data table** shows raw values before chart transformations. There
are at most 25 rows and 40 columns on a page, with independent controls for each
dimension. Every column, including one present only in a later sparse row, is
reachable. Page indices clamp when the host replaces the input with fewer rows or
columns. Schema discovery is reused until the row collection changes.

Long cells show a short preview in a native disclosure. Expand it to inspect the
full value in a bounded text region. URLs and markup-looking strings remain text;
there are no implicit downloads, image fetches or CSV formula execution. Row
numbers still mean positions, not invented durable element identities. See
[inline charts](charts.md) for resource restrictions and the 2,000-row bound.

## Limits and evidence

Graph source/port/route preparation benchmarks, structural-sharing tests and an
independently installed browser fixture are described in [performance](performance.md)
and [verification](verification.md). Measurements isolate specific improvements;
they are not a universal frame-rate, memory, accessibility or renderer-completeness
claim. No additional runtime dependency was introduced for these controls.
