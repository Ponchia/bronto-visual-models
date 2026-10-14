import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, stat, symlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { executeFileCommand, readFileStore } from "../src/node/index.ts";
import { VisualModelError, type ModelCommand } from "../src/index.ts";
const create: ModelCommand = { type: "create", key: "create", model: { id: "graph", title: "Test", renderer: "diagram", content: { nodes: [{ id: "a", label: "A", x: 0, y: 0 }], edges: [] } } };
const context = { actor: "test", at: "2026-10-14T12:00:00Z" };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), "bvm-test-")); t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, "models.json") };
}
test("file store persists documents, receipts and undo in one restartable snapshot", async (t) => {
  const { file } = await fixture(t);
  await executeFileCommand(file, create, context);
  await executeFileCommand(file, { type: "edit", key: "rename", id: "graph", patch: { title: "New" } }, context);
  assert.equal((await readFileStore(file)).get("graph")?.title, "New");
  await executeFileCommand(file, { type: "undo", key: "undo", id: "graph", operation: "rename" }, context);
  assert.equal((await readFileStore(file)).get("graph")?.title, "Test");
  const snapshot = JSON.parse(await readFile(file, "utf8"));
  assert.equal(snapshot.receipts.length, 3); assert.equal(snapshot.inverses.length, 2);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});
test("replayed file command leaves committed bytes and mtime unchanged", async (t) => {
  const { file } = await fixture(t); const first = await executeFileCommand(file, create, context);
  const before = await readFile(file); const mtime = (await stat(file)).mtimeMs;
  const replay = await executeFileCommand(file, create, context);
  assert.equal(replay.replayed, true); assert.equal(replay.receipt.revision, first.receipt.revision);
  assert.deepEqual(await readFile(file), before); assert.equal((await stat(file)).mtimeMs, mtime);
});
test("a stale edit leaves bytes intact and releases its own lock", async (t) => {
  const { file } = await fixture(t); await executeFileCommand(file, create, context); const before = await readFile(file);
  await assert.rejects(executeFileCommand(file, { type: "edit", key: "bad", id: "graph", patch: { ifRevision: 5, title: "No" } }, context), (error: any) => error.code === "conflict");
  assert.deepEqual(await readFile(file), before); await assert.rejects(access(file + ".lock"));
});
test("a live or unknown lock is never stolen or deleted", async (t) => {
  const { file } = await fixture(t); await writeFile(file + ".lock", "another-writer");
  await assert.rejects(executeFileCommand(file, create, context), (error: any) => error.code === "unavailable");
  assert.equal(await readFile(file + ".lock", "utf8"), "another-writer"); await assert.rejects(access(file));
});
test("corrupt state and symlinks are refused without repairing over them", async (t) => {
  const { dir, file } = await fixture(t); await writeFile(file, "broken");
  await assert.rejects(executeFileCommand(file, create, context), (error: any) => error.code === "invalid");
  assert.equal(await readFile(file, "utf8"), "broken");
  const link = join(dir, "link.json"); await symlink(file, link);
  await assert.rejects(executeFileCommand(link, create, context), (error: any) => error.code === "invalid");
});
test("aborted file transaction does not produce a document or abandoned lock", async (t) => {
  const { file } = await fixture(t); const signal = AbortSignal.abort();
  await assert.rejects(executeFileCommand(file, create, { ...context, signal }));
  await assert.rejects(access(file)); await assert.rejects(access(file + ".lock"));
});
test("installed CLI accepts keyed edits and exposes structured conflict exit codes", async (t) => {
  const { dir, file } = await fixture(t); const source = join(dir, "create.json"); const patch = join(dir, "patch.json");
  await writeFile(source, JSON.stringify(create.type === "create" ? create.model : {}));
  const cli = (...args: string[]) => spawnSync(process.execPath, ["bin/bronto-visual-models.mjs", ...args], { encoding: "utf8" });
  const first = cli("create", "--file", source, "--store", file, "--key", "cli-create");
  assert.equal(first.status, 0, first.stderr); assert.equal(JSON.parse(first.stdout).replayed, false);
  const replay = cli("create", "--file", source, "--store", file, "--key", "cli-create");
  assert.equal(replay.status, 0, replay.stderr); assert.equal(JSON.parse(replay.stdout).replayed, true);
  const inspect = cli("inspect", "graph", "--store", file); assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(JSON.parse(inspect.stdout).targets[0].elementId, "a");
  await writeFile(patch, JSON.stringify({ title: "Changed", ifRevision: 999 }));
  const stale = cli("edit", "graph", "--file", patch, "--store", file, "--key", "stale");
  assert.equal(stale.status, 4, stale.stderr); assert.equal(JSON.parse(stale.stderr).error.code, "conflict");
  assert.equal(cli("catalog", "--key", "unrelated").status, 2);
});
