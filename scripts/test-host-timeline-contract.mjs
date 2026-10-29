import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkAccessibility } from "./accessibility.mjs";

/** Real packed consumer; no Spatial service, network reader or source alias. */
export async function testHostTimelineContract(browser, outputDirectory) {
  const out = outputDirectory ? new URL(outputDirectory).pathname : resolve(".tmp/browser");
  await mkdir(out, { recursive: true });
  const origin = "http://127.0.0.1:4187";
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      resolve(".tmp/host-timeline-contract"),
      "--port",
      "4187",
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
  const context = await browser.newContext({ viewport: { width: 1150, height: 940 } });
  const page = await context.newPage();
  page.setDefaultTimeout(16000);
  const errors = [],
    external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith(origin + "/")) external.push(request.url());
  });
  await page.addInitScript(() => {
    window.timelineCspViolations = [];
    window.addEventListener("securitypolicyviolation", (event) =>
      window.timelineCspViolations.push(event.violatedDirective),
    );
  });
  const ready = (revision) =>
    page.getByTestId("ready-source").filter({ hasText: revision }).waitFor();
  try {
    let online = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error("Host timeline preview ended: " + log);
      try {
        online = (await fetch(origin, { signal: AbortSignal.timeout(800) })).ok;
      } catch {}
      if (online) break;
      await delay(100);
    }
    assert.ok(online, log);
    await page.goto(origin, { waitUntil: "networkidle" });
    await ready("snapshot-1");
    assert.equal(await page.getByTestId("model-revision").textContent(), "1");
    assert.ok(!(await page.getByTestId("saved-content").textContent()).includes("Order received"));
    await page.locator(".bvm-timeline .vis-item").filter({ hasText: "Order received" }).waitFor();
    assert.ok(
      (await page.locator(".bvm-timeline").textContent()).includes(
        '<img src="https://example.invalid/tracker">',
      ),
    );
    assert.equal(
      await page.locator(".bvm-timeline img").count(),
      0,
      "HTML row text became an image",
    );
    const digest = await page.getByTestId("ready-digest").textContent();
    assert.match(digest, /^[a-f0-9]{64}$/);
    await page.locator(".bvm-timeline .vis-item").filter({ hasText: "Order received" }).click();
    await page.getByTestId("selected-source-row").filter({ hasText: "order-1" }).waitFor();
    assert.equal(await page.getByTestId("selected-source-revision").textContent(), "snapshot-1");
    assert.equal(await page.getByTestId("selected-source-entity").textContent(), "order-123");
    await page.getByRole("button", { name: "Refresh timeline data" }).click();
    await ready("snapshot-2");
    assert.notEqual(await page.getByTestId("ready-digest").textContent(), digest);
    await page.locator(".bvm-timeline .vis-item").filter({ hasText: "Order verified" }).waitFor();
    await page.locator(".bvm-timeline .vis-item").filter({ hasText: "Order shipped" }).waitFor();
    assert.equal(await page.getByTestId("model-revision").textContent(), "1");
    await page.locator(".bvm-timeline .vis-item").filter({ hasText: "Order shipped" }).click();
    await page.getByTestId("selected-source-row").filter({ hasText: "order-3" }).waitFor();
    assert.equal(await page.getByTestId("selected-source-revision").textContent(), "snapshot-2");
    assert.equal(await page.getByTestId("edit-attempts").textContent(), "0");
    await page.getByRole("button", { name: "Invalid timeline rows" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByTestId("ready-source").textContent(), "snapshot-2");
    assert.ok(
      !(await page.getByTestId("error-messages").textContent()).includes("PRIVATE-SOURCE-SECRET"),
    );
    await page.getByRole("button", { name: "Restore timeline rows" }).click();
    await ready("snapshot-4");
    await page.waitForFunction(() => document.querySelectorAll('[role="alert"]').length === 0);
    await page.getByRole("button", { name: "Wrong timeline source" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByTestId("ready-source").textContent(), "snapshot-4");
    const refusedMessages = await page.getByTestId("error-messages").textContent();
    await page.getByRole("button", { name: "Remove timeline snapshot" }).click();
    await page.getByText("Resolve this timeline's dataset in the host", { exact: false }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[role="alert"]').length === 0);
    assert.equal(
      await page.getByTestId("error-messages").textContent(),
      refusedMessages,
      "Withdrawing a refused snapshot reported another error",
    );
    await page.getByRole("button", { name: "Restore timeline snapshot" }).click();
    await page.getByRole("alert").waitFor();
    await page.getByRole("button", { name: "Resolve current timeline source" }).click();
    await ready("snapshot-6");
    await page.getByRole("button", { name: "Change timeline source" }).click();
    await page.getByTestId("model-revision").filter({ hasText: "2" }).waitFor();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByTestId("ready-model").textContent(), "1");
    await page.getByRole("button", { name: "Resolve current timeline source" }).click();
    await page.getByTestId("ready-model").filter({ hasText: "2" }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[role="alert"]').length === 0);
    const priorErrorHistory = await page.getByTestId("error-messages").textContent();
    await page.getByRole("button", { name: "Remove timeline snapshot" }).click();
    await page.getByText("Resolve this timeline's dataset in the host", { exact: false }).waitFor();
    assert.equal(
      await page.getByTestId("error-messages").textContent(),
      priorErrorHistory,
      "A host that has not supplied timeline rows received an unexpected error callback",
    );
    await page.getByRole("button", { name: "Restore timeline snapshot" }).click();
    await page.waitForFunction(() => document.querySelectorAll('[role="alert"]').length === 0);
    assert.equal(await page.getByTestId("edit-attempts").textContent(), "0");
    assert.equal(await page.getByLabel("Unrelated host input").inputValue(), "unchanged");
    assert.ok(!(await page.getByTestId("saved-content").textContent()).includes("Order received"));
    const accessibility = await checkAccessibility(
      page,
      new URL("host-timeline-axe.json", outputDirectory),
      ".bvm-view",
    );
    assert.deepEqual(accessibility.violations, [], "Host timeline accessibility regressions");
    assert.deepEqual(errors, [], "Timeline source data raised page errors");
    assert.deepEqual(external, [], "Timeline attempted an external resource read");
    assert.deepEqual(
      await page.evaluate(() => window.timelineCspViolations),
      [],
      "Timeline required a weaker CSP",
    );
    await page.screenshot({ path: resolve(out, "host-timeline.png"), fullPage: true });
    return {
      device: "host-timeline-contract",
      passed: true,
      accessibility,
      checks: [
        "source event identity and controlled selection",
        "source refresh changes only derived events; source targets are revision-scoped",
        "private row errors and XSS-like text stay inert",
        "read-only source facts never call host edit",
        "stale/invalid source rejects without drawn-frame acknowledgement",
        "strict CSP and zero outside requests",
      ],
    };
  } catch (error) {
    await page
      .screenshot({ path: resolve(out, "host-timeline-failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      resolve(out, "host-timeline-error.json"),
      JSON.stringify({ error: String(error), errors, external, log }, null, 2),
    );
    throw error;
  } finally {
    await context.close();
    server.kill("SIGTERM");
  }
}
