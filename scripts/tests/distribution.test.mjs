import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  distributionUrl,
  validateDistribution,
  verifyArchiveBytes,
  verifyPublishedDistribution,
  readBounded,
} from "../distribution-contract.mjs";

const bytes = Buffer.from("controlled artifact fixture, not an installable archive");
const fixture = {
  schema: 1,
  version: "0.1.0-beta.5",
  source: "a".repeat(40),
  ciRun: 123,
  archive: "ponchia-visual-models-0.1.0-beta.5.tgz",
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
};
const url = distributionUrl(fixture);
const release = () => ({
  draft: false,
  prerelease: true,
  tag_name: `v${fixture.version}`,
  assets: [
    { name: fixture.archive, state: "uploaded", size: fixture.bytes, browser_download_url: url },
  ],
});
const transport =
  ({
    metadata = release(),
    object = { type: "commit", sha: fixture.source },
    payload = bytes,
    status = 200,
  } = {}) =>
  async (target) => {
    if (target === url) return new Response(payload, { status });
    return Response.json(target.includes("/releases/") ? metadata : { object });
  };
test("verified documentation can follow a published version independently of development source", () =>
  validateDistribution(fixture, `npm install ${url}`));
for (const change of [
  { schema: 2 },
  { version: "0.1.0-beta.6-dev.0" },
  { archive: "other.tgz" },
  { source: "main" },
  { ciRun: 0 },
  { bytes: -1 },
  { bytes: 20 * 1024 * 1024 },
  { sha256: "broken" },
  { integrity: "sha512-broken" },
]) {
  test(`rejects invalid distribution identity ${Object.keys(change)[0]}`, () =>
    assert.throws(() => validateDistribution({ ...fixture, ...change }, url)));
}
test("rejects a premature README install version", () =>
  assert.throws(() => validateDistribution(fixture, url.replaceAll("beta.5", "beta.6"))));
test("rejects an extra stale installation URL", () =>
  assert.throws(() =>
    validateDistribution(fixture, `${url} ${url.replaceAll("beta.5", "beta.4")}`),
  ));
test("rejects documentation without an install URL", () =>
  assert.throws(() => validateDistribution(fixture, "No package link")));
test("validates exact archive bytes", () => verifyArchiveBytes(fixture, bytes));
test("rejects corrupted same-length archive bytes", () =>
  assert.throws(() => verifyArchiveBytes(fixture, Buffer.alloc(bytes.length))));
test("rejects truncated archive bytes", () =>
  assert.throws(() => verifyArchiveBytes(fixture, bytes.subarray(1))));
test("verifies public release, source commit and exact archive with an injected transport", async () => {
  assert.equal(
    (await verifyPublishedDistribution(fixture, transport())).publicArchiveVerified,
    true,
  );
});
for (const metadata of [
  { ...release(), draft: true },
  { ...release(), prerelease: false },
  { ...release(), tag_name: "v0.1.0-beta.6" },
  { ...release(), assets: [] },
  { ...release(), assets: [release().assets[0], release().assets[0]] },
]) {
  test(`rejects unpublished or mismatched release ${JSON.stringify(metadata).slice(0, 80)}`, async () =>
    assert.rejects(verifyPublishedDistribution(fixture, transport({ metadata }))));
}
test("rejects a moved source tag", async () =>
  assert.rejects(
    verifyPublishedDistribution(
      fixture,
      transport({ object: { type: "commit", sha: "b".repeat(40) } }),
    ),
  ));
test("rejects a missing asset download", async () =>
  assert.rejects(verifyPublishedDistribution(fixture, transport({ status: 404 }))));
test("rejects declared oversized responses", async () =>
  assert.rejects(
    readBounded(new Response(bytes, { headers: { "content-length": "999999" } }), 32),
  ));
test("bounds streaming bodies without a length header", async () =>
  assert.rejects(readBounded(new Response(bytes), 8)));
