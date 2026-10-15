#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import {
  MemoryModelStore,
  VISUAL_RENDERERS,
  VISUAL_TEMPLATES,
  VisualModelError,
  visualRefusalDetail,
  validateVisualContent,
  withAuthoredTimes,
  modelTargets,
  chartEncodingGuidance,
  modelSummary,
  visualViewProjection,
} from "../dist/index.js";
import {
  readFileStore,
  executeFileCommand,
  previewFileCommand,
  FileCommitError,
} from "../dist/node/index.js";

const HELP = `bronto-visual-models — persistent visual artifacts

  catalog
  validate --file content.json
  list --store models.json
  receipt <operation-key> --store models.json
  show|inspect|export <id> --store models.json
  create --file model.json --store models.json --key <operation>
  edit <id> --file patch.json --store models.json --key <operation>
  undo <id> --operation <original-key> --store models.json --key <new-operation>
  fork <id> --as <new-id> --if-rev <revision> --store models.json --key <operation>

Add --dry-run to create/edit/undo/fork to preview without writing any file.
Previews are hypothetical: execution rechecks authority, revisions and capacity.
All output is JSON except this help. --actor defaults to local-cli.
Create files contain {id?, title, renderer, content} or {title, template}.
Validate files contain {renderer, modelType?, content}; no store is changed.
Exit codes: 0 success, 2 invalid/precondition, 3 not found, 4 conflict,
5 forbidden, 6 unavailable/unknown commit outcome. Retry only with the same key.
`;
const exits = {
  invalid: 2,
  "precondition-required": 2,
  "not-found": 3,
  conflict: 4,
  forbidden: 5,
  unavailable: 6,
};
async function readJson(file) {
  if (!file) throw new VisualModelError("invalid", "--file is required");
  const info = await stat(file);
  if (!info.isFile() || info.size > 2_000_000)
    throw new VisualModelError("invalid", "Input must be a regular JSON file of at most 2 MB");
  const bytes = await readFile(file);
  if (bytes.byteLength > 2_000_000) throw new VisualModelError("invalid", "Input grew beyond 2 MB");
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new VisualModelError("invalid", "Input is not valid JSON");
  }
}
function required(flags, name) {
  if (!flags[name]) throw new VisualModelError("invalid", `${name} is required`);
  return flags[name];
}
async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === "--version") {
    process.stdout.write(
      JSON.parse(await readFile(new URL("../package.json", import.meta.url))).version + "\n",
    );
    return;
  }
  const command = argv.shift();
  const positional = [];
  const flags = {};
  const allowed = new Set([
    "--file",
    "--store",
    "--key",
    "--actor",
    "--operation",
    "--as",
    "--if-rev",
  ]);
  while (argv.length) {
    const value = argv.shift();
    if (value === "--dry-run") {
      if (Object.hasOwn(flags, value))
        throw new VisualModelError("invalid", "Repeated flag: --dry-run");
      flags[value] = true;
    } else if (value.startsWith("--")) {
      if (
        !allowed.has(value) ||
        Object.hasOwn(flags, value) ||
        !argv.length ||
        argv[0].startsWith("--")
      )
        throw new VisualModelError("invalid", `Invalid, repeated or valueless flag: ${value}`);
      flags[value] = argv.shift();
    } else positional.push(value);
  }
  const allowedFor = {
    catalog: [],
    validate: ["--file"],
    list: ["--store"],
    receipt: ["--store"],
    show: ["--store"],
    inspect: ["--store"],
    export: ["--store"],
    create: ["--file", "--store", "--key", "--actor", "--dry-run"],
    edit: ["--file", "--store", "--key", "--actor", "--dry-run"],
    undo: ["--operation", "--store", "--key", "--actor", "--dry-run"],
    fork: ["--as", "--if-rev", "--store", "--key", "--actor", "--dry-run"],
  }[command];
  if (!allowedFor) throw new VisualModelError("invalid", `Unknown command: ${command}`);
  for (const flag of Object.keys(flags))
    if (!allowedFor.includes(flag))
      throw new VisualModelError("invalid", `${flag} does not apply to ${command}`);
  const needsId = ["show", "inspect", "export", "edit", "undo", "fork", "receipt"].includes(
    command,
  );
  if (positional.length !== (needsId ? 1 : 0))
    throw new VisualModelError(
      "invalid",
      needsId ? "Exactly one model ID is required" : "Unexpected positional argument",
    );
  const print = (data) => process.stdout.write(JSON.stringify({ ok: true, ...data }) + "\n");
  if (command === "catalog") {
    print({ renderers: VISUAL_RENDERERS, templates: VISUAL_TEMPLATES });
    return;
  }
  if (command === "validate") {
    const input = await readJson(flags["--file"]);
    if (!input || typeof input !== "object" || !input.content || typeof input.content !== "object")
      throw new VisualModelError("invalid", "Validation needs {renderer, content}");
    const definition = VISUAL_RENDERERS.find((entry) => entry.id === input.renderer);
    if (!definition) throw new VisualModelError("invalid", "Unknown renderer");
    const content = withAuthoredTimes(input.renderer, input.content);
    validateVisualContent(input.renderer, input.modelType ?? definition.modelType, content);
    print({
      valid: true,
      renderer: input.renderer,
      content,
      ...(input.renderer === "vega-lite" ? { guidance: chartEncodingGuidance(content) } : {}),
    });
    return;
  }
  const file = required(flags, "--store");
  const id = positional[0];
  if (command === "list") {
    print({ models: (await readFileStore(file)).list() });
    return;
  }
  if (command === "receipt") {
    const receipt = (await readFileStore(file)).getReceipt(id);
    if (!receipt) throw new VisualModelError("not-found", "Operation receipt not found");
    print({ receipt });
    return;
  }
  if (["show", "inspect", "export"].includes(command)) {
    const model = (await readFileStore(file)).get(id);
    if (!model) throw new VisualModelError("not-found", "Model not found");
    if (command === "inspect")
      print({
        model: modelSummary(model),
        targets: modelTargets(model),
        projection: visualViewProjection(model),
      });
    else print({ model, ...(command === "export" ? { dependenciesIncluded: false } : {}) });
    return;
  }
  const key = required(flags, "--key");
  let request;
  if (command === "create")
    request = { type: "create", key, model: await readJson(flags["--file"]) };
  if (command === "edit")
    request = { type: "edit", key, id, patch: await readJson(flags["--file"]) };
  if (command === "undo")
    request = { type: "undo", key, id, operation: required(flags, "--operation") };
  if (command === "fork") {
    const revision = required(flags, "--if-rev");
    if (!/^[1-9][0-9]*$/.test(revision) || !Number.isSafeInteger(Number(revision)))
      throw new VisualModelError("invalid", "--if-rev must be a positive integer");
    request = {
      type: "fork",
      key,
      id,
      fork: { id: required(flags, "--as"), ifRevision: Number(revision) },
    };
  }
  if (flags["--dry-run"]) {
    const preview = await previewFileCommand(file, request, {
      actor: flags["--actor"] ?? "local-cli",
    });
    print({ dryRun: true, ...preview });
    return;
  }
  const result = await executeFileCommand(file, request, {
    actor: flags["--actor"] ?? "local-cli",
  });
  print(result);
}
main().catch((error) => {
  const code = error instanceof VisualModelError ? error.code : "unavailable";
  const effect = error instanceof FileCommitError ? error.effect : "none";
  const detail = error instanceof VisualModelError ? visualRefusalDetail(error) : undefined;
  const report = error instanceof VisualModelError ? error.report : undefined;
  process.stderr.write(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message: error.message ?? String(error),
        ...(detail ? { detail } : {}),
        ...(report ? { report } : {}),
      },
      effect,
    }) + "\n",
  );
  process.exitCode = exits[code] ?? 6;
});
