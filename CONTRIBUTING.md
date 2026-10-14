# Contributing

Start with the [README](README.md) and [architecture](docs/architecture.md).
Keep changes scoped to a model operation, family contract or renderer responsibility.
Do not require Spatial services to develop or test this package.

Run `npm run build`, `npm test` and `npm run test:pack`. Renderer changes also need
`npm run site:build:packed` and `npm run test:browser`; inspect the resulting desktop
and mobile images rather than relying on assertions alone. CI supplies Node 22/24
and Chromium evidence. Other engines must be explicitly tested before being claimed.

Add a regression when fixing a refusal, retry, concurrency or disposal bug. Keep
examples synthetic; never submit credentials, private documents or saved user
models. Do not weaken permission or persistence guarantees to make a test green.

Public API and stored format changes are separate decisions. Document both. A beta
version may change the public API, but must not silently reinterpret a stored model.
Changes contributed here are licensed under the repository's MIT license.
