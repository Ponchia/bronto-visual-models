# Bronto Visual Models — agent contract

Read README.md first. The package owns portable visual-model behavior; Spatial
and other hosts own authority, persistence and canvas interactions. Never import
Spatial code, service endpoints, user datasets or host credentials into this repo.

## Source and checks

Core: `src/`. Regression tests: `test/`. Source provenance:
`docs/extraction-manifest.json`. Run `npm run build` and `npm test` after changes;
packed-consumer and real-browser checks qualify releases. Generated `dist/` is
not authored source. Run `repo-instruction-audit --repo .` after documentation
or instruction changes.

## Hazards

Keep model IDs, element lifetimes, unknown-format preservation, revision guards,
receipt recovery and undo behavior explicit. No public interface may silently
fetch data or execute user-provided code. Render engines remain optional peers.
Do not publish a stable version, claim a deployed integration, or remove a host
implementation without evidence that the exact replacement works.

## Workflow

Keep unrelated changes intact. Source has one owner: move behavior and its tests,
not a second implementation to synchronize. Document verified behavior and limits.
