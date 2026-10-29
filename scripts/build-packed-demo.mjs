import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { packageArchive } from "./package-archive.mjs";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
await mkdir(".tmp", { recursive: true });
const metadata = JSON.parse(await readFile("package.json", "utf8"));
const packed = packageArchive();
const directory = await mkdtemp(join(tmpdir(), "bvm-ui-consumer-"));
const output = resolve("site-dist");
const nativeDirectory = await mkdtemp(join(tmpdir(), "bvm-native-consumer-"));
try {
  const dependencies = { "@ponchia/visual-models": `file:${packed.path}` };
  for (const name of [
    "vega-lite",
    "vega-interpreter",
    "elkjs",
    "react",
    "react-dom",
    "@xyflow/react",
    "vega",
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
      "--manifest",
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
  // A second install omits every third-party rendering engine, including CSS.
  await writeFile(
    join(nativeDirectory, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "@ponchia/visual-models": `file:${packed.path}`,
        react: metadata.devDependencies.react,
        "react-dom": metadata.devDependencies["react-dom"],
        "@ponchia/ui": metadata.devDependencies["@ponchia/ui"],
        vite: metadata.devDependencies.vite,
      },
    }),
  );
  await cp("test/native", join(nativeDirectory, "native"), { recursive: true });
  execFileSync(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: nativeDirectory,
    stdio: "pipe",
  });
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { createRequire } from "node:module"; import assert from "node:assert/strict";
    const require = createRequire(import.meta.url);
    for (const engine of ["@xyflow/react", "vega", "vis-timeline", "vis-data", "elkjs"])
      assert.throws(() => require.resolve(engine), undefined, engine + " leaked into native install");
  `,
    ],
    { cwd: nativeDirectory, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "build",
      "native",
      "--base=/native/",
      "--outDir",
      resolve(".tmp/react-contract/native"),
      "--emptyOutDir",
    ],
    { cwd: nativeDirectory, stdio: "inherit" },
  );
  for (const [source, name] of [
    ["test/chart-browser", "chart-contract"],
    ["test/routing-browser", "routing-contract"],
    ["test/surface-browser", "surface-contract"],
    ["test/exploration-browser", "exploration-contract"],
    ["test/c4-browser", "c4-contract"],
    ["test/c4-layout-browser", "c4-layout-contract"],
    ["test/adapter-browser", "adapter-contract"],
  ]) {
    await cp(source, join(directory, name), { recursive: true });
    if (name === "c4-layout-contract")
      await cp("demo/layout.ts", join(directory, name, "layout.ts"));
    execFileSync(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "build",
        name,
        "--base=/",
        "--outDir",
        resolve(".tmp", name),
        "--emptyOutDir",
      ],
      { cwd: directory, stdio: "inherit" },
    );
  }
  await writeFile(
    ".tmp/packed-ui-evidence.json",
    JSON.stringify(
      {
        version: metadata.version,
        packageIntegrity: packed.integrity,
        isolatedConsumer: true,
        importedByPackageName: true,
        spatialDependencies: false,
        nativeGanttWithoutRenderingEngines: true,
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
  await rm(nativeDirectory, { recursive: true, force: true });
}
