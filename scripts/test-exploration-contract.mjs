import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
export async function testExplorationContract(browser, outputDirectory) {
  const out = outputDirectory ? new URL(outputDirectory).pathname : resolve(".tmp/browser");
  await mkdir(out, { recursive: true });
  const origin = "http://127.0.0.1:4178";
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      resolve(".tmp/exploration-contract"),
      "--port",
      "4178",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "",
    failure;
  server.on("error", (e) => (failure = e));
  for (const s of [server.stdout, server.stderr])
    s.on("data", (b) => (log = (log + b).slice(-8000)));
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith(origin + "/") && !r.url().startsWith("data:")) external.push(r.url());
  });
  const ready = () =>
    page.waitForFunction(() => {
      const v = document.querySelector(".bvm-view");
      return (
        v &&
        window.exploration.events.some(
          (e) =>
            e.kind === "ready" &&
            e.id === v.dataset.modelId &&
            String(e.revision) === v.dataset.revision,
        )
      );
    });
  const scan = async (name) => {
    const report = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    await writeFile(resolve(out, `${name}-axe.json`), JSON.stringify(report, null, 2));
    assert.deepEqual(report.violations, [], name + " accessibility");
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
    await page.goto(origin, { waitUntil: "networkidle" });
    await ready();
    await page.locator(".react-flow__node").first().waitFor();
    // A real controlled selection must not rebuild the immutable graph geometry.
    await page.evaluate(() => window.exploration.select("node-000"));
    await page.evaluate(() => window.exploration.select("node-001"));
    await page.evaluate(() => window.exploration.resetReads());
    for (let i = 2; i < 12; i++) {
      const id = `node-${String(i).padStart(3, "0")}`;
      await page.evaluate((id) => window.exploration.select(id), id);
      await page.locator(`.react-flow__node[data-id="${id}"].selected`).waitFor();
    }
    assert.equal(
      await page.evaluate(() => window.exploration.reads()),
      0,
      "Selection reread source coordinates/ports",
    );
    await page.getByText("Find & focus", { exact: true }).click();
    const camera = await page.locator(".react-flow__viewport").getAttribute("style");
    await page.getByLabel("Find graph element", { exact: true }).fill("Parallel contract");
    assert.equal(
      await page.locator(".react-flow__viewport").getAttribute("style"),
      camera,
      "Typing moved the camera",
    );
    assert.equal(await page.locator(".react-flow__node").count(), 60, "Find hid unrelated nodes");
    await page.getByRole("button", { name: "Reveal element", exact: true }).press("Enter");
    await page.getByTestId("selected").filter({ hasText: "edges:node-000" }).waitFor();
    assert.equal(await page.getByTestId("revision").textContent(), "1");
    await page.getByLabel("Find graph element", { exact: true }).fill("no possible match");
    assert.equal(
      await page.getByRole("button", { name: "Reveal element", exact: true }).isDisabled(),
      true,
    );
    await page.getByLabel("Find graph element", { exact: true }).fill("Component 001");
    await page.getByRole("button", { name: "Reveal element", exact: true }).click();
    await page.getByTestId("selected").filter({ hasText: "nodes:node-059" }).waitFor();
    await page.waitForFunction(() => {
      const node = document
          .querySelector('.react-flow__node[data-id="node-059"]')
          .getBoundingClientRect(),
        view = document.querySelector(".bvm-graph-canvas").getBoundingClientRect();
      return (
        node.width > 0 &&
        node.left >= view.left &&
        node.right <= view.right &&
        node.top >= view.top &&
        node.bottom <= view.bottom
      );
    });
    await scan("exploration-graph");
    await page.screenshot({ path: resolve(out, "exploration-graph.png"), fullPage: true });
    await page.getByRole("button", { name: "Matrix", exact: true }).click();
    await page.locator(".bvm-matrix svg").waitFor();
    const svg = await page.locator(".bvm-matrix svg").elementHandle();
    await page.getByLabel("Matrix relationship", { exact: true }).selectOption("node-000");
    await page.waitForFunction(() => {
      const paths = [...document.querySelectorAll(".bvm-matrix .relationships path")];
      return (
        paths.some((p) => p.getAttribute("fill-opacity") === "0.3") &&
        paths.some((p) => p.getAttribute("fill-opacity") === "1")
      );
    });
    await page.getByLabel("Matrix relationship", { exact: true }).selectOption("");
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".bvm-matrix .relationships path")].every(
        (p) => p.getAttribute("fill-opacity") === "1",
      ),
    );
    // The first cell represents two different relationships: do not choose one implicitly.
    await page.locator(".bvm-matrix .relationships path").first().click();
    const chooser = page.getByRole("region", { name: "Relationships in selected matrix cell" });
    await chooser.waitFor();
    assert.equal(await page.getByTestId("selected").textContent(), "none");
    await chooser
      .getByRole("button", { name: "Parallel contract · node-000", exact: true })
      .click();
    await page.getByTestId("selected").filter({ hasText: "edges:node-000" }).waitFor();
    await chooser.getByRole("button", { name: "Close relationship choices", exact: true }).click();
    await page.getByText("Explore matrix", { exact: true }).click();
    await page.getByLabel("Matrix order", { exact: true }).selectOption("label");
    await page.waitForFunction(
      () => document.querySelector(".bvm-matrix .sources text")?.textContent === "Component 001",
    );
    assert.ok(
      await svg.evaluate((n) => n.isConnected),
      "Changing matrix order recreated the engine",
    );
    await page.getByLabel("Filter matrix nodes", { exact: true }).fill("Component 002");
    await page.waitForFunction(
      () => document.querySelectorAll(".bvm-matrix .sources text").length === 1,
    );
    assert.ok(await svg.evaluate((n) => n.isConnected), "Filtering recompiled the matrix");
    await page.getByLabel("Filter matrix nodes", { exact: true }).fill("not-found");
    await page
      .getByText("No matching nodes. Clear the filter to restore the complete matrix.")
      .waitFor();
    await page.getByRole("button", { name: "Reset matrix view", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".bvm-matrix .sources text").length === 60,
    );
    assert.equal(await page.getByTestId("revision").textContent(), "1");
    await scan("exploration-matrix");
    await page.screenshot({ path: resolve(out, "exploration-matrix.png"), fullPage: true });
    await page.getByRole("button", { name: "Wide chart", exact: true }).click();
    await ready();
    await page.locator(".bvm-chart canvas").waitFor();
    await page.getByRole("button", { name: "Data table", exact: true }).click();
    assert.equal(await page.locator(".bvm-chart thead th").count(), 41);
    assert.equal(await page.locator(".bvm-chart tbody tr").count(), 25);
    await page.getByRole("button", { name: "Next rows", exact: true }).click();
    await page.getByRole("button", { name: "Next columns", exact: true }).click();
    assert.equal(await page.locator(".bvm-chart thead th").count(), 6);
    assert.equal(await page.locator(".bvm-chart tbody tr").count(), 6);
    const full = page.getByLabel("Full value, row 26, column column-44", { exact: true });
    await full.focus();
    await page.keyboard.press("Enter");
    const value = page.getByLabel("Complete value, row 26, column column-44", { exact: true });
    await value.waitFor();
    assert.equal(
      await value.textContent(),
      await page.evaluate(() => window.exploration.longValue),
    );
    assert.equal(await page.locator(".bvm-chart-data img").count(), 0);
    assert.equal(await page.getByTestId("revision").textContent(), "1");
    await page.setViewportSize({ width: 390, height: 844 });
    await scan("exploration-data");
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "Wide table caused document overflow",
    );
    await page.screenshot({ path: resolve(out, "exploration-data-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "Shrink chart data", exact: true }).click();
    await page.getByTestId("revision").filter({ hasText: "2" }).waitFor();
    assert.equal(await page.locator(".bvm-chart tbody tr").count(), 1);
    assert.equal(await page.locator(".bvm-chart thead th").count(), 3);
    assert.equal(
      await page.getByRole("button", { name: "Previous rows", exact: true }).isDisabled(),
      true,
    );
    assert.equal(await page.getByRole("button", { name: "Next columns", exact: true }).count(), 0);
    assert.equal(
      await page.evaluate(() => window.exploration.source()),
      await page.evaluate(() => window.exploration.original),
      "View interactions modified graph source",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    return {
      device: "exploration-contract",
      passed: true,
      assertions: [
        "selection does not reread graph geometry",
        "find never removes nodes or moves the camera while typing",
        "explicit reveal supports nodes and namespaced edges",
        "selection redraws matrix without data or viewport changes",
        "parallel-cell choice preserves explicit relationship identities",
        "matrix filtering/order retain the compiled view",
        "all chart columns reachable in bounded pages",
        "keyboard-accessible complete inert cell text",
        "row/column clamping and narrow-screen fit",
        "original graph content and revision unchanged",
      ],
    };
  } catch (e) {
    await page.screenshot({ path: resolve(out, "exploration-failure.png"), fullPage: true });
    await writeFile(resolve(out, "exploration-failure.html"), await page.content());
    await writeFile(
      resolve(out, "exploration-errors.json"),
      JSON.stringify({ errors, external }, null, 2),
    );
    throw e;
  } finally {
    await context.close();
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await Promise.race([exited, delay(2000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}
