import { readFile } from "node:fs/promises";
import { validateDistribution, verifyPublishedDistribution } from "./distribution-contract.mjs";

const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== "--online"))
  throw new Error("Usage: node scripts/check-distribution.mjs [--online]");
const manifest = JSON.parse(
  await readFile(new URL("../docs/distribution.json", import.meta.url), "utf8"),
);
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const guide = await readFile(new URL("../docs/getting-started.md", import.meta.url), "utf8");
validateDistribution(manifest, `${readme}\n${guide}`);
console.log(
  JSON.stringify(
    flags.includes("--online")
      ? await verifyPublishedDistribution(manifest)
      : { publishedVersion: manifest.version, documentationAligned: true, networkChecked: false },
    null,
    2,
  ),
);
