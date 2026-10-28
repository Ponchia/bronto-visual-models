# Standalone views

This page describes the current source tree. Gantt, the data reader and the
engine-free Gantt entry are included in beta.3. The immutable beta.2 archive
remains unchanged and does not include these additions.

## Scope

The full `VisualModelView` renders diagrams, circular networks, relationship
matrices, authored timelines and native Gantt schedules. Other compatible
families can be inspected through **Read data**, which lists their identified
records; it is not an implementation of their specialized graphical editors.
The host supplies a validated model, selection callbacks and a guarded write
callback. The library does not fetch datasets, credentials or assets.

## Native Gantt without third-party engines

For schedule-only applications, import the dedicated entry and base stylesheet:

```tsx
import { GanttModelView } from "@ponchia/visual-models/react/gantt";
import "@ponchia/visual-models/base.css";

<GanttModelView
  model={schedule}
  selected={selected}
  onSelect={setSelected}
  onEdit={(patch) => commitAuthorizedEdit(schedule.id, patch)}
/>;
```

Install `react`, `react-dom` and `@ponchia/ui` alongside the package; the latter
supplies the shared appearance-token type. This entry does not import React
Flow, Vega, vis-timeline or their stylesheets. Its isolated packed-consumer test
checks those engine packages are absent before building and running the view.
Do not import the aggregate `styles.css` in that consumer: it intentionally
includes styles for all engines supported by the full visual-view entry.

The full entry and native entry share their host frame, target validation,
read-only policy, error recovery and data reader. There is not a second Gantt
implementation to maintain.

## Reading and editing a plan

Workstreams group tasks in authored order. Time bars use the supplied start/end
instants; milestones have zero duration. Dates use explicit UTC values, not localized guesses or an inferred schedule.
Midnight instants have compact date labels; non-midnight labels preserve their
time and precision. Every `time` element retains its complete ISO timestamp. Task hierarchy is indicated by
indentation. Finish-to-start dependencies are listed with their identified
endpoints. The view does not optimize schedules, move dependent tasks or claim
that the declared ordering is feasible.

Task and dependency selection uses ordinary keyboard-operable buttons. Selecting
a task exposes its progress editor when the host supplied `onEdit` and the model
is mutable. A progress write names its model generation, the revision read and
the previous progress value. A concurrent edit or element replacement refuses
the write rather than silently attaching it to newer content. Repeated submission
is blocked while a write is pending. The host must pass the committed model back.

Omitting `onEdit`, or displaying a template/snapshot, removes mutation controls.
The host transaction still enforces authorization; a visible button never grants
permission. This first schedule view does not implement drag rescheduling,
dependency routing, resource leveling or a full task authoring inspector.

## Read data

Every compatible model has a semantic alternative through the **Read data**
control. Filter by label, collection or element ID. The table renders at most
50 rows per page and preserves target identity when an element is selected.
Expandable field details show the selected record's stored JSON. Opening data
mode does not mutate the model or request a dataset.

The graphical view is retained while hidden and receives `active: false`;
returning to **Visual** keeps its local exploration state. Changing models resets
the data reader's filter/page. Fields without identified records and externally
bound datasets are not fabricated into records. Unknown model formats remain
uninterpreted and are not rewritten.

See [accessibility and browsers](verification.md), [API](api.md) and
[performance](performance.md) for guarantees and verification boundaries.
