import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { bundleReport } from "./bundle-budget.mjs";

const root = "site-dist";
const manifest = JSON.parse(await readFile(join(root, ".vite/manifest.json"), "utf8"));
const sizes = {};
for (const name of await readdir(join(root, "assets"))) {
  if (!/\.(?:js|css)$/.test(name)) continue;
  const bytes = await readFile(join(root, "assets", name));
  sizes[`assets/${name}`] = { raw: bytes.byteLength, gzip: gzipSync(bytes).byteLength };
}
const report = bundleReport(manifest, sizes);
await mkdir(".tmp", { recursive: true });
await writeFile(".tmp/bundle-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
