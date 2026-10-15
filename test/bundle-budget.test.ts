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

test("an optional layout worker has a separate budget without relaxing renderer limits", () => {
  const worker = { ...sizes, "assets/elk-worker.min-abc.js": { raw: 1600000, gzip: 500000 } };
  const report = bundleReport(manifest, worker);
  assert.equal(report.measurements.optionalLayoutWorker, 500000);
  assert.equal(report.measurements.applicationJavaScript, 220);
  assert.throws(
    () =>
      bundleReport(manifest, { ...worker, "assets/GraphView.js": { raw: 900000, gzip: 230000 } }),
    /largestApplicationAsset/,
  );
});

test("worker demo cannot emit the unused bundled layout fallback", () => {
  assert.throws(
    () => bundleReport(manifest, { ...sizes, "assets/elk.bundled-abc.js": { raw: 10, gzip: 5 } }),
    /second in-process ELK/,
  );
});
