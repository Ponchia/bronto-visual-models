# Releasing

## GitHub archive beta

The current distribution is a GitHub Release containing the installable npm
archive. Publishing a repository and publishing an npm registry version are
separate actions. No npm login or token is needed by users installing the public
release URL. The committed package lock records the archive's integrity.

1. Update `package.json` and `CHANGELOG.md` together. Never replace a released
   archive with different contents under the same version.
2. Qualify that commit with CI: Node 22/24, packed headless consumer, packed React
   consumer and desktop/mobile browser checks. Inspect retained screenshots.
3. Download `npm-package` from that exact successful run. Check its embedded
   `package.json` version and record the archive's SHA-256 and npm integrity.
4. Tag the qualified commit, create a prerelease, and attach the archive plus
   checksums. The release notes identify the source commit, CI run and limits.
5. Pin that archive in consumers, run their integration gates, and only then merge
   or deploy those consumers. A package release does not deploy Spatial.

The demo follows verified `main` and may include documented unreleased features.
The README labels these explicitly; never claim they exist in a previously
published immutable archive just because they work on the demo.

CI publishes the demo only after both package and browser jobs pass. The site is
built using the archive installed into an independent consumer, not workspace
aliases or direct imports back into Spatial.

## Opt-in automated archive releases

The `CI` workflow builds one `npm-package` artifact. Both Node versions and all
three packed browser lanes consume that archive and verify its SHA-256.
Local commands still pack the source by default. Setting `BVM_PACKAGE_DIRECTORY`
selects an existing archive directory. Missing, ambiguous, or mismatched input
fails instead of silently packing a replacement.

Automation stays off until a maintainer completes these prerequisites:

1. Merge the reviewed workflows onto `main`; retain the Node 22/24, Chromium,
   Firefox, WebKit and Published archive identity checks. Dependency Review
   rejects new dependencies with known high or critical vulnerabilities.
   CodeQL uses GitHub's configured default setup; there is no second scan workflow.
2. Create an active repository tag `ruleset` covering `refs/tags/v*` (or all tags),
   with update and deletion restrictions, no exclusions and no bypass actors.
   The publisher checks this through the API and refuses absent or unreadable rules.
3. Create the `github-release` environment with required reviewers, prevent
   self-review, disable administrator bypass, and select custom deployment policies with exactly one tag policy
   named `v0.1.0-beta.*`. The publisher verifies these protections. Reviewers must
   check the source SHA, qualified run and package version before approving.
   Enable GitHub immutable releases in repository settings to lock published
   assets as well as tags. These settings are maintainer actions, not workflow actions.
4. Confirm GitHub artifact attestations are available for the public repository.
   Set the repository variable `ENABLE_BETA_RELEASES` to exactly `true` only after
   the environment and rules are ready. No registry login, secret, or npm account
   binding is used by this archive channel.

To release, update `package.json`, the root lockfile version and `CHANGELOG.md`
in a reviewed PR. After it reaches `main`, create a new tag exactly matching the
package, such as `v0.1.0-beta.6`. Only `v0.1.0-beta.N` tags qualify: development
suffixes, stable versions, branch events, forks, moved tags and commits outside
`main` cannot publish. Creating a tag is a separate maintainer action.

The tag run executes the complete CI matrix, including the existing public
distribution check. The release job requires every lane to succeed; skipped or
cancelled qualification does not pass. Tag runs never deploy Pages. After
environment approval, a fresh publisher downloads the tested artifact from the
same run, verifies the source/tag/version/checksum again, and signs provenance
using GitHub OIDC. It has no checkout, build, dependency installation, npm token
or package lifecycle script execution.

A sole maintainer cannot approve a run they initiated when self-review is
prevented. Before enabling automation, establish a separately authorized tag
initiator or an independent eligible reviewer; do not add collaborators or remove
self-review prevention just to unblock a release. Keep the opt-in variable off
until that approval path has been reviewed.

The publisher creates a draft, uploads the archive, `SHA256SUMS`,
`release-evidence.json` (source, run, SHA-256 and npm SHA-512 integrity), and
`provenance.sigstore.json`, then publishes a prerelease without changing `latest`.
It rechecks the tag before publication and verifies the anonymous public archive
download afterward. The publication response must also confirm immutable assets.
Reading the repository immutability setting requires administrative permission,
so it remains a maintainer setup check, not an added publisher token capability. The run summary and `beta-release-evidence` artifact retain
the result. Verify the signature independently after downloading the archive:

```sh
gh attestation verify ponchia-visual-models-0.1.0-beta.6.tgz --repo Ponchia/bronto-visual-models
```

`publication-receipt.json` records the accepted draft ID, acknowledged uploads
and publication response, including partial failures. The receipt is written
before checking the response, so a failed immutability check cannot hide an
already-published release. It does not prove that an unacknowledged API request
had no effect. Inspect the identified release and original tag before recovery.

Publication has several steps and no automatic rollback. An upload failure leaves a draft
for inspection; a public-download failure can occur after publication. Inspect
the run, release, and retained evidence before taking further action. Existing
releases are refused, including drafts: retries do not replace assets or blindly
resume. Keep published versions immutable; correct a bad beta in a new version.
Turning off `ENABLE_BETA_RELEASES` prevents future automated releases.

## Configuration verified on 24 October 2026

The repository now has an active `Protect release tags` rule for `refs/tags/v*`,
with update/deletion restrictions and no bypass actors. The `github-release`
environment requires Ponchia's review, prevents self-review, disallows
administrator bypass and permits only the `v0.1.0-beta.*` tag policy. Immutable
releases are enabled for future publications. Existing releases were not changed.

`ENABLE_BETA_RELEASES` remains explicitly `false`. Ponchia is currently the only
repository collaborator, so a tag run initiated by Ponchia cannot also be
approved by Ponchia. A separately authorized initiation/review path must be
settled before activation. No collaborator was added, tag created, approval
granted, archive signed or release published during this configuration work.
The source still has a development version; it is not a releasable beta tag.

## Optional npm registry publication

The package metadata declares public scope access. Registry publication still
requires an authenticated publisher or an npm trusted-publisher configuration for
this repository. Do not claim an npm version exists because a GitHub archive does.
Use an explicit beta dist-tag for prereleases, retain provenance where supported,
and verify the registry version and integrity after publication.

Changing a release channel must not create two independently edited source trees.
The public repository remains the sole owner of extracted algorithms.

## Development dependency exceptions

The documentation gate runs the markdownlint library directly against root,
`docs/` and `.github/` Markdown, including new untracked files, with
`.markdownlint.json` as its one configuration. This avoids the CLI's globbing
stack while retaining the existing rules and diagnostic format.

The development-only KaTeX 0.18.2 override applies under
`micromark-extension-math`. Revisit the override when the parent dependency
selects a fixed version itself. CI runs the documentation gate; none of these
packages is a core runtime dependency.

## Published distribution contract

`docs/distribution.json` identifies the last verified GitHub archive independently
of `package.json`. Keep the README and first-run guide on that version while a
new source candidate is in development. After publication, verify the exact
public bytes, update the manifest and run `node scripts/check-distribution.mjs --online`.
CI checks the public archive before publishing the demo. Release creation is confined
to the opt-in beta tag path. CI never silently substitutes source for an unavailable package.

`@types/node` stays on the reviewed 24.x development line while CI qualifies
Node 22 and 24. A types-only major update does not prove that Node 26 APIs work
on the supported runtime floor. Dependabot major bumps for this dependency are
deferred until the type/runtime support policy is deliberately reviewed.
