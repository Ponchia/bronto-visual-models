import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url);
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "demo",
    "--base=/bronto-visual-models/",
    "--outDir",
    "../site-dist",
    "--port",
    "4173",
    "--strictPort",
    "--host",
    "127.0.0.1",
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    serverLog += chunk;
  });
let browser;
const output = new URL("../.tmp/browser/", import.meta.url);
await mkdir(output, { recursive: true });
const results = [];
try {
  const url = "http://127.0.0.1:4173/bronto-visual-models/";
  let online = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Preview exited: ${serverLog}`);
    try {
      const response = await fetch(url);
      online = response.ok;
    } catch {
      /* startup only */
    }
    if (online) break;
    await delay(100);
  }
  assert(online, `Preview did not start: ${serverLog}`);
  browser = await chromium.launch({ headless: true });
  for (const device of [
    { name: "desktop", width: 1440, height: 1100 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      ...(device.name === "mobile" ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        !request.url().startsWith("http://127.0.0.1:4173/") &&
        !request.url().startsWith("data:") &&
        !request.url().startsWith("blob:")
      )
        requests.push(request.url());
    });
    try {
      await page.goto(url, { waitUntil: "networkidle" });
      await page
        .getByTestId("renderer-ready")
        .filter({ hasText: "diagram" })
        .waitFor({ state: "attached" });
      await page.locator('.react-flow__node[data-id="api"]').waitFor();
      assert.equal(await page.getByTestId("revision").textContent(), "rev 1");
      await page.getByRole("button", { name: "Apply agent edit", exact: true }).click();
      await page.getByTestId("revision").filter({ hasText: "rev 2" }).waitFor();
      await page
        .locator('.react-flow__node[data-id="api"]')
        .filter({ hasText: "Orders service" })
        .waitFor();
      await page.getByRole("button", { name: "Retry last operation", exact: true }).click();
      await page.getByTestId("operation-status").filter({ hasText: "Replayed" }).waitFor();
      assert.equal(await page.getByTestId("revision").textContent(), "rev 2");
      await page.getByRole("button", { name: "Try a stale edit", exact: true }).click();
      await page.getByTestId("operation-status").filter({ hasText: "Refused:" }).waitFor();
      assert.equal(await page.getByTestId("revision").textContent(), "rev 2");
      await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
      await page.getByTestId("revision").filter({ hasText: "rev 3" }).waitFor();
      await page.locator('.react-flow__node[data-id="api"]').click();
      await page.getByLabel(/Selected node: api/).fill("Human-edited API");
      await page.getByRole("button", { name: "Save label", exact: true }).click();
      await page.getByTestId("revision").filter({ hasText: "rev 4" }).waitFor();
      for (const projection of ["Network", "Matrix", "Diagram"]) {
        await page.getByRole("button", { name: projection, exact: true }).click();
        await page
          .getByTestId("renderer-ready")
          .filter({ hasText: projection.toLowerCase() })
          .waitFor({ state: "attached" });
        if (projection === "Matrix") {
          await page.locator(".bvm-matrix svg").waitFor();
          await page.getByLabel("Matrix relationship").selectOption("persist");
          await page.getByLabel("Selected edge: persist").waitFor();
        }
        assert.equal(await page.getByTestId("revision").textContent(), "rev 4");
      }
      await page.locator(".vis-item").filter({ hasText: "Contract review" }).waitFor();
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert(
        dimensions.scroll <= dimensions.width + 1,
        `Horizontal overflow: ${JSON.stringify(dimensions)}`,
      );
      assert.deepEqual(errors, [], "Uncaught browser errors");
      assert.deepEqual(requests, [], "The local demo made an external data request");
      await page.screenshot({
        path: new URL(`${device.name}.png`, output).pathname,
        fullPage: true,
      });
      results.push({
        device: device.name,
        passed: true,
        assertions: [
          "create",
          "agent edit",
          "receipt replay",
          "stale refusal",
          "undo",
          "manual label",
          "all projections",
          "timeline",
          "no overflow",
          "no external requests",
        ],
      });
    } catch (error) {
      await page.screenshot({
        path: new URL(`${device.name}-failure.png`, output).pathname,
        fullPage: true,
      });
      await writeFile(new URL(`${device.name}-failure.html`, output), await page.content());
      await writeFile(
        new URL(`${device.name}-errors.json`, output),
        JSON.stringify({ errors, requests }, null, 2),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  await writeFile(new URL("results.json", output), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
