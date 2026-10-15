import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Controlled promise barriers over a real packed Vega hook: no timing sleeps in the assertions. */
export async function testSurfaceContract(browser, outputDirectory) {
  const out = outputDirectory ? new URL(outputDirectory).pathname : resolve(".tmp/browser");
  await mkdir(out, { recursive: true });
  const origin = "http://127.0.0.1:4177";
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      resolve(".tmp/surface-contract"),
      "--port",
      "4177",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "",
    failure;
  server.on("error", (e) => (failure = e));
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (b) => (log = (log + b).slice(-8000)));
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [],
    external = [],
    results = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) => {
    if (!request.url().startsWith(origin + "/")) external.push(request.url());
  });
  const configure = (patch) => page.evaluate((p) => window.surfaceHarness.configure(p), patch);
  const arm = (point = "settle", reject = false) =>
    page.evaluate(({ point, reject }) => window.surfaceHarness.arm(point, reject), {
      point,
      reject,
    });
  const waiting = () => page.waitForFunction(() => window.surfaceHarness.waiting());
  const ready = (revision) =>
    page.waitForFunction(
      (r) => window.surfaceHarness.events.some((e) => e.kind === "ready" && e.revision === r),
      revision,
    );
  const events = () => page.evaluate(() => window.surfaceHarness.events);
  const flush = () =>
    page.evaluate(async () => {
      await window.surfaceHarness.idle();
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
  const release = async () => {
    await page.evaluate(() => window.surfaceHarness.release());
    await flush();
  };
  const fresh = async () => {
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.surfaceHarness);
  };
  const boot = async () => {
    await fresh();
    await configure({ mounted: true });
    await ready(1);
    await flush();
  };
  const absent = async (revision) =>
    assert.ok(
      !(await events()).some((e) => e.kind === "ready" && e.revision === revision),
      `Undrawn/withdrawn revision ${revision} was acknowledged`,
    );
  const check = async (name, work) => {
    try {
      await work();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: String(error), events: await events() });
      await page.screenshot({ path: resolve(out, `surface-${name}-failure.png`) });
    }
  };
  try {
    let online = false;
    for (let i = 0; i < 100; i++) {
      if (failure) throw failure;
      if (server.exitCode !== null) throw new Error(log);
      try {
        online = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {}
      if (online) break;
      await delay(100);
    }
    assert.ok(online, log);
    await check("withdrawn-readiness", async () => {
      await boot();
      await arm();
      await configure({ revision: 2, value: 2 });
      await waiting();
      await configure({ ready: false });
      await release();
      await page.evaluate(() => window.surfaceHarness.attest());
      await absent(2);
      await configure({ ready: true });
      await ready(2);
      assert.ok(
        (await events())
          .filter((e) => e.kind === "ready" && e.revision === 2)
          .every((e) => e.value === 2),
      );
    });
    await check("hidden-inflight-update", async () => {
      await boot();
      await arm();
      await configure({ revision: 2, value: 2 });
      await waiting();
      await configure({ active: false });
      await release();
      await absent(2);
      assert.deepEqual(
        (await events()).filter((e) => ["drawn", "ready", "error"].includes(e.kind) && !e.active),
        [],
        "Hidden work invoked a host callback",
      );
      // The same hidden revision must be observable on resume before readiness.
      await configure({ active: true });
      await ready(2);
      assert.ok(
        (await events())
          .filter((e) => e.kind === "ready" && e.revision === 2)
          .every((e) => e.value === 2),
      );
      await configure({ active: false });
      await configure({ revision: 3, value: 3 });
      await flush();
      await absent(3);
      await configure({ active: true });
      await ready(3);
      assert.equal(
        (await events()).filter((e) => e.kind === "create").length,
        1,
        "Healthy retained engine was recreated",
      );
      assert.ok(
        (await events())
          .filter((e) => e.kind === "ready" && e.revision === 3)
          .every((e) => e.value === 3),
      );
    });
    await check("unmount-inflight-update", async () => {
      await boot();
      await arm();
      await configure({ revision: 2, value: 2 });
      await waiting();
      await configure({ mounted: false });
      await release();
      await page.waitForFunction(() =>
        window.surfaceHarness.events.some((e) => e.kind === "release"),
      );
      await flush();
      await page.evaluate(() => window.surfaceHarness.attest());
      await absent(2);
      const trace = await events();
      assert.deepEqual(
        trace.filter((e) => ["drawn", "ready", "error"].includes(e.kind) && !e.mounted),
        [],
        "Disposed work invoked a host callback",
      );
      for (const kind of ["acquire", "release", "finalize"])
        assert.equal(trace.filter((e) => e.kind === kind).length, 1, kind);
    });
    await check("hidden-first-frame", async () => {
      await fresh();
      await arm("run");
      await configure({ mounted: true });
      await waiting();
      await configure({ active: false, revision: 2, value: 2 });
      await release();
      await absent(1);
      await absent(2);
      await configure({ active: true, revision: 3, value: 3 });
      await ready(3);
      assert.ok(
        (await events())
          .filter((e) => e.kind === "ready")
          .every((e) => e.revision === 3 && e.value === 3),
      );
    });
    await check("superseded-failure", async () => {
      await boot();
      await arm("settle", true);
      await configure({ revision: 2, value: 2 });
      await waiting();
      await configure({ revision: 3, value: 3 });
      await release();
      await ready(3);
      await absent(2);
      const trace = await events();
      assert.ok(
        trace.filter((e) => e.kind === "ready" && e.revision === 3).every((e) => e.value === 3),
      );
      assert.deepEqual(
        trace.filter((e) => e.kind === "error"),
        [],
        "Superseded failure was attributed to current data",
      );
      assert.equal(
        trace.filter((e) => e.kind === "create").length,
        2,
        "Failed superseded engine was reused",
      );
    });
    await check("timeline-inactive-and-disposed", async () => {
      await fresh();
      await configure({ mounted: true, engine: "timeline" });
      await ready(1);
      await flush();
      await configure({ ready: false });
      const withdrawn = (await events()).filter((e) => e.kind === "ready").length;
      await page.evaluate(() => window.surfaceHarness.redrawTimeline());
      await flush();
      assert.equal((await events()).filter((e) => e.kind === "ready").length, withdrawn);
      await configure({ active: false });
      const start = (await events()).length;
      const before = await page.evaluate(() => window.surfaceHarness.timelineWindow());
      await page.evaluate(() => {
        window.surfaceHarness.redrawTimeline();
        window.surfaceHarness.navigateTimeline();
      });
      await flush();
      assert.deepEqual(
        (await events())
          .slice(start)
          .filter((e) => ["changed", "ready", "window", "select"].includes(e.kind)),
        [],
        "Inactive timeline invoked host callbacks",
      );
      assert.deepEqual(
        await page.evaluate(() => window.surfaceHarness.timelineWindow()),
        before,
        "Inactive toolbar moved the timeline",
      );
      await configure({ active: true, ready: true, revision: 2, value: 2 });
      await ready(2);
      await flush();
      await configure({ mounted: false });
      await flush();
      await page.evaluate(() => window.surfaceHarness.navigateTimeline());
      await flush();
      const trace = await events();
      assert.deepEqual(
        trace.filter(
          (e) => ["changed", "ready", "window", "select"].includes(e.kind) && !e.mounted,
        ),
        [],
        "Disposed timeline invoked host callbacks",
      );
      assert.equal(trace.filter((e) => e.kind === "acquire").length, 1);
      assert.equal(trace.filter((e) => e.kind === "release").length, 1);
    });
    await writeFile(
      resolve(out, "surface-lifecycle.json"),
      JSON.stringify({ results, errors, external }, null, 2),
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.deepEqual(
      results.filter((r) => !r.passed),
      [],
      "Controlled surface lifecycle regressions",
    );
    await configure({
      mounted: true,
      engine: "vega",
      active: true,
      ready: true,
      revision: 4,
      value: 4,
    });
    await ready(4);
    await page.screenshot({ path: resolve(out, "surface-lifecycle.png") });
    return { device: "surface-contract", passed: true, assertions: results.map((r) => r.name) };
  } finally {
    await page.close();
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await Promise.race([exited, delay(2000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}
