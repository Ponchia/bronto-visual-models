# First model, without a server

Start with the published package, not a clone of this repository. You need
Node.js 22.18 or later and an empty directory. No React, browser, account,
Spatial installation or private data is required.

```sh
mkdir visual-models-first-run
cd visual-models-first-run
npm init -y
npm install --ignore-scripts --omit=optional https://github.com/Ponchia/bronto-visual-models/releases/download/v0.1.0-beta.5/ponchia-visual-models-0.1.0-beta.5.tgz
```

Save the [first-model example](../examples/first-model.mjs) as `first-model.mjs`
in that directory and run `node first-model.mjs`. The example uses the core APIs
available in beta.5; newer source checkouts also include it in the packed archive.
It creates a graph, previews a change without writing, commits the change,
retries the same key, refuses a stale edit and undoes the committed rename.
Each step asserts the result rather than merely printing an optimistic message.

Expected output contains `true` for `created`, `previewDidNotWrite`,
`retryReplayed`, `staleEditRefused` and `undoRestoredLabel`. The packed-consumer
CI runs this same example from a clean installation without optional UI peers.
This is reproducible automated onboarding evidence, not an outside-user trial.

## From the first model to an application

The [interactive demo](https://ponchia.github.io/bronto-visual-models/) shows
one graph as a diagram, network and matrix. The core owns identified content and
operations; these are views of the same graph rather than separate documents.
Use [standalone views](standalone-views.md) for React integration, and read
[storage and authority](storage.md) before persisting data or accepting edits.
`MemoryModelStore` is not durable by itself. A successful local example does not
establish production authorization, collaborative storage or deployment safety.

## Package identity and failures

The [distribution manifest](distribution.json) records the verified public
archive, source commit, byte length and checksums independently of the current
source version. A source version bump must not advance installation instructions
until its archive has actually been published and verified.

From a source checkout, `node scripts/check-distribution.mjs` checks documentation
offline; `node scripts/check-distribution.mjs --online` also checks the public
release, tag identity and bounded archive download. A 404, moved tag, truncated
archive or changed checksum is a failure, never a successful source-only fallback.
This command does not install packages, run lifecycle scripts or publish anything.

An install error from the release URL is a distribution problem. An unsupported
Node version is an environment problem. Missing React or rendering packages only
matters when you intentionally import the optional view layer. Do not add those
packages to make a failing headless example appear to work.
