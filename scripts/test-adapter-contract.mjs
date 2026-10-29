import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkAccessibility } from "./accessibility.mjs";

/** A genuinely independent packed React consumer: custom family, lazy view and built-in override. */
export async function testAdapterContract(browser, directory) {
  const out = directory ? new URL(directory).pathname : resolve(".tmp/browser");
  await mkdir(out, { recursive: true });
  const origin = "http://127.0.0.1:4185";
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      resolve(".tmp/adapter-contract"),
      "--port",
      "4185",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      log = (log + chunk).slice(-10000);
    });
  const context = await browser.newContext({ viewport: { width: 1200, height: 960 } });
  const page = await context.newPage();
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith(origin + "/")) requests.push(request.url());
  });
  page.setDefaultTimeout(16000);
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error(`Consumer preview exited: ${log}`);
      try {
        ready = (await fetch(origin, { signal: AbortSignal.timeout(750) })).ok;
      } catch {}
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, log);
    await page.goto(origin, { waitUntil: "networkidle" });
    const revision = () => page.getByTestId("revision").textContent();
    assert.equal(await page.evaluate(() => !!window.scorecardModuleEvaluated), false);
    await page.getByRole("button", { name: "Open scorecard" }).click();
    await page.getByText("This package has no interactive adapter", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => !!window.scorecardModuleEvaluated), false);
    await page.getByRole("button", { name: "Enable custom adapters" }).click();
    await page.getByTestId("custom-scorecard").filter({ hasText: "Needs review" }).waitFor();
    assert.equal(await page.evaluate(() => !!window.scorecardModuleEvaluated), true);
    await page.getByRole("button", { name: "Select score" }).click();
    await page.getByTestId("score-selection").filter({ hasText: "selected" }).waitFor();
    await page.getByRole("button", { name: "Review score" }).click();
    await page.getByTestId("custom-scorecard").filter({ hasText: "Reviewed" }).waitFor();
    assert.equal(await revision(), "Revision 2");

    await page.getByRole("button", { name: "Open diagram" }).click();
    const api = page.locator('.react-flow__node[data-id="api"]');
    await api.waitFor({ state: "visible" });
    assert.ok(
      (await api.locator(".bvm-entity").getAttribute("class")).includes("bvm-shape-database"),
    );
    assert.match(
      (await page
        .locator('.react-flow__edge[data-id="ab"] .react-flow__edge-path')
        .getAttribute("style")) ?? "",
      /stroke-dasharray:\s*8(?:px)?,\s*5(?:px)?/,
    );
    await page.locator("summary").filter({ hasText: "Author diagram" }).click();
    await api.click();
    await page.getByLabel("Diagram node shape").selectOption("pill");
    await page.getByLabel("Diagram item color").selectOption("danger");
    await page.getByRole("button", { name: "Apply diagram appearance" }).click();
    await page.getByTestId("revision").filter({ hasText: "Revision 2" }).waitFor();
    assert.match(await api.locator(".bvm-entity").getAttribute("class"), /bvm-shape-pill/);
    // A host-confirmed edit must advance the editor's baseline. The next edit
    // succeeds without requiring a manual reload or using stale expected values.
    await page.getByLabel("Diagram item label").fill("API Gateway");
    await page.getByRole("button", { name: "Apply diagram appearance" }).click();
    await page.getByTestId("revision").filter({ hasText: "Revision 3" }).waitFor();
    await api.filter({ hasText: "API Gateway" }).waitFor();
    await page.getByRole("button", { name: "Add diagram node" }).click();
    await page.getByTestId("revision").filter({ hasText: "Revision 4" }).waitFor();
    assert.equal(await page.locator(".react-flow__node").count(), 3);
    await page.getByLabel("Diagram link label").fill("verifies");
    await page.getByRole("button", { name: "Add diagram link" }).click();
    await page.getByTestId("revision").filter({ hasText: "Revision 5" }).waitFor();
    assert.equal(await page.locator(".react-flow__edge").count(), 2);

    await page.getByRole("button", { name: "Toggle edit refusal" }).click();
    await page.getByLabel("Diagram item label").fill("Should not save");
    await page.getByRole("button", { name: "Apply diagram appearance" }).click();
    await page.getByText("Edit refused; reload the fields or revise your changes").waitFor();
    assert.equal(await revision(), "Revision 5");
    assert.ok(!(await page.getByTestId("saved-model").textContent()).includes("Should not save"));
    await page.getByRole("button", { name: "Toggle edit refusal" }).click();
    await page.getByRole("button", { name: "Toggle read-only" }).click();
    assert.equal(await page.locator(".bvm-graph-authoring").count(), 0);
    await page.getByRole("button", { name: "Toggle read-only" }).click();
    await page.getByRole("button", { name: "Override diagram adapter" }).click();
    await page.getByTestId("diagram-override").waitFor();
    assert.equal(await page.locator(".react-flow__node").count(), 0);
    await page.getByRole("button", { name: "Enable custom adapters" }).click();
    await api.waitFor({ state: "visible" });
    assert.deepEqual(errors, [], "Custom adapters raised browser errors");
    assert.deepEqual(requests, [], "Custom adapters loaded an external resource");
    const accessibility = await checkAccessibility(
      page,
      new URL("adapter-contract-axe.json", directory),
    );
    assert.deepEqual(accessibility.violations, [], "Custom consumer accessibility regressions");
    await page.screenshot({ path: resolve(out, "adapter-contract.png"), fullPage: true });
    return {
      device: "adapter-contract",
      passed: true,
      assertions: [
        "independent family and opt-in lazy adapter",
        "host overriding built-in adapter",
        "graph styles, guarded authoring and refusal",
        "read-only boundary",
        "no unexpected requests",
        "accessibility scan",
      ],
      accessibility,
    };
  } catch (error) {
    await page
      .screenshot({ path: resolve(out, "adapter-contract-failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      resolve(out, "adapter-contract-errors.json"),
      JSON.stringify({ error: String(error), errors, requests, log }, null, 2),
    );
    throw error;
  } finally {
    await context.close();
    server.kill("SIGTERM");
  }
}
