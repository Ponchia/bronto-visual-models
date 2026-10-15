import assert from "node:assert/strict";
import test from "node:test";
import { bundleReport, BUNDLE_LIMITS } from "../scripts/bundle-budget.mjs";
const manifest = {
  "index.html": {
    file: "assets/app.js",
    isEntry: true,
    imports: ["shared"],
    dynamicImports: ["graph"],
  },
  shared: { file: "assets/shared.js" },
  graph: { file: "assets/GraphView.js" },
};
const sizes = {
  "assets/app.js": { raw: 100, gzip: 90 },
  "assets/shared.js": { raw: 70, gzip: 50 },
  "assets/GraphView.js": { raw: 100, gzip: 80 },
};
test("bundle guard counts eager imports separately from dynamic renderers", () => {
  assert.equal(bundleReport(manifest, sizes).measurements.initialJavaScript, 140);
  assert.equal(bundleReport(manifest, sizes).measurements.totalJavaScript, 220);
});
test("bundle guard refuses accidental eager renderer loading and compressed-size growth", () => {
  const eager = structuredClone(manifest);
  eager["index.html"].imports.push("graph");
  assert.throws(() => bundleReport(eager, sizes), /promoted into the initial/);
  assert.throws(
    () =>
      bundleReport(manifest, {
        ...sizes,
        "assets/app.js": { raw: 999999, gzip: BUNDLE_LIMITS.initialJavaScript + 1 },
      }),
    /initialJavaScript/,
  );
  assert.throws(() => bundleReport({}, sizes), /entry/);
});
