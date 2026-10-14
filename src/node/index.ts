import { constants } from "node:fs";
import { open, lstat, mkdir, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { MemoryModelStore, type MemoryStoreOptions, type ModelStoreSnapshot, type ModelCommand, type CommandContext } from "../memory.ts";
import { VisualModelError } from "../model.ts";

export type FileStoreOptions = Omit<MemoryStoreOptions, "initial">;
export class FileCommitError extends VisualModelError {
  readonly effect: "none" | "unknown";
  constructor(message: string, effect: "none" | "unknown") {
    super("unavailable", message);
    this.name = "FileCommitError";
    this.effect = effect;
  }
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

async function canonical(file: string, createParent: boolean): Promise<string> {
  const absolute = resolve(file);
  if (createParent) await mkdir(dirname(absolute), { recursive: true });
  const parent = await realpath(dirname(absolute));
  const target = join(parent, basename(absolute));
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new VisualModelError("invalid", "The model store must be a regular file, not a link");
  } catch (error) { if (!missing(error)) throw error; }
  return target;
}
async function readSnapshot(file: string, maxBytes: number): Promise<ModelStoreSnapshot | undefined> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new VisualModelError("invalid", "Store file is not regular or exceeds its byte limit");
    const bytes = await handle.readFile();
    if (bytes.byteLength > maxBytes) throw new VisualModelError("invalid", "Store file grew beyond its byte limit");
    try { return JSON.parse(bytes.toString("utf8")) as ModelStoreSnapshot; }
    catch { throw new VisualModelError("invalid", "Model store is not valid JSON; restore or repair it before writing"); }
  } catch (error) { if (missing(error)) return undefined; throw error; }
  finally { await handle?.close(); }
}

/** Read a committed snapshot. Readers see either complete generation after an atomic rename. */
export async function readFileStore(file: string, options: FileStoreOptions = {}): Promise<MemoryModelStore> {
  let target: string;
  try { target = await canonical(file, false); }
  catch (error) { if (missing(error)) return new MemoryModelStore(options); throw error; }
  const initial = await readSnapshot(target, options.maxBytes ?? 16 * 1024 * 1024);
  return new MemoryModelStore({ ...options, ...(initial ? { initial } : {}) });
}

/**
 * A cooperative local-file transaction: exclusive lock, one complete state, fsync and rename.
 * No stale lock is guessed away. After a crashed writer, verify its PID before removing its lock.
 * Use a real transactional database adapter for multiple hosts or network filesystems.
 */
export async function executeFileCommand(file: string, command: ModelCommand, context: CommandContext = {}, options: FileStoreOptions = {}) {
  const target = await canonical(file, true);
  const lockPath = `${target}.lock`;
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST")
      throw new VisualModelError("unavailable", "The model store is locked. Inspect the writer; do not remove a live writer's lock");
    throw error;
  }
  const ownership = await lock.stat();
  const temporary = `${target}.${randomUUID()}.tmp`;
  let replaced = false;
  let prepared = false;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + "\n");
    await lock.sync();
    const store = await readFileStore(target, options);
    const result = await store.execute(command, context);
    // A read-only replay does not rewrite the file or its timestamp.
    if (result.replayed) return result;
    const handle = await open(temporary, "wx", 0o600);
    prepared = true;
    try { await handle.writeFile(JSON.stringify(store.snapshot()) + "\n"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, target);
    replaced = true;
    const directory = await open(dirname(target), "r");
    try { await directory.sync(); }
    finally { await directory.close(); }
    return result;
  } catch (error) {
    if (replaced) throw new FileCommitError("The file was replaced but durability confirmation failed. Inspect or retry the exact same operation key", "unknown");
    if (error instanceof VisualModelError) throw error;
    throw new FileCommitError(error instanceof Error ? error.message : "File transaction failed before commit", "none");
  } finally {
    if (prepared && !replaced) await unlink(temporary).catch(() => {});
    try {
      await lock.close();
      const current = await lstat(lockPath);
      if (current.dev !== ownership.dev || current.ino !== ownership.ino)
        throw new Error("The transaction lock was replaced by another owner");
      await unlink(lockPath);
    } catch {
      throw new FileCommitError("Lock cleanup could not be confirmed. Inspect the store and lock before retrying the exact operation", replaced ? "unknown" : "none");
    }
  }
}
