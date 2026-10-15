import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
await mkdir(".tmp", { recursive: true });
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const packed = JSON.parse(
  execFileSync(npm, ["pack", "--json", "--ignore-scripts", "--pack-destination", ".tmp"], {
    encoding: "utf8",
  }),
)[0];
const directory = await mkdtemp(join(tmpdir(), "bvm-ui-consumer-"));
const output = resolve("site-dist");
try {
  const dependencies = { "@ponchia/visual-models": `file:${resolve(".tmp", packed.filename)}` };
  for (const name of [
    "elkjs",
    "react",
    "react-dom",
    "@xyflow/react",
    "vega",
    "vega-lite",
    "vega-interpreter",
    "vega-tooltip",
    "vis-timeline",
    "vis-data",
    "@ponchia/ui",
    "vite",
  ])
    dependencies[name] = metadata.devDependencies[name];
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies }),
  );
  await cp("demo", join(directory, "demo"), { recursive: true });
  execFileSync(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: directory,
    stdio: "pipe",
  });
  execFileSync(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "build",
      "demo",
      "--base=/bronto-visual-models/",
      "--outDir",
      output,
      "--emptyOutDir",
    ],
    { cwd: directory, stdio: "inherit" },
  );
  await mkdir(join(output, "third-party"), { recursive: true });
  await cp(
    join(directory, "node_modules/elkjs/LICENSE.md"),
    join(output, "third-party/elkjs-LICENSE.md"),
  );
  await writeFile(
    join(output, "third-party/elkjs-SOURCE.txt"),
    "Unmodified elkjs 0.12.0. Source: https://github.com/kieler/elkjs\nLicense: ./elkjs-LICENSE.md\n",
  );
  // A separate test-only consumer is never uploaded as part of the public Pages site.
  await cp("test/browser", join(directory, "react-contract"), { recursive: true });
  execFileSync(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "build",
      "react-contract",
      "--base=/",
      "--outDir",
      resolve(".tmp/react-contract"),
      "--emptyOutDir",
    ],
    { cwd: directory, stdio: "inherit" },
  );
  await cp("test/chart-browser", join(directory, "chart-contract"), { recursive: true });
  execFileSync(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "build",
      "chart-contract",
      "--base=/",
      "--outDir",
      resolve(".tmp/chart-contract"),
      "--emptyOutDir",
    ],
    { cwd: directory, stdio: "inherit" },
  );
  await cp("test/routing-browser", join(directory, "routing-contract"), { recursive: true });
  execFileSync(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "build",
      "routing-contract",
      "--base=/",
      "--outDir",
      resolve(".tmp/routing-contract"),
      "--emptyOutDir",
    ],
    { cwd: directory, stdio: "inherit" },
  );
  await writeFile(
    ".tmp/packed-ui-evidence.json",
    JSON.stringify(
      {
        version: metadata.version,
        packageIntegrity: packed.integrity,
        isolatedConsumer: true,
        importedByPackageName: true,
        spatialDependencies: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "Site built from a packed package installed in an independent consumer, without workspace aliases.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
