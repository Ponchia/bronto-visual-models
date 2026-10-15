# Third-party notices

Bronto Visual Models' original and extracted owned source is MIT-licensed. Its
runtime dependencies and optional peers retain their own licenses. They are not
relicensed by this repository. The npm archive contains this library's compiled
modules, not a bundled replacement copy of those engines.

| Library | Role | License reported by installed package |
| --- | --- | --- |
| lib0 | SHA-256 helper used by the core | MIT |
| React and React DOM | Optional component runtime | MIT |
| React Flow (`@xyflow/react`) | Optional graph interaction engine | MIT |
| Vega and Vega-Lite | Optional visualization grammar/runtime | BSD-3-Clause |
| vega-interpreter | Optional chart expression evaluator | BSD-3-Clause |
| vis-timeline and vis-data | Optional time-view runtime and data collection | Apache-2.0 OR MIT |
| Bronto UI (`@ponchia/ui`) | Optional renderer theme contract | MIT |
| d3-sankey | Optional analytical layout helper | BSD-3-Clause |

Consult each installed dependency's LICENSE file for its complete notices. Build
and test tools are development dependencies and are not shipped in the archive.
The extraction manifest records the source paths owned by this project; it does
not incorporate Spatial's Git history, private artifacts or user-created models.

## Optional layout engine

`elkjs` 0.12.0 is an unmodified optional peer. Its upstream metadata declares
`EPL-2.0 OR GPL-3.0-or-later`; its package includes the Eclipse Public License 2.0.
It is not relicensed under Bronto's MIT license. Source and upstream notices:
<https://github.com/kieler/elkjs>. The reference demo distributes the corresponding
upstream license text at `third-party/elkjs-LICENSE.md`.

`@dagrejs/dagre` 3.1.1 (MIT) is used only by the development comparison script and
is not loaded by the core, renderer or default layout adapter.
