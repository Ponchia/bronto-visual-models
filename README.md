# Bronto Visual Models

Persistent, editable visual artifacts for people, applications and agents.

`@ponchia/visual-models` extracts the model contracts and guarded operations used
by Spatial. It is part of the Bronto family. It is a library, not a canvas
application, database, CRDT or replacement for existing rendering engines.

The framework-neutral core owns identified elements, family schemas, validation,
compatible projections, structured edits and guarded undo. Hosts own access
control, durable storage, navigation, connected data and user-interface policy.

## Development

Use Node 22.18 or newer. Install with `npm ci --ignore-scripts`, then run
`npm run build` and `npm test`. The first beta is being assembled in this
repository; current behavior is defined by the source and tests.

See [the extraction manifest](docs/extraction-manifest.json) for source provenance.
No Spatial user data, credentials or private Git history is included.

## License

MIT. Copyright Zeno Trevisan.
