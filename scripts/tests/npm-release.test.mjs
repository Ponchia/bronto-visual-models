import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const docs = readFileSync(new URL("../../docs/releasing.md", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const job = (name, next) =>
  ci.slice(ci.indexOf(`  ${name}:\n`), next ? ci.indexOf(`  ${next}:\n`) : undefined);
const readiness = job("npm-publisher-readiness", "npm-publish");
const publish = job("npm-publish", "npm-verify-registry");
const verify = job("npm-verify-registry");
const sparse = (block) =>
  [...block.matchAll(/sparse-checkout: \|\n((?: {12}\S[^\n]*\n)+)/g)].map((m) =>
    m[1].trim().split(/\s+/),
  );
const publisherFiles = [
  "/scripts/source-publisher.mjs",
  "/scripts/extract-publisher-source.py",
  "/scripts/audit-publishing-tooling.mjs",
  "/tooling/publisher/",
];
const gate =
  "if: github.repository == 'Ponchia/bronto-visual-models' && github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') && vars.ENABLE_BETA_RELEASES == 'true'";

test("npm jobs run only on opted-in beta tags, after the verified GitHub release", () => {
  for (const block of [publish, verify]) assert.ok(block.includes(gate));
  // The read-only audit runs on every change so publisher drift fails early.
  assert.doesNotMatch(readiness, /\n {4}if:/);
  assert.match(publish, /needs: \[package, release-archive, npm-publisher-readiness\]/);
  assert.match(verify, /needs: \[package, npm-publish\]/);
  assert.match(publish, /\^v0\\\.1\\\.0-beta\\\.\(0\|\[1-9\]\[0-9\]\*\)\$/);
  assert.doesNotMatch(publish, /continue-on-error:|always\(\)/);
});

test("only the audited source-locked publisher reaches OIDC, never the runner npm", () => {
  assert.match(readiness, /permissions:\n\s+contents: read\n/);
  assert.doesNotMatch(
    readiness,
    /id-token:|: write|environment:|secrets\.|\bnpm (?:install|ci|publish)\b/,
  );
  assert.match(
    readiness,
    /node scripts\/source-publisher\.mjs prepare "\$RUNNER_TEMP\/vm-publisher"/,
  );
  assert.match(
    readiness,
    /node scripts\/source-publisher\.mjs audit "\$RUNNER_TEMP\/vm-publisher"/,
  );
  assert.deepEqual(sparse(readiness), [publisherFiles]);
  assert.match(publish, /environment: npm-publish\n/);
  assert.match(publish, /permissions:\n\s+contents: read\n\s+id-token: write\n/);
  assert.deepEqual(
    sparse(publish),
    [publisherFiles],
    "The OIDC job checks out publisher tooling only",
  );
  assert.equal(publish.match(/actions\/checkout@/g)?.length, 1);
  assert.match(publish, /path: publisher\n/);
  assert.ok(
    publish.indexOf("source-publisher.mjs audit") < publish.indexOf('npm-cli.js" publish'),
    "audit before publish",
  );
  assert.match(
    publish,
    /node "\$RUNNER_TEMP\/vm-publisher\/source\/bin\/npm-cli\.js" publish "\.\/\$ARCHIVE" --ignore-scripts --provenance --access public --tag beta/,
  );
  assert.doesNotMatch(publish, /^\s*npm (?:publish|ci|install)\b|node scripts\//m);
  assert.doesNotMatch(ci, /NODE_AUTH_TOKEN|NPM_TOKEN|--tag latest/);
  assert.equal(pkg.scripts["publisher:readiness"], "node scripts/source-publisher.mjs readiness");
});

test("npm receives exactly the archive the release verified, then a read-only check", () => {
  assert.match(publish, /name: npm-package\n\s+path: candidate/);
  assert.match(publish, /EXPECTED_SHA256: \$\{\{ needs\.package\.outputs\.sha256 \}\}/);
  assert.match(
    publish,
    /test "\$\(sha256sum "\$archive" \| cut -d' ' -f1\)" = "\$EXPECTED_SHA256"/,
  );
  assert.match(publish, /is not bootstrapped on npm/);
  assert.match(publish, /This version already exists in npm/);
  assert.match(verify, /permissions:\n\s+contents: read\n/);
  assert.doesNotMatch(verify, /id-token:|environment:|npm-cli\.js|npm publish/);
  assert.match(verify, /dist\?\.integrity !== integrity/);
  assert.match(verify, /\["dist-tags"\]\?\.beta !== version/);
  assert.match(verify, /dist\?\.attestations\?\.provenance/);
});

test("the bootstrap and trusted publisher are documented with the source-locked npm", () => {
  assert.match(docs, /## npm registry/);
  assert.match(docs, /node scripts\/source-publisher\.mjs prepare/);
  assert.match(docs, /"\$NPM_CLI" publish "\$TARBALL" --ignore-scripts --access public --tag beta/);
  assert.match(docs, /--provenance=false/);
  assert.match(docs, /\| Workflow \| `ci\.yml` \|/);
  assert.match(docs, /\| Environment \| `npm-publish` \|/);
});
