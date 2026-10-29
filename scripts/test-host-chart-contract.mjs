import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkAccessibility } from "./accessibility.mjs";

/** A clean consumer of the packed archive, not a Vite source alias or Spatial. */
export async function testHostChartContract(browser, directory) {
  const output = directory ? new URL(directory).pathname : resolve(".tmp/browser");
  await mkdir(output, { recursive: true });
  const origin = "http://127.0.0.1:4186";
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      resolve(".tmp/host-chart-contract"),
      "--port",
      "4186",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      log = (log + chunk).slice(-12000);
    });
  const context = await browser.newContext({ viewport: { width: 1080, height: 850 } });
  const page = await context.newPage();
  const errors = [],
    external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith(origin + "/")) external.push(request.url());
  });
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      window.hostChartPageErrors ??= [];
      window.hostChartPageErrors.push(event.violatedDirective);
    });
  });
  page.setDefaultTimeout(15000);
  const dataReady = (revision) =>
    page.getByTestId("ready-source").filter({ hasText: revision }).waitFor();
  try {
    let online = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error("Host chart server ended: " + log);
      try {
        online = (await fetch(origin, { signal: AbortSignal.timeout(900) })).ok;
      } catch {}
      if (online) break;
      await delay(100);
    }
    assert(online, log);
    await page.goto(origin, { waitUntil: "networkidle" });
    await dataReady("snapshot-1");
    const firstDigest = await page.getByTestId("ready-digest").textContent();
    assert.match(firstDigest, /^[a-f0-9]{64}$/);
    assert.equal(await page.getByTestId("model-revision").textContent(), "1");
    assert.ok(!(await page.getByTestId("saved-content").textContent()).includes("Orders"));
    const graph = page.locator(".bvm-chart canvas");
    await graph.waitFor();
    const canvasBefore = await graph.evaluate((canvas) => {
      const values = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      return values.reduce((sum, byte) => (Math.imul(sum, 31) + byte) >>> 0, 0);
    });
    await page.getByRole("button", { name: "Refresh resolved rows" }).click();
    await dataReady("snapshot-2");
    assert.notEqual(await page.getByTestId("ready-digest").textContent(), firstDigest);
    assert.equal(await page.getByTestId("model-revision").textContent(), "1");
    const canvasAfter = await graph.evaluate((canvas) => {
      const values = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      return values.reduce((sum, byte) => (Math.imul(sum, 31) + byte) >>> 0, 0);
    });
    assert.notEqual(canvasAfter, canvasBefore, "Data refreshed without a new chart frame");
    await page.getByRole("button", { name: "Data table" }).click();
    const table = page.getByRole("table");
    await table.waitFor();
    assert.match(await table.textContent(), /87/);
    assert.doesNotMatch(await table.textContent(), /14/);
    assert.ok((await table.textContent()).includes('<img src="https://example.invalid/tracker">'));
    assert.equal(await table.locator("img").count(), 0, "Host row text became markup");
    assert.match(await page.getByText("2 host-resolved rows").textContent(), /host-resolved/);
    await page.getByRole("button", { name: "Chart", exact: true }).click();
    await page.getByRole("button", { name: "Invalid host rows" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByTestId("ready-source").textContent(), "snapshot-2");
    await page.getByRole("button", { name: "Restore valid host rows" }).click();
    await dataReady("snapshot-4");
    await page.waitForFunction(() => document.querySelectorAll('[role="alert"]').length === 0);
    await page.getByRole("button", { name: "Wrong source key" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByTestId("ready-source").textContent(), "snapshot-4");
    await page.getByRole("button", { name: "Resolve current source" }).click();
    await dataReady("snapshot-6");
    await page.getByRole("button", { name: "Change source binding" }).click();
    await page.getByTestId("model-revision").filter({ hasText: "2" }).waitFor();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByTestId("ready-source").textContent(), "snapshot-6");
    await page.getByRole("button", { name: "Resolve current source" }).click();
    assert.equal(await page.getByTestId("data-revision").textContent(), "snapshot-6");
    await page.getByTestId("ready-model").filter({ hasText: "2" }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[role="alert"]').length === 0);
    await page.getByRole("button", { name: "Remove host snapshot" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByTestId("ready-model").textContent(), "2");
    await page.getByRole("button", { name: "Restore host snapshot" }).click();
    await page.waitForFunction(() => document.querySelectorAll('[role="alert"]').length === 0);
    await page.getByLabel("Unrelated host field").fill("untouched by chart");
    assert.equal(await page.getByLabel("Unrelated host field").inputValue(), "untouched by chart");
    assert.ok(
      !(await page.getByTestId("error-messages").textContent()).includes(
        "CONFIDENTIAL-NEVER-REPORT",
      ),
    );
    assert.ok(!(await page.getByTestId("saved-content").textContent()).includes("Orders"));
    assert.deepEqual(errors, [], "Page threw while presenting host rows");
    assert.deepEqual(external, [], "The view fetched a resource outside the packed application");
    assert.deepEqual(
      await page.evaluate(() => window.hostChartPageErrors ?? []),
      [],
      "CSP was weakened",
    );
    const accessibility = await checkAccessibility(
      page,
      new URL("host-chart-contract-axe.json", directory),
      ".bvm-view",
    );
    assert.deepEqual(accessibility.violations, [], "Host-resolved chart accessibility regressions");
    await page.screenshot({ path: resolve(output, "host-chart-contract.png"), fullPage: true });
    return {
      device: "host-chart-contract",
      passed: true,
      accessibility,
      checks: [
        "exact-source fingerprint refuses stale rows",
        "host-owned rows never stored in model",
        "independent source refresh and asynchronous drawn acknowledgement",
        "render failure recovery without secret row disclosure",
        "raw source table matches drawn data",
        "strict CSP and no external requests",
      ],
    };
  } catch (error) {
    await page
      .screenshot({ path: resolve(output, "host-chart-contract-failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      resolve(output, "host-chart-contract-error.json"),
      JSON.stringify({ error: String(error), errors, external, log }, null, 2),
    );
    throw error;
  } finally {
    await context.close();
    server.kill("SIGTERM");
  }
}
