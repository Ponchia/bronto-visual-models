import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { resolve, join } from "node:path";

// Explicit inputs fail closed: never fall back to packing another artifact.
export function inspectArchive(directory, expectedVersion) {
  const names = readdirSync(directory).filter((name) => name.endsWith(".tgz"));
  assert.equal(names.length, 1, "Expected exactly one package archive");
  const filename = names[0];
  const path = resolve(directory, filename);
  assert(lstatSync(path).isFile(), "Archive must be a regular file");
  assert(!lstatSync(path).isSymbolicLink(), "Archive cannot be a symlink");
  const bytes = readFileSync(path);
  assert(bytes.length > 0 && bytes.length < 20 * 1024 * 1024, "Invalid archive size");
  const manifest = JSON.parse(
    execFileSync("tar", ["-xOf", path, "package/package.json"], { maxBuffer: 1024 * 1024 }),
  );
  assert.equal(manifest.name, "@ponchia/visual-models");
  assert.equal(manifest.version, expectedVersion, "Archive version differs from source");
  assert.equal(filename, `ponchia-visual-models-${expectedVersion}.tgz`);
  return {
    path,
    filename,
    version: manifest.version,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

export function packageArchive() {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  if (process.env.BVM_PACKAGE_DIRECTORY !== undefined) {
    const archive = inspectArchive(process.env.BVM_PACKAGE_DIRECTORY, version);
    if (process.env.BVM_PACKAGE_SHA256 !== undefined) {
      assert.match(process.env.BVM_PACKAGE_SHA256, /^[a-f0-9]{64}$/);
      assert.equal(archive.sha256, process.env.BVM_PACKAGE_SHA256, "Candidate checksum mismatch");
    }
    return archive;
  }
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", ".tmp"], {
      encoding: "utf8",
    }),
  );
  assert.equal(packed.length, 1);
  return inspectArchive(join(".tmp"), version);
}
