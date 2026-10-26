import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkAccessibility } from "./accessibility.mjs";

/** Real packed consumer: named C4 diagrams, controlled writes and recovery. */
export async function testC4Contract(browser, outputDirectory) {
  const out = outputDirectory ? new URL(outputDirectory).pathname : resolve(".tmp/browser");
  await mkdir(out, { recursive: true });
  const origin = "http://127.0.0.1:4181";
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      resolve(".tmp/c4-contract"),
      "--port",
      "4181",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "",
    startupError;
  server.on("error", (error) => {
    startupError = error;
  });
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      log = (log + chunk).slice(-8000);
    });
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  await context.addInitScript(() => {
    const NativeResizeObserver = window.ResizeObserver;
    window.c4HoldNodeMeasurements = false;
    window.c4PaneResizeNotifications = 0;
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback) {
        super((entries, observer) => {
          window.c4PaneResizeNotifications += entries.filter((entry) =>
            entry.target.classList.contains("react-flow__renderer"),
          ).length;
          const visible = entries.filter(
            (entry) =>
              !window.c4HoldNodeMeasurements ||
              !entry.target.classList.contains("react-flow__node"),
          );
          if (visible.length) callback(visible, observer);
        });
      }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [],
    external = [],
    checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith(origin + "/")) external.push(request.url());
  });
  const configure = (patch) => page.evaluate((p) => window.c4Harness.configure(p), patch);
  const snapshot = () => page.evaluate(() => window.c4Harness.snapshot());
  const current = () => page.evaluate(() => window.c4Harness.current());
  const flush = () =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  const diagram = () => page.getByRole("combobox", { name: "Architecture diagram", exact: true });
  const inspect = (id) =>
    page
      .getByRole("combobox", { name: "Inspect architecture element", exact: true })
      .selectOption(id);
  const inspector = () => page.getByRole("complementary", { name: "Architecture inspector" });
  const node = (id) => page.locator(`.react-flow__node[data-id="${id}"]`);
  const position = (view, id) =>
    page.evaluate(({ view, id }) => window.c4Harness.position(view, id), { view, id });
  const focusNode = async (id, editable = true) => {
    // React Flow can temporarily hide/re-measure a controlled node after readonly
    // or pending-write transitions. A fixed frame count is not an interaction barrier.
    await page.waitForFunction(
      ({ id, editable }) => {
        const element = document.querySelector(`.react-flow__node[data-id="${id}"]`);
        return element && element.classList.contains("draggable") === editable;
      },
      { id, editable },
    );
    await node(id).waitFor({ state: "visible" });
    await node(id).focus();
    await page.waitForFunction(
      (id) => document.activeElement?.matches(`.react-flow__node[data-id="${id}"]`),
      id,
    );
  };
  const renderedX = (id) =>
    node(id).evaluate((element) => new DOMMatrixReadOnly(element.style.transform).m41);
  const waitX = (id, x) =>
    page.waitForFunction(
      ({ id, x }) => {
        const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
        return el && Math.abs(new DOMMatrixReadOnly(el.style.transform).m41 - x) < 0.01;
      },
      { id, x },
    );
  const waitRevision = (revision) =>
    page.waitForFunction(
      (revision) =>
        document.querySelector(".bvm-view")?.getAttribute("data-revision") === String(revision),
      revision,
    );
  const screen = (name) =>
    page.screenshot({ path: resolve(out, `c4-${name}.png`), fullPage: true });
  const a11y = async (name) => {
    const report = await checkAccessibility(page, resolve(out, `c4-${name}-accessibility.json`));
    assert.deepEqual(report.violations, [], `${name}: ${JSON.stringify(report.violations)}`);
    return report;
  };
  const fresh = async () => {
    await page.goto(origin, { waitUntil: "networkidle" });
    await node("shop").waitFor();
    await page.waitForFunction(() => window.c4Harness.events.some((e) => e.kind === "ready"));
    await flush();
  };
  try {
    let online = false;
    for (let i = 0; i < 100; i++) {
      if (startupError) throw startupError;
      if (server.exitCode !== null) throw new Error(log);
      try {
        online = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {}
      if (online) break;
      await delay(100);
    }
    assert.ok(online, log);
    await fresh();
    const before = await snapshot();
    assert.equal(await page.locator(".bvm-c4-card").count(), 3);
    assert.equal(await page.locator(".bvm-c4-external").count(), 1);
    assert.equal(await page.locator(".bvm-c4-edge-label").count(), 2);
    await screen("context");
    await a11y("context");
    await inspect("shop");
    await inspector()
      .getByRole("button", { name: /^Open containers:/ })
      .click();
    await node("api").waitFor();
    assert.equal(await diagram().inputValue(), "containers");
    assert.equal(await page.locator(".bvm-c4-boundary").count(), 1);
    assert.equal(await node("api").getByText("Node.js / HTTP", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "Fit architecture", exact: true }).click();
    await screen("containers");
    await inspect("api");
    await inspector()
      .getByRole("button", { name: /^Open components:/ })
      .click();
    await node("checkout").waitFor();
    assert.equal(await diagram().inputValue(), "components");
    assert.equal(await node("api").count(), 0);
    assert.equal(
      await node("checkout").getByText("TypeScript service", { exact: true }).count(),
      1,
    );
    assert.equal(await page.locator(".bvm-c4-card").count(), 5);
    await screen("components");
    assert.deepEqual(await snapshot(), before, "Drill-down must not change the saved architecture");
    checks.push("C1/C2/C3 drill-down, C4 notation and view-only navigation");

    await page
      .getByRole("textbox", { name: "Find in this diagram", exact: true })
      .fill("PostgreSQL");
    assert.equal(
      await page
        .getByRole("combobox", { name: "Inspect architecture element", exact: true })
        .locator("option")
        .count(),
      2,
    );
    assert.equal(
      await page.locator(".bvm-c4-card").count(),
      5,
      "Find must not hide architecture context",
    );
    await inspect("database");
    assert.match(await inspector().innerText(), /Order database/);
    await page.getByRole("textbox", { name: "Find in this diagram", exact: true }).fill("");
    await page
      .getByRole("combobox", { name: "Inspect architecture relationship", exact: true })
      .selectOption("pays");
    assert.match(await inspector().innerText(), /Checkout service.*Payment provider/s);
    assert.equal(
      await inspector().getByRole("textbox", { name: "Technology / protocol" }).inputValue(),
      "HTTPS / JSON",
    );
    assert.deepEqual(await snapshot(), before);
    checks.push("Semantic search retains context; relationship chooser exposes full protocol");

    await inspect("checkout");
    const name = () =>
      inspector().getByRole("textbox", { name: "Name or relationship", exact: true });
    await name().fill("Checkout coordinator");
    await inspector().getByRole("button", { name: "Save details", exact: true }).click();
    await page.waitForFunction(
      () =>
        window.c4Harness.current().content.elements.find((e) => e.id === "checkout").label ===
        "Checkout coordinator",
    );
    await waitRevision(2);
    await name().fill("Unsaved local draft");
    await page.evaluate(() => window.c4Harness.label("checkout", "Concurrent name"));
    await waitRevision(3);
    assert.equal(
      await name().inputValue(),
      "Unsaved local draft",
      "Concurrent revision must not silently replace dirty draft",
    );
    await inspector().getByRole("button", { name: "Save details", exact: true }).click();
    await inspector()
      .getByRole("status")
      .filter({ hasText: /changed since|revision|model changed/i })
      .last()
      .waitFor();
    assert.equal((await current()).revision, 3);
    assert.equal(
      (await current()).content.elements.find((e) => e.id === "checkout").label,
      "Concurrent name",
    );
    await inspector().getByRole("button", { name: "Reload draft", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector(".bvm-c4-inspector input")?.value === "Concurrent name",
    );
    await page.evaluate(() => window.c4Harness.replace("checkout"));
    await waitRevision(4);
    assert.equal(
      await inspector().count(),
      0,
      "Replacement ID must not inherit the removed element's selection",
    );
    checks.push("Guarded detail edits, concurrent draft refusal and incarnation-safe selection");

    await diagram().selectOption("containers");
    await node("api").waitFor();
    const original = await current();
    const originalPosition = await position("containers", "api");
    await focusNode("api");
    await page.keyboard.press("ArrowRight");
    await waitRevision(original.revision + 1);
    await waitX("api", originalPosition.x + 10);
    const moved = await current();
    assert.deepEqual(moved.content.elements, original.content.elements);
    assert.deepEqual(moved.content.relationships, original.content.relationships);
    assert.deepEqual(
      moved.content.views.filter((v) => v.id !== "containers"),
      original.content.views.filter((v) => v.id !== "containers"),
    );
    await focusNode("api");
    await page.keyboard.press("Shift+ArrowRight");
    await waitRevision(original.revision + 2);
    await waitX("api", originalPosition.x + 60);
    await page.evaluate(() => window.c4Harness.undo());
    await waitRevision(original.revision + 3);
    await waitX("api", originalPosition.x + 10);
    checks.push("Keyboard positions belong to one named diagram; undo restores prior layout");

    // Fixed-size cards must not disappear when a browser coalesces size notifications
    // across controlled readonly/permission updates. Keep the actual observer everywhere else.
    await page.evaluate(() => {
      window.c4HoldNodeMeasurements = true;
    });
    await configure({ readOnly: true });
    await flush();
    const readonly = await snapshot(),
      readonlyX = await renderedX("api");
    await focusNode("api", false);
    await page.keyboard.press("ArrowRight");
    await flush();
    assert.deepEqual(await snapshot(), readonly);
    assert.equal(
      await renderedX("api"),
      readonlyX,
      "Read-only keyboard must not drift local geometry",
    );
    await configure({ readOnly: false, mode: "sync" });
    await flush();
    await focusNode("api");
    await page.keyboard.press("ArrowRight");
    await page.getByRole("alert").filter({ hasText: "Synchronous host refusal" }).waitFor();
    await waitX("api", readonlyX);
    assert.deepEqual(await snapshot(), readonly);
    await page.getByRole("button", { name: "Dismiss visual error" }).click();
    await configure({ mode: "async" });
    await flush();
    await focusNode("api");
    await page.keyboard.press("ArrowRight");
    await page.getByRole("alert").filter({ hasText: "Asynchronous host refusal" }).waitFor();
    await waitX("api", readonlyX);
    assert.deepEqual(await snapshot(), readonly);
    await page.getByRole("button", { name: "Dismiss visual error" }).click();
    await configure({ mode: "delayed" });
    await flush();
    await focusNode("api");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => window.c4Harness.waiting());
    await page.evaluate((x) => window.c4Harness.move("containers", "api", x), readonlyX + 90);
    await page.evaluate(() => window.c4Harness.release());
    await page.getByRole("alert").filter({ hasText: "Delayed host refusal" }).waitFor();
    await waitX("api", readonlyX + 90);
    checks.push(
      "Readonly geometry, synchronous/asynchronous refusal and latest-state late recovery",
    );

    await fresh();
    await diagram().selectOption("containers");
    await node("api").waitFor();
    // A real pointer drag, not only the headless layout helper or keyboard pathway.
    await page.getByRole("button", { name: "Fit architecture", exact: true }).click();
    await flush();
    const card = await node("api").boundingBox();
    assert.ok(card);
    const dragBefore = await current();
    await page.mouse.move(card.x + card.width / 2, card.y + 25);
    await page.mouse.down();
    await page.mouse.move(card.x + card.width / 2 + 55, card.y + 50, { steps: 8 });
    await page.mouse.up();
    await waitRevision(dragBefore.revision + 1);
    const dragAfter = await current();
    assert.ok(dragAfter.content.views.find((v) => v.id === "containers").positions?.length);
    assert.deepEqual(dragAfter.content.elements, dragBefore.content.elements);
    await page.getByRole("button", { name: "Reset diagram layout", exact: true }).click();
    await waitRevision(dragBefore.revision + 2);
    assert.deepEqual(
      (await current()).content.views.find((v) => v.id === "containers").positions,
      [],
    );
    checks.push("Pointer drag and explicit reset go through the host's guarded commit");

    await configure({ active: false });
    await flush();
    const hiddenStart = await page.evaluate(() => window.c4Harness.events.length);
    await page.evaluate(() => window.c4Harness.label("api", "Hidden update"));
    await flush();
    assert.equal(await diagram().isDisabled(), true);
    const hiddenEvents = await page.evaluate(
      (from) => window.c4Harness.events.slice(from),
      hiddenStart,
    );
    assert.deepEqual(
      hiddenEvents.filter((e) => ["ready", "error", "edit"].includes(e.kind)),
      [],
    );
    await configure({ active: true });
    await page.waitForFunction(() =>
      window.c4Harness.events.some(
        (e) => e.kind === "ready" && e.revision === window.c4Harness.current().revision && e.active,
      ),
    );
    await configure({ viewId: "absent" });
    await page
      .getByRole("status")
      .filter({ hasText: "C4 diagram absent is unavailable" })
      .waitFor();
    assert.equal(await page.locator(".bvm-c4-card").count(), 0);
    await configure({ viewId: "context", controlNavigation: false });
    await node("shop").waitFor();
    assert.equal(await diagram().isDisabled(), true);
    await inspect("shop");
    assert.equal(
      await inspector()
        .getByRole("button", { name: /^Open containers:/ })
        .isDisabled(),
      true,
    );
    await configure({ controlNavigation: true });
    await flush();
    await inspector()
      .getByRole("button", { name: /^Open containers:/ })
      .click();
    await node("api").waitFor();
    assert.equal(await diagram().inputValue(), "containers");
    checks.push(
      "Inactive views suppress callbacks; controlled unknown diagrams never silently fall back",
    );

    await configure({ viewId: null, controlNavigation: false, readOnly: true });
    await diagram().selectOption("components");
    await node("checkout").waitFor();
    await inspect("checkout");
    await a11y("inspector");
    // Pane and node observers both stay real here. Exercise their delivery while
    // permissions and responsive pane/inspector geometry change together.
    assert.equal(await page.evaluate(() => window.c4HoldNodeMeasurements), false);
    const beforeResize = await snapshot();
    for (const [width, readOnly] of [
      [700, false],
      [420, true],
      [950, false],
      [390, true],
    ]) {
      const observed = await page.evaluate(() => window.c4PaneResizeNotifications);
      await Promise.all([configure({ readOnly }), page.setViewportSize({ width, height: 1000 })]);
      await page.waitForFunction((before) => window.c4PaneResizeNotifications > before, observed);
      await focusNode("checkout", !readOnly);
      await flush();
    }
    assert.deepEqual(
      await snapshot(),
      beforeResize,
      "Resize and editability changes must not write architecture",
    );
    await page.setViewportSize({ width: 390, height: 1000 });
    await flush();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      true,
      "Narrow C4 UI must not overflow the document",
    );
    await page.waitForFunction(() => {
      const canvas = document.querySelector(".bvm-c4-canvas")?.getBoundingClientRect();
      const selected = document
        .querySelector('.react-flow__node[data-id="checkout"]')
        ?.getBoundingClientRect();
      return (
        canvas &&
        selected &&
        selected.left >= canvas.left - 1 &&
        selected.right <= canvas.right + 1 &&
        selected.top >= canvas.top - 1 &&
        selected.bottom <= canvas.bottom + 1
      );
    });
    // The readonly inspector can overflow without containing inputs or buttons.
    // It must itself accept keyboard focus so its complete text remains reachable.
    await inspector().focus();
    await page.waitForFunction(() => document.activeElement?.matches(".bvm-c4-inspector"));
    await screen("narrow");
    await a11y("narrow");
    await page.getByRole("button", { name: "Read data", exact: true }).click();
    await page.locator(".bvm-data").waitFor();
    assert.match(await page.locator(".bvm-data").innerText(), /elements|relationships|views/i);
    await a11y("data");
    checks.push(
      "Concurrent pane resizing and readonly transitions, full-text inspector, semantic data and WCAG-tagged scans",
    );
    assert.deepEqual(errors, [], "C4 page errors");
    assert.deepEqual(external, [], "C4 made an external resource request");
    const result = {
      suite: "C4 architecture",
      passed: true,
      checks,
      pageErrors: errors,
      externalRequests: external,
      paneResizeNotifications: await page.evaluate(() => window.c4PaneResizeNotifications),
    };
    await writeFile(resolve(out, "c4-results.json"), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    await screen("failure").catch(() => {});
    await writeFile(
      resolve(out, "c4-failure.json"),
      JSON.stringify(
        {
          error: String(error),
          checks,
          errors,
          external,
          events: await page.evaluate(() => window.c4Harness?.events).catch(() => []),
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
