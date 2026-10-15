#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { createModel, MemoryModelStore } from "../src/index.ts";

const ITERATIONS = 60;
const WARMUP = 20;
const ROUNDS = 3;
const COUNTS = [1, 32, 128];
const actor = { actor: "benchmark", at: "2026-10-15T10:00:00Z" };

// Synthetic unrelated models isolate the growth of the store from the cost of
// editing one model. Seeding and snapshot serialization are outside timing.
function makeStore(count) {
  const models = Array.from({ length: count }, (_, n) =>
    createModel(
      {
        id: `example-${n}`,
        title: `Example ${n}`,
        description: "Synthetic placeholder. ".repeat(90),
        renderer: "diagram",
        content: { nodes: [{ id: "entry", label: "Entry", x: 0, y: 0 }], edges: [] },
      },
      actor,
    ),
  );
  return new MemoryModelStore({
    maxModels: 256,
    initial: { version: 1, models, receipts: [], inverses: [] },
  });
}
async function measure(count) {
  const store = makeStore(count);
  const edit = async (n) =>
    store.execute(
      {
        type: "edit",
        key: `rename-${n}`,
        id: "example-0",
        patch: { title: `Small title edit ${String(n).padStart(3, "0")}` },
      },
      actor,
    );
  for (let n = 0; n < WARMUP; n++) await edit(n);
  const start = performance.now();
  for (let n = WARMUP; n < WARMUP + ITERATIONS; n++) await edit(n);
  const duration = performance.now() - start;
  return {
    millisecondsPerEdit: duration / ITERATIONS,
    snapshotBytes: new TextEncoder().encode(JSON.stringify(store.snapshot())).byteLength,
  };
}
const samples = new Map(COUNTS.map((count) => [count, []]));
for (let round = 0; round < ROUNDS; round++) {
  // Rotate order to avoid reporting Node's warm-up as scaling with model count.
  for (let offset = 0; offset < COUNTS.length; offset++) {
    const count = COUNTS[(round + offset) % COUNTS.length];
    samples.get(count).push(await measure(count));
  }
}
const cases = COUNTS.map((count) => {
  const trials = samples.get(count);
  const timings = trials.map((trial) => trial.millisecondsPerEdit).sort((a, b) => a - b);
  return {
    models: count,
    editsPerTrial: ITERATIONS,
    rounds: ROUNDS,
    snapshotBytes: trials[0].snapshotBytes,
    medianMillisecondsPerEdit: Number(timings[Math.floor(ROUNDS / 2)].toFixed(3)),
    samplesMillisecondsPerEdit: trials.map((trial) => Number(trial.millisecondsPerEdit.toFixed(3))),
  };
});
console.log(JSON.stringify({ benchmark: "store-small-edits", cases }, null, 2));
