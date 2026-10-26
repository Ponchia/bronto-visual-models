import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkAccessibility } from "./accessibility.mjs";

export async function testC4LayoutContract(browser, outputDirectory) {
  const out = outputDirectory ? new URL(outputDirectory).pathname : resolve(".tmp/browser");
  await mkdir(out, { recursive: true });
  const origin = "http://127.0.0.1:4182";
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      resolve(".tmp/c4-layout-contract"),
      "--port",
      "4182",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "",
    serverError;
  server.on("error", (e) => {
    serverError = e;
  });
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (b) => {
      log = (log + b).slice(-8000);
    });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addInitScript(() => {
    const RealWorker = window.Worker;
    window.layoutWorkers = { created: 0, terminated: 0, active: 0 };
    window.Worker = class extends RealWorker {
      constructor(...args) {
        super(...args);
        window.layoutWorkers.created++;
        window.layoutWorkers.active++;
      }
      terminate() {
        window.layoutWorkers.terminated++;
        window.layoutWorkers.active--;
        super.terminate();
      }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [],
    external = [],
    checks = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith(origin + "/") && !/^(blob:|data:)/.test(r.url()))
      external.push(r.url());
  });
  const current = () => page.evaluate(() => window.c4LayoutHarness.current());
  const snapshot = () => page.evaluate(() => window.c4LayoutHarness.snapshot());
  const configure = (p) => page.evaluate((p) => window.c4LayoutHarness.configure(p), p);
  const provider = (value) =>
    page.evaluate((value) => window.c4LayoutHarness.provider(value), value);
  const flush = () =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  const phase = (value) => page.locator(`.bvm-c4[data-c4-layout-state="${value}"]`).waitFor();
  const diagram = () => page.getByRole("combobox", { name: "Architecture diagram", exact: true });
  const preview = async () => {
    await page.getByRole("button", { name: "Preview automatic layout", exact: true }).click();
    await phase("preview");
  };
  const discard = async () => {
    await page.getByRole("button", { name: "Discard layout", exact: true }).click();
    await phase("idle");
  };
  const apply = async () => {
    const before = (await current()).revision;
    await page.getByRole("button", { name: "Apply layout", exact: true }).click();
    await page.waitForFunction(
      (revision) => window.c4LayoutHarness.current().revision === revision,
      before + 1,
    );
    await phase("idle");
  };
  const screen = (name) =>
    page.screenshot({ path: resolve(out, `c4-layout-${name}.png`), fullPage: true });
  const actualPositions = () =>
    page
      .locator(".react-flow__node:not([data-id^=':'])")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({ id: n.dataset.id, transform: n.style.transform })),
      );
  const waitWorkers = () =>
    page.waitForFunction(
      () =>
        window.layoutWorkers.active === 0 &&
        window.layoutWorkers.created === window.layoutWorkers.terminated,
    );
  const cleanLabels = async () => {
    const overlaps = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll(".bvm-c4-card")].map((e) =>
        e.getBoundingClientRect(),
      );
      const labels = [...document.querySelectorAll(".bvm-c4-edge-label")].map((e) =>
        e.getBoundingClientRect(),
      );
      const overlap = (a, b) =>
        a.left < b.right - 0.5 &&
        a.right > b.left + 0.5 &&
        a.top < b.bottom - 0.5 &&
        a.bottom > b.top + 0.5;
      return labels.flatMap((a, i) =>
        [...boxes, ...labels.slice(i + 1)].filter((b) => overlap(a, b)),
      );
    });
    assert.equal(overlaps.length, 0, "Routed relationship labels overlap cards or other labels");
  };
  const a11y = async (name) => {
    const result = await checkAccessibility(
      page,
      resolve(out, `c4-layout-${name}-accessibility.json`),
    );
    assert.deepEqual(result.violations, [], JSON.stringify(result.violations));
  };
  const fresh = async () => {
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.waitForFunction(() =>
      window.c4LayoutHarness?.events.some((e) => e.kind === "ready"),
    );
    await phase("idle");
    await flush();
  };
  try {
    let online = false;
    for (let i = 0; i < 100; i++) {
      if (serverError) throw serverError;
      if (server.exitCode !== null) throw new Error(log);
      try {
        online = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {}
      if (online) break;
      await delay(100);
    }
    assert.ok(online, log);
    await fresh();
    const original = await snapshot(),
      positions = await actualPositions();
    await preview();
    await waitWorkers();
    assert.deepEqual(await snapshot(), original, "Preview wrote the store");
    assert.equal(await page.locator('[data-c4-route="computed"]').count(), 2);
    await cleanLabels();
    await page
      .getByRole("combobox", { name: "Inspect architecture element", exact: true })
      .selectOption("shop");
    await page.getByRole("complementary", { name: "Architecture inspector" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Save details", exact: true }).count(),
      0,
      "Preview must not expose a writable inspector",
    );
    await screen("context-preview");
    await a11y("preview");
    assert.equal(
      await page.evaluate(() =>
        window.c4LayoutHarness.events.some((e) => e.kind === "ready" && e.revision > 1),
      ),
      false,
      "Preview falsely acknowledged a committed revision",
    );
    await discard();
    assert.deepEqual(await snapshot(), original);
    await flush();
    assert.deepEqual(
      await actualPositions(),
      positions,
      "Discard did not restore authored geometry",
    );
    checks.push("Real worker preview/discard leaves model, receipts and identity unchanged");

    await diagram().selectOption("containers");
    await page.locator('.react-flow__node[data-id="api"]').waitFor();
    await preview();
    await cleanLabels();
    await screen("containers-preview");
    const overviewSnapshot = await snapshot();
    await page.getByRole("button", { name: "Read at 100%", exact: true }).click();
    await page.waitForFunction(
      () =>
        Math.abs(
          document.querySelector('.react-flow__node[data-id="api"]').getBoundingClientRect().width -
            260,
        ) < 1,
    );
    assert.deepEqual(await snapshot(), overviewSnapshot, "Readable scale changed the architecture");
    await screen("containers-readable");
    await page.getByRole("button", { name: "Fit architecture", exact: true }).click();
    await flush();
    assert.equal(await page.locator(".bvm-c4-boundary").count(), 1);
    const before = await current();
    await apply();
    await waitWorkers();
    const saved = await current();
    assert.deepEqual(saved.content.elements, before.content.elements);
    assert.deepEqual(saved.content.relationships, before.content.relationships);
    assert.deepEqual(
      saved.content.views.filter((v) => v.id !== "containers"),
      before.content.views.filter((v) => v.id !== "containers"),
    );
    assert.deepEqual(saved.elementIncarnations, before.elementIncarnations);
    assert.equal(await page.locator('.bvm-c4[data-c4-routing-state="current"]').count(), 1);
    assert.equal(
      await page.evaluate(
        () => window.c4LayoutHarness.events.filter((e) => e.kind === "edit").length,
      ),
      1,
    );
    await page.evaluate(() => window.c4LayoutHarness.undo());
    await flush();
    await phase("idle");
    assert.deepEqual((await current()).content, before.content);
    assert.equal(
      await page.locator('[data-c4-route="computed"]').count(),
      0,
      "Undo retained stale route geometry",
    );
    checks.push("Apply is one guarded host write to one diagram; undo invalidates derived routing");

    await preview();
    await page.evaluate(() => window.c4LayoutHarness.rename("New architecture title"));
    await phase("idle");
    assert.equal(await page.getByRole("button", { name: "Apply layout", exact: true }).count(), 0);
    assert.equal(await page.locator('[data-c4-route="computed"]').count(), 0);
    await preview();
    const withoutNavigation = await snapshot();
    await diagram().selectOption("components");
    await phase("idle");
    assert.deepEqual(await snapshot(), withoutNavigation);
    assert.equal(await page.getByRole("button", { name: "Apply layout", exact: true }).count(), 0);
    await page
      .getByRole("combobox", { name: "Layout direction", exact: true })
      .selectOption("DOWN");
    await preview();
    await cleanLabels();
    await screen("components-down-preview");
    await discard();
    checks.push(
      "Changed source or diagram discards previews; both layout directions preserve scoped boundaries",
    );

    await provider("delay");
    const noWrites = await snapshot();
    await page.getByRole("button", { name: "Preview automatic layout", exact: true }).click();
    await page.waitForFunction(() => window.c4LayoutHarness.waiting());
    await page.getByRole("button", { name: "Cancel layout", exact: true }).click();
    await phase("idle");
    await page.evaluate(() => window.c4LayoutHarness.release());
    await flush();
    assert.deepEqual(await snapshot(), noWrites);
    assert.equal(await page.getByRole("button", { name: "Apply layout", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Preview automatic layout", exact: true }).click();
    await page.waitForFunction(() => window.c4LayoutHarness.waiting());
    await configure({ active: false });
    await flush();
    const from = await page.evaluate(() => window.c4LayoutHarness.events.length);
    await page.evaluate(() => window.c4LayoutHarness.release());
    await flush();
    assert.deepEqual(
      (await page.evaluate((from) => window.c4LayoutHarness.events.slice(from), from)).filter((e) =>
        ["edit", "ready", "error"].includes(e.kind),
      ),
      [],
    );
    await configure({ active: true });
    await phase("idle");
    assert.deepEqual(await snapshot(), noWrites);
    checks.push(
      "Cancelled and hidden late results cannot become a preview, host callback or saved edit",
    );

    await provider("malformed");
    await page.getByRole("button", { name: "Preview automatic layout", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "may only update" }).waitFor();
    assert.deepEqual(await snapshot(), noWrites);
    await provider("wrong-view");
    await page.getByRole("button", { name: "Preview automatic layout", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "different architecture diagram" }).waitFor();
    assert.deepEqual(await snapshot(), noWrites);
    await provider("error");
    await page.getByRole("button", { name: "Preview automatic layout", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "provider refused" }).waitFor();
    assert.deepEqual(await snapshot(), noWrites);
    await provider("real");
    for (const mode of ["sync", "async"]) {
      await configure({ editMode: mode });
      await preview();
      const before = await snapshot();
      await page.getByRole("button", { name: "Apply layout", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Host refused layout" }).waitFor();
      await phase("idle");
      assert.deepEqual(await snapshot(), before);
    }
    await configure({ readOnly: true });
    await flush();
    assert.equal(
      await page
        .getByRole("button", { name: "Preview automatic layout", exact: true })
        .isDisabled(),
      true,
    );
    checks.push(
      "Malformed/wrong-scope proposals and synchronous/asynchronous host refusals do not write; readonly controls stay disabled",
    );

    await configure({ readOnly: false, editMode: "accept" });
    await preview();
    await apply();
    const node = page.locator('.react-flow__node[data-id="checkout"]');
    await page.waitForFunction(() =>
      document
        .querySelector('.react-flow__node[data-id="checkout"]')
        ?.classList.contains("draggable"),
    );
    await node.waitFor({ state: "visible" });
    await node.focus();
    await page.waitForFunction(() =>
      document.activeElement?.matches('.react-flow__node[data-id="checkout"]'),
    );
    const revision = (await current()).revision;
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      (r) => window.c4LayoutHarness.current().revision === r,
      revision + 1,
    );
    assert.equal(
      await page.locator('[data-c4-route="computed"]').count(),
      0,
      "Manual movement must invalidate derived routes",
    );
    await preview();
    await page.setViewportSize({ width: 390, height: 1100 });
    await flush();
    await page.getByRole("button", { name: "Fit architecture", exact: true }).click();
    await flush();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await page
      .getByRole("combobox", { name: "Inspect architecture element", exact: true })
      .selectOption("checkout");
    const inspector = page.getByRole("complementary", { name: "Architecture inspector" });
    await inspector.focus();
    await page.waitForFunction(() => document.activeElement?.matches(".bvm-c4-inspector"));
    await screen("narrow-preview");
    await a11y("narrow-preview");
    await discard();
    await provider("delay");
    const beforeUnmount = await snapshot();
    await page.getByRole("button", { name: "Preview automatic layout", exact: true }).click();
    await page.waitForFunction(() => window.c4LayoutHarness.waiting());
    await configure({ mounted: false });
    await page.locator(".bvm-c4").waitFor({ state: "detached" });
    const unmountEvents = await page.evaluate(() => window.c4LayoutHarness.events.length);
    await page.evaluate(() => window.c4LayoutHarness.release());
    await flush();
    assert.deepEqual(await snapshot(), beforeUnmount);
    assert.deepEqual(
      (
        await page.evaluate((from) => window.c4LayoutHarness.events.slice(from), unmountEvents)
      ).filter((e) => ["edit", "error", "ready"].includes(e.kind)),
      [],
    );
    await waitWorkers();
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    const workers = await page.evaluate(() => window.layoutWorkers);
    assert.ok(workers.created > 0);
    assert.equal(workers.created, workers.terminated);
    checks.push(
      "Manual moves invalidate routes; narrow preview remains accessible; workers terminate exactly once with no external requests",
    );
    const result = {
      suite: "C4 automatic layout",
      passed: true,
      checks,
      workers,
      pageErrors: errors,
      externalRequests: external,
    };
    await writeFile(resolve(out, "c4-layout-results.json"), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    await screen("failure").catch(() => {});
    await writeFile(
      resolve(out, "c4-layout-failure.json"),
      JSON.stringify(
        {
          error: String(error),
          checks,
          errors,
          external,
          events: await page.evaluate(() => window.c4LayoutHarness?.events).catch(() => []),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await context.close();
    server.kill("SIGTERM");
  }
}
