import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../../demo/index.html", import.meta.url), "utf8");
const sitemap = readFileSync(new URL("../../demo/public/sitemap.xml", import.meta.url), "utf8");
const canonical = "https://ponchia.github.io/bronto-visual-models/";

test("GitHub Pages demo has one canonical, social sharing identity, and matching sitemap", () => {
  const matches = [...html.matchAll(/rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(matches, [canonical]);
  assert.match(html, /<meta name="description"/);
  assert.match(html, /<html lang="en">/);
  assert.match(
    html,
    /<meta property="og:url" content="https:\/\/ponchia.github.io\/bronto-visual-models\/"/,
  );
  assert.match(html, /<meta name="robots" content="index, follow"/);
  assert.match(
    html,
    /<link rel="sitemap" type="application\/xml" href="\/bronto-visual-models\/sitemap.xml"/,
  );
  assert.match(sitemap, /<urlset\b/);
  assert.deepEqual(
    [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
    [canonical],
  );
});

test("structured data identifies open source, not a host-only integration claim", () => {
  const block = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(block);
  const schema = JSON.parse(block[1]);
  assert.equal(schema["@type"], "SoftwareSourceCode");
  assert.equal(schema.codeRepository, "https://github.com/Ponchia/bronto-visual-models");
  assert.equal(schema.url, canonical);
  assert.equal(schema.programmingLanguage, "TypeScript");
  assert.match(schema.license, /MIT/);
});

test("demo/public is the sole portable source for sitemap build assets", () => {
  assert.equal(existsSync(new URL("../../demo/public/sitemap.xml", import.meta.url)), true);
});
