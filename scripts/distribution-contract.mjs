import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const repository = "Ponchia/bronto-visual-models";
const api = `https://api.github.com/repos/${repository}`;
const maxArchiveBytes = 16 * 1024 * 1024;

export function distributionUrl(manifest) {
  return `https://github.com/${repository}/releases/download/v${manifest.version}/${manifest.archive}`;
}

export function validateDistribution(manifest, documentation) {
  assert.equal(manifest.schema, 1, "Unknown distribution manifest schema");
  assert.match(manifest.version, /^0\.\d+\.\d+-beta\.\d+$/, "Expected a published beta version");
  assert.equal(manifest.archive, `ponchia-visual-models-${manifest.version}.tgz`);
  assert.match(manifest.source, /^[a-f0-9]{40}$/);
  assert.ok(Number.isSafeInteger(manifest.ciRun) && manifest.ciRun > 0);
  assert.ok(
    Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0 && manifest.bytes <= maxArchiveBytes,
  );
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  const advertised = [
    ...documentation.matchAll(
      /https:\/\/github\.com\/Ponchia\/bronto-visual-models\/releases\/download\/[^\s`<>"')]+\.tgz/g,
    ),
  ].map((match) => match[0]);
  assert.ok(advertised.length > 0, "Documentation must include an installable release URL");
  for (const url of advertised)
    assert.equal(
      url,
      distributionUrl(manifest),
      "Installation URL differs from verified distribution",
    );
  return manifest;
}

export function verifyArchiveBytes(manifest, bytes) {
  assert.equal(bytes.byteLength, manifest.bytes, "Published archive length changed");
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    manifest.sha256,
    "Published archive SHA-256 changed",
  );
  assert.equal(
    `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    manifest.integrity,
    "Published archive npm integrity changed",
  );
}

export async function readBounded(response, limit) {
  assert.ok(response.ok, `Public distribution request failed: HTTP ${response.status}`);
  assert.ok(response.body, "Public distribution response has no body");
  const declared = Number(response.headers.get("content-length"));
  assert.ok(!Number.isFinite(declared) || declared <= limit, "Public response exceeds size limit");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      assert.ok(length <= limit, "Public response exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

/** Public reads only. No tokens, npm lifecycle scripts, extraction or writes. */
export async function verifyPublishedDistribution(manifest, request = fetch) {
  validateDistribution(manifest, distributionUrl(manifest));
  const options = () => ({
    signal: AbortSignal.timeout(30000),
    headers: { "User-Agent": "bronto-visual-models-distribution-check" },
  });
  const json = async (url) =>
    JSON.parse(
      (await readBounded(await request(url, options()), 2 * 1024 * 1024)).toString("utf8"),
    );
  const release = await json(`${api}/releases/tags/v${manifest.version}`);
  assert.equal(release.draft, false, "Advertised release is not public");
  assert.equal(release.prerelease, true, "Beta must remain a prerelease");
  assert.equal(release.tag_name, `v${manifest.version}`);
  const assets = release.assets.filter((asset) => asset.name === manifest.archive);
  assert.equal(assets.length, 1, "Release must contain exactly the advertised archive");
  assert.equal(assets[0].state, "uploaded");
  assert.equal(assets[0].size, manifest.bytes);
  assert.equal(assets[0].browser_download_url, distributionUrl(manifest));
  let { object } = await json(`${api}/git/ref/tags/v${manifest.version}`);
  if (object.type === "tag") {
    assert.match(object.sha, /^[a-f0-9]{40}$/);
    ({ object } = await json(`${api}/git/tags/${object.sha}`));
  }
  assert.equal(object.type, "commit", "Release tag must resolve directly to a source commit");
  assert.equal(object.sha, manifest.source, "Release tag moved from its qualified source");
  const bytes = await readBounded(
    await request(distributionUrl(manifest), options()),
    manifest.bytes,
  );
  verifyArchiveBytes(manifest, bytes);
  return {
    version: manifest.version,
    source: manifest.source,
    bytes: bytes.length,
    sha256: manifest.sha256,
    publicArchiveVerified: true,
  };
}
