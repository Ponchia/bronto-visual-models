# Family-specific visual quality

Visual Models develops capable visual tools for their own subjects. A shared
model/operation contract must not impose a common set of visual features or
require every artifact to translate into every representation. Alternate views
are useful where semantics fit; they are not the product's only purpose.

Common infrastructure owns identity, guarded edits, receipts, undo, model lifetime
and host boundaries. Families own their semantic grammar. Their adapters own the
interactions, notation, density controls and layout needed to work well with it.
Use specialized engines where they improve the result; do not replace them just
to make an implementation uniform. Keep adapters optional and lazy.

## Acceptance before breadth

A family should demonstrate a useful, complete task with realistic content,
clear labels and a legible arrangement. All claimed interactions need a tested
controlled-write path and refusal recovery. Exploration must remain usable on
narrow screens and by keyboard, with a semantic reading alternative. Record
actual rendering and memory evidence separately from helper benchmarks.

The family catalog is not a promise that every standalone editor is finished.
Distinguish a stored contract, renderer, editor, importer and exporter. Each needs
its own acceptance evidence. Adding another name to the catalog is not enough.

## Next capability investments

| Family                        | Direction                                                                                                                                                    | Evidence required                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| C4 architecture               | Context/container/component navigation, architecture notation and independent diagram layout; then dedicated dynamic/deployment semantics and interoperation | Purpose-built interactive fixture, semantic refusals, scoped edit/undo, visual review |
| Editable diagrams             | Better boundary/port authoring, routing and collision-aware labels                                                                                           | Dense nested and parallel-edge journeys, readable small-screen inspection             |
| Networks                      | Useful exploration layouts, filtering and neighborhood focus rather than only a circular placement                                                           | Graph-specific tasks and frame/memory profiles on realistic sizes                     |
| Charts                        | Rich interactions appropriate to their grammar, readable legends/axes, deliberate annotations and export                                                     | Chart-specific controlled-edit and data-fidelity journeys                             |
| Timeline and Gantt            | Time navigation, dependency and scheduling interactions with their distinct semantics                                                                        | Keyboard rescheduling, conflict recovery and large-lane behavior                      |
| Infographic, geography and 3D | Purpose-built standalone editors and specialized engines where justified                                                                                     | Independent consumer proof, resource boundaries and accessible alternatives           |

These are development priorities, not shipped features. The first implementation
under this direction is [C4 architecture](c4.md). No engine replacement, universal
conversion API, new persistence platform or consumer upgrade is implied.
