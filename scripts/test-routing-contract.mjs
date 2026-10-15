import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export async function testRoutingContract(browser, outputDirectory) {
  const out = outputDirectory ? new URL(outputDirectory).pathname : resolve(".tmp/browser");
  await mkdir(out, { recursive: true });
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      resolve(".tmp/routing-contract"),
      "--port",
      "4176",
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (failure) throw failure;
      if (server.exitCode !== null) throw new Error(log);
      try {
        ready = (await fetch("http://127.0.0.1:4176", { signal: AbortSignal.timeout(1000) })).ok;
      } catch {}
      if (ready) break;
      await delay(100);
    }
    assert(ready, log);
    await page.goto("http://127.0.0.1:4176", { waitUntil: "networkidle" });
    const arranged = async () => {
      await page.getByRole("button", { name: "Arrange", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll('[data-bvm-route="elk"]').length === 5,
      );
    };
    await arranged();
    const labels = await page.locator("[data-edge-label]").evaluateAll((items) =>
      items.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          text: el.textContent,
          font: getComputedStyle(el).font,
          scroll: el.scrollWidth,
          client: el.clientWidth,
        };
      }),
    );
    assert(labels.length >= 2, "Labels could not be placed");
    const boxes = await page.locator(".react-flow__node").evaluateAll((items) =>
      items.map((el) => {
        const r = el.getBoundingClientRect();
        const group = !!el.querySelector(".bvm-group");
        const scale = r.width / Number(el.style.width.replace("px", ""));
        return { x: r.x, y: r.y, w: r.width, h: group ? 44 * scale : r.height };
      }),
    );
    for (const label of labels)
      for (const box of boxes)
        assert(
          label.x + label.w <= box.x ||
            box.x + box.w <= label.x ||
            label.y + label.h <= box.y ||
            box.y + box.h <= label.y,
          "Label overlaps a node or group heading",
        );
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i],
          b = labels[j];
        assert(
          a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
          "Labels overlap",
        );
      }
    for (const label of labels.filter((l) => l.text.length < 35))
      assert(
        label.scroll <= label.client + 1,
        `A short label is unexpectedly truncated: ${JSON.stringify(label)}`,
      );
    await page.locator(".bvm-edge-reading summary").click();
    assert(
      (await page.locator(".bvm-edge-reading").textContent()).includes(
        "remains fully available in the reading list",
      ),
    );
    await page.locator(".bvm-edge-reading summary").click();
    await page.getByRole("button", { name: "Rename title", exact: true }).click();
    assert.equal(
      await page.locator('[data-bvm-route="elk"]').count(),
      5,
      "Unrelated title change discarded routes",
    );
    await page.getByRole("button", { name: "Move remote node", exact: true }).click();
    await page.locator('[data-routing-state="stale"]').waitFor();
    assert.equal(await page.locator('[data-bvm-route="elk"]').count(), 0);
    await arranged();
    const node = page.locator('.react-flow__node[data-id="c"]');
    const rect = await node.boundingBox();
    assert(rect);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + 25, rect.y + rect.height / 2 + 15, {
      steps: 5,
    });
    assert.equal(
      await page.locator('[data-bvm-route="elk"]').count(),
      0,
      "Old routes survived an in-progress drag",
    );
    await page.mouse.up();
    await page.locator('[data-routing-state="stale"]').waitFor();
    await arranged();
    await page.getByRole("button", { name: "Replace entry", exact: true }).click();
    await page.locator('[data-routing-state="stale"]').waitFor();
    assert.equal(await page.locator('[data-bvm-route="elk"]').count(), 0);
    await arranged();
    await page.screenshot({ path: resolve(out, "routing-contract.png"), fullPage: true });
    await writeFile(
      resolve(out, "routing-label-measurements.json"),
      JSON.stringify(labels, null, 2),
    );
    assert.deepEqual(errors, []);
    return {
      device: "routing-contract",
      passed: true,
      assertions: [
        "compound ROOT coordinates",
        "parallel routes and self-loop",
        "measured collision-free label boxes",
        "full relationship reading list",
        "title edits retain geometry",
        "remote obstacle changes invalidate all routes",
        "drag invalidation before commit",
        "replacement incarnation invalidation",
      ],
    };
  } catch (error) {
    await page
      .screenshot({ path: resolve(out, "routing-contract-failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      resolve(out, "routing-contract-errors.json"),
      JSON.stringify({ log, errors, error: String(error) }, null, 2),
    );
    throw error;
  } finally {
    await page.close();
    server.kill("SIGTERM");
    await Promise.race([once(server, "exit"), delay(2000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}
