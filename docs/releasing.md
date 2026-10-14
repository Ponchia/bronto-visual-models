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

CI publishes the demo only after both package and browser jobs pass. The site is
built using the archive installed into an independent consumer, not workspace
aliases or direct imports back into Spatial.

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
