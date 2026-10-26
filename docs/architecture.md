# Architecture

Families retain their own semantics and rich interaction surfaces. Shared identity
and guarded operations do not require lossless conversion between unrelated
visualizations. See [visual quality](visual-quality.md) and the dedicated [C4 family](c4.md).

The root package has no React, DOM, database, operating-system file or network
runtime dependency. It uses lib0's SHA-256 helper for canonical request identities.
Engines and UI are optional subpaths; local file operations are under `/node`.

| Layer | Owns | Does not own |
| --- | --- | --- |
| Core | Content contracts, identity, validation, mutations, projections, compatibility, inverse construction. | Canvas placement, navigation, credentials or network loading. |
| Reference stores | Serialized in-memory operations; cooperative local-file atomic persistence. | Distributed transactions, CRDT convergence or a production identity system. |
| Render helpers/hooks | Engine lifecycle, render work sequencing, geometry and theme inputs. | Host appearance events, connected-data queries or instrumentation storage. |
| Reference React surface | Controlled diagram/network/matrix/timeline interactions and inline charts with source tables. | All ten complete editors, application layout or automatic resource navigation. |
| Host integration | Current authority, durable commit, datasets/assets, canvas state, chrome and navigation. | A second copy of the portable model algorithms. |

The first beta deliberately keeps existing family contracts instead of renaming
every model and writing a new grammar. Host-specific routing, estates and source
allowlists were removed from the portable envelope or made explicit host inputs.
The bounded schema evaluator moved with the domain so its runtime error identity
and UTF-16 refusal semantics do not fork between applications.

The existing engines are retained, not reimplemented. Their optional peers are
loaded only by the modules that use them. Source provenance is recorded in
[the extraction manifest](extraction-manifest.json). Spatial should consume a
versioned archive; a repository-to-repository source-copy synchronization process
is not part of this design.

The independent consumer checks are intentionally stronger than a workspace
example. A clean directory installs the packed archive without optional UI peers
and executes core/CLI operations. Another installs that archive with renderer
peers, builds the public site and runs actual browser interactions.
