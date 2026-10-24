import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectArchive, packageArchive } from "../package-archive.mjs";

test("archive selection checks real tar metadata and rejects ambiguity, symlinks and corruption", () => {
  const directory = mkdtempSync(join(tmpdir(), "bvm-archive-guard-"));
  try {
    const version = "0.1.0-beta.6";
    const input = join(directory, "input");
    const output = join(directory, "output");
    mkdirSync(join(input, "package"), { recursive: true });
    mkdirSync(output);
    const path = join(output, `ponchia-visual-models-${version}.tgz`);
    writeFileSync(
      join(input, "package/package.json"),
      JSON.stringify({ name: "@ponchia/visual-models", version }),
    );
    execFileSync("tar", ["-czf", path, "-C", input, "package"]);
    const archive = inspectArchive(output, version);
    assert.match(archive.sha256, /^[a-f0-9]{64}$/);
    assert.match(archive.integrity, /^sha512-/);
    assert.throws(() => inspectArchive(output, "0.1.0-beta.7"), /version differs/);
    copyFileSync(path, join(output, "extra.tgz"));
    assert.throws(() => inspectArchive(output, version), /exactly one/);
    rmSync(join(output, "extra.tgz"));
    const retained = join(directory, "retained.tgz");
    copyFileSync(path, retained);
    rmSync(path);
    symlinkSync(retained, path);
    assert.throws(() => inspectArchive(output, version), /regular file/);
    rmSync(path);
    assert.throws(() => inspectArchive(output, version), /exactly one/);
    writeFileSync(path, "corrupt tarball");
    assert.throws(() => inspectArchive(output, version));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an explicit unavailable candidate never silently repacks the workspace", () => {
  const old = process.env.BVM_PACKAGE_DIRECTORY;
  process.env.BVM_PACKAGE_DIRECTORY = "/nonexistent/bvm-candidate";
  try {
    assert.throws(() => packageArchive(), /ENOENT/);
  } finally {
    if (old === undefined) delete process.env.BVM_PACKAGE_DIRECTORY;
    else process.env.BVM_PACKAGE_DIRECTORY = old;
  }
});
