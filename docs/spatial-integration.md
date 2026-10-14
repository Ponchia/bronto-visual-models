# Spatial integration

Spatial is the extraction's original application and the first integration target.
The source baseline is recorded in [the manifest](extraction-manifest.json).
Integration changes are maintained in Spatial's own repository and qualified by
its existing CI/merge contract; a package release alone does not deploy Spatial.

## Preserved host responsibilities

Spatial keeps the estate field on its model envelope, scope/authorization checks,
room names, route words, persistence, Yjs/Hocuspocus transport, index maintenance,
backup behavior, dataset access and native canvas bindings. Its existing commit
owner still checks authority and commits model changes, receipts and inverses.
It does not switch to the package's reference memory or file stores.

Compatibility shims at the original import paths delegate to the package. The
shared schema evaluator is a single reexport, preserving the identity of
`AgentSchemaValidationError`. Diagram families retain Spatial's scoped `/c/...`
link grammar. Chart families retain its datasource allowlist and parameter bounds.
A public library's more permissive source-name grammar is not a new host permission.

Renderer hooks take explicit appearance tokens and acquire/release instrumentation
callbacks. Spatial supplies these using its existing appearance and ownership
providers. CSS imports remain explicit. Canvas gestures, focus, selection, native
controls and discussion placement remain with Spatial.

## Qualification

Package tests establish portable behavior, not production deployment. Spatial must
run its original model, collaboration, permission, undo, storage and renderer
integration checks against the exact packaged version. Its reviewed import-boundary
allowlist admits pure core subpaths, not the package's `/node` file adapter or an
unrestricted package prefix. Generated lockfile integrity pins the installed bytes.

The initial extraction removes approximately eight thousand implementation lines
from Spatial before documentation and integration tests. This is source movement,
not a claim that the browser bundle or total maintenance portfolio shrinks by the
same amount. Use the final Spatial diff and CI evidence for the accepted result.
