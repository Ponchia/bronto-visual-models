import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Exercised from an independently installed tarball, never aliases into source. */
export async function testReactContract(browser) {
  const output = resolve(".tmp/browser");
  await mkdir(output, { recursive: true });
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      resolve(".tmp/react-contract"),
      "--port",
      "4174",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  let failure;
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      log = (log + chunk).slice(-32000);
    });
  server.on("error", (error) => {
    failure = error;
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failure) throw failure;
      if (server.exitCode !== null) throw new Error(`Contract preview exited: ${log}`);
      try {
        ready = (await fetch("http://127.0.0.1:4174", { signal: AbortSignal.timeout(1000) })).ok;
      } catch {}
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, log);
    await page.goto("http://127.0.0.1:4174", { waitUntil: "networkidle" });
    await page
      .getByTestId("subscription-catchup")
      .filter({ hasText: "Caught up after subscribe" })
      .waitFor();
    const node = page.locator('.react-flow__node[data-id="a"]');
    await node.waitFor();
    const drag = async () => {
      const rect = await node.boundingBox();
      assert.ok(rect);
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width / 2 + 55, rect.y + rect.height / 2 + 25, {
        steps: 8,
      });
      await page.mouse.up();
    };
    const changes = await page.getByTestId("snapshot-changes").textContent();
    const reads = Number(await page.getByTestId("snapshot-reads").textContent());
    await page.getByRole("button", { name: "Unrelated update", exact: true }).click();
    // The host snapshot reference must remain stable through unrelated store activity.
    await page.getByRole("button", { name: "Select A", exact: true }).click();
    assert.equal(await page.getByTestId("snapshot-changes").textContent(), changes);
    assert.equal(
      Number(await page.getByTestId("snapshot-reads").textContent()),
      reads,
      "Unrelated transactions and React renders must not re-clone the model",
    );
    assert.ok((await node.getAttribute("class")).includes("selected"));
    await page.getByRole("button", { name: "Replace A", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="revision"]').textContent === "2",
    );
    await page.waitForFunction(
      () =>
        !document.querySelector('.react-flow__node[data-id="a"]')?.classList.contains("selected"),
    );
    assert.ok(
      Number(await page.getByTestId("snapshot-reads").textContent()) > reads,
      "A matching commit must read the newly committed model",
    );
    await page.getByLabel("Commit mode").selectOption("delay");
    await drag();
    await page.getByTestId("pending").filter({ hasText: "true" }).waitFor();
    await page.getByRole("button", { name: "Host update", exact: true }).click();
    await node.filter({ hasText: "Latest host A" }).waitFor();
    const latestPosition = await node.evaluate((element) => element.style.transform);
    await page.getByRole("button", { name: "Reject pending", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Delayed edit refused" }).waitFor();
    // React Flow may hide nodes for one measurement pass after controlled state changes.
    // Require visibility again, then assert the authored coordinates rather than incidental style flags.
    await node.waitFor({ state: "visible" });
    assert.equal(
      await node.evaluate((element) => element.style.transform),
      latestPosition,
      "Late rejection restored obsolete host coordinates",
    );
    assert.ok((await node.textContent()).includes("Latest host A"));
    await page.getByLabel("Commit mode").selectOption("sync");
    await drag();
    await page.getByRole("alert").filter({ hasText: "Synchronous edit refused" }).waitFor();
    await node.waitFor({ state: "visible" });
    assert.equal(await node.evaluate((element) => element.style.transform), latestPosition);
    await page.getByRole("button", { name: "Switch model", exact: true }).click();
    await page.locator('.bvm-view[data-model-id="other"]').waitFor();
    assert.equal(await page.getByRole("alert").count(), 0, "Errors leaked between models");
    await page.getByRole("button", { name: "Custom theme", exact: true }).click();
    assert.equal(
      await node
        .locator(".bvm-entity")
        .evaluate((element) => getComputedStyle(element).borderTopColor),
      "rgb(145, 183, 229)",
    );
    assert.equal(
      await page
        .locator(".bvm-view")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      "rgb(23, 32, 42)",
    );
    await page.getByRole("button", { name: "Custom ports", exact: true }).click();
    const firstPort = node.locator('.source[data-handleid="out1"]');
    const secondPort = node.locator('.source[data-handleid="out2"]');
    await secondPort.waitFor();
    const a = await firstPort.boundingBox(),
      b = await secondPort.boundingBox();
    assert.ok(a && b && b.y - a.y > 10, "Custom ports overlapped");
    const path = page.locator('.react-flow__edge[data-id="port-edge"] .react-flow__edge-path');
    await path.waitFor({ state: "attached" });
    const previousPath = await path.getAttribute("d");
    assert.ok(
      previousPath && !previousPath.includes("NaN"),
      "Explicit top/custom connection has no geometry",
    );
    await page.getByRole("button", { name: "Move port sides", exact: true }).click();
    await node.locator('.source.react-flow__handle-bottom[data-handleid="out2"]').waitFor();
    await page.waitForFunction((before) => {
      const value = document
        .querySelector('.react-flow__edge[data-id="port-edge"] .react-flow__edge-path')
        ?.getAttribute("d");
      return value && value !== before && !value.includes("NaN");
    }, previousPath);
    assert.deepEqual(errors, [], "Unhandled React or callback error");
    await page.screenshot({ path: resolve(output, "react-contract.png"), fullPage: true });
    return {
      device: "react-contract",
      passed: true,
      assertions: [
        "StrictMode subscriptions",
        "render-to-subscribe catch-up",
        "stable snapshot",
        "no redundant model cloning on unrelated React renders",
        "unrelated updates",
        "replaced target",
        "late refusal restores latest host",
        "synchronous refusal",
        "model-switch error reset",
        "host-token graph colors",
        "separated custom ports and explicit top endpoint",
        "dynamic port measurement updates edge geometry",
      ],
    };
  } catch (error) {
    await page
      .screenshot({ path: resolve(output, "react-contract-failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      resolve(output, "react-contract-errors.json"),
      JSON.stringify({ errors, log, error: String(error) }, null, 2),
    );
    throw error;
  } finally {
    await page.close();
    server.kill("SIGTERM");
  }
}
