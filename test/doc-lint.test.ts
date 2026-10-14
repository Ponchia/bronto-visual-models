import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const linter = resolve("scripts/lint-docs.mjs");
const config = resolve(".markdownlint.json");

test("documentation lint checks root, docs and GitHub Markdown without a Git checkout", (t) => {
  const root = mkdtempSync(join(tmpdir(), "bvm-docs-lint-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, ".github"));
  writeFileSync(join(root, ".markdownlint.json"), readFileSync(config));
  for (const file of ["README.md", "docs/guide.md", ".github/PULL_REQUEST_TEMPLATE.md"])
    writeFileSync(join(root, file), "# Valid\n\nSome prose.\n");
  const run = () =>
    spawnSync(process.execPath, [linter], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
  const baseline = run();
  assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);
  assert.match(baseline.stdout, /3 files passed/u);
  for (const file of ["NEW.md", "docs/new.md", ".github/new.md"])
    writeFileSync(join(root, file), "# First\n\n# Second\n");
  const failed = run();
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  for (const file of ["NEW.md", "docs/new.md", ".github/new.md"])
    assert.ok(failed.stderr.includes(`${file}:3: MD025`), `${file}: ${failed.stderr}`);
});
