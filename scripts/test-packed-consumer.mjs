import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageArchive } from "./package-archive.mjs";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
await mkdir(".tmp", { recursive: true });
const info = packageArchive();
const tarball = info.path;
const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
  .trim()
  .split("\n")
  .map((entry) => entry.replace(/^package\//, ""));
for (const required of [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/react/index.js",
  "dist/react/styles.css",
  "dist/react/base.css",
  "dist/react/gantt.js",
  "dist/node/index.js",
  "bin/bronto-visual-models.mjs",
  "LICENSE",
  "examples/first-model.mjs",
])
  assert(entries.includes(required), `Packed package lacks ${required}`);
assert(
  !entries.some((name) => /(^|\/)(node_modules|\.git|\.env|test-results)(\/|$)/.test(name)),
  "Private/generated workspace material entered package",
);
const directory = await mkdtemp(join(tmpdir(), "bronto-visual-models-consumer-"));
try {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    npm,
    ["install", tarball, "--ignore-scripts", "--omit=optional", "--no-audit", "--no-fund"],
    { cwd: directory, stdio: "pipe" },
  );
  await writeFile(
    join(directory, "consumer.mjs"),
    `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MemoryModelStore, createVisualRegistry, modelTargets, chartEncodingGuidance } from '@ponchia/visual-models';
import { readFileStore, executeFileCommand, previewFileCommand } from '@ponchia/visual-models/node';
const require = createRequire(import.meta.url);
for (const engine of ['react', '@xyflow/react', 'vega', 'vega-lite', 'vega-interpreter', 'vis-timeline', '@ponchia/ui', 'elkjs', '@dagrejs/dagre']) {
  assert.throws(() => require.resolve(engine), undefined, engine + ' should not be necessary for core');
}
const advice = chartEncodingGuidance({ spec: {mark:'line', encoding: {x: {field:'label',type:'nominal'},y:{field:'value',type:'quantitative'}}},values:[{label:'Unordered',value:2}] });
assert.equal(advice.notes[0].code, 'nominal-path');
const store = new MemoryModelStore({ registry: createVisualRegistry() });
const command = { type: 'create', key: 'consumer-create', model: { id: 'graph', title: 'Independent consumer', renderer: 'diagram', content: { nodes: [{ id: 'a', label: 'App', x: 0, y: 0 }], edges: [] } } };
await store.execute(command);
const edit = { type: 'edit', id: 'graph', key: 'consumer-edit', patch: { items: [{ field: 'nodes', set: [{ id: 'a', label: 'API', expect: { label: 'App' } }] }] } };
const preview = await store.preview(edit);
assert.equal(preview.effect, 'none');
assert.equal(preview.model.revision, 2);
assert.equal(store.get('graph').revision, 1);
assert.equal(store.getReceipt('consumer-edit'), undefined);
await store.execute(edit);
assert.equal(store.getReceipt('consumer-edit').revision, 2);
assert.equal((await store.execute(edit)).replayed, true);
assert.equal(modelTargets(store.get('graph'))[0].label, 'API');
await store.execute({ type: 'undo', id: 'graph', key: 'consumer-undo', operation: 'consumer-edit' });
assert.equal(modelTargets(store.get('graph'))[0].label, 'App');
const filePreview = await previewFileCommand('missing-parent/models.json', command);
assert.equal(filePreview.effect, 'none');
await executeFileCommand('models.json', command);
assert.equal((await readFileStore('models.json')).get('graph').title, 'Independent consumer');
console.log('Packed core, local transactions, identities and undo work without Spatial or UI peers.');
`,
  );
  execFileSync(process.execPath, ["consumer.mjs"], { cwd: directory, stdio: "inherit" });
  execFileSync(
    process.execPath,
    [join(directory, "node_modules/@ponchia/visual-models/examples/first-model.mjs")],
    { cwd: directory, stdio: "inherit" },
  );
  const bin = join(directory, "node_modules/@ponchia/visual-models/bin/bronto-visual-models.mjs");
  const catalog = JSON.parse(
    execFileSync(process.execPath, [bin, "catalog"], { cwd: directory, encoding: "utf8" }),
  );
  assert.equal(catalog.renderers.length, 10);
  const inspect = JSON.parse(
    execFileSync(process.execPath, [bin, "inspect", "graph", "--store", "models.json"], {
      cwd: directory,
      encoding: "utf8",
    }),
  );
  assert.equal(inspect.targets.length, 1);
  const manifest = JSON.parse(
    await readFile(join(directory, "node_modules/@ponchia/visual-models/package.json"), "utf8"),
  );
  assert.equal(manifest.name, "@ponchia/visual-models");
  console.log(
    JSON.stringify(
      {
        package: manifest.name,
        version: manifest.version,
        bytes: info.size,
        files: entries.length,
        integrity: info.integrity,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
