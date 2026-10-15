import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** The chart fixture is built from the archive and enforces script-src self without unsafe-eval. */
export async function testChartContract(browser, outputDirectory) {
  const output = outputDirectory ? new URL(outputDirectory).pathname : resolve(".tmp/browser");
  await mkdir(output, { recursive: true });
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      resolve(".tmp/chart-contract"),
      "--port",
      "4175",
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "",
    spawnError;
  server.on("error", (error) => {
    spawnError = error;
  });
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      log = (log + chunk).slice(-16000);
    });
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  const page = await context.newPage();
  const errors = [],
    external = [],
    results = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4175/") && !request.url().startsWith("data:"))
      external.push(request.url());
  });
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.cspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI }),
    );
  });
  const ready = () =>
    page.waitForFunction(() => {
      const asked = document.querySelector('[data-testid="revision"]')?.textContent;
      return asked && document.querySelector('[data-testid="ready"]')?.textContent === asked;
    });
  const canvasDigest = () =>
    page.locator(".bvm-chart canvas").evaluate((canvas) => {
      const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
      return hash;
    });
  try {
    let online = false;
    for (let i = 0; i < 100; i++) {
      if (spawnError) throw spawnError;
      if (server.exitCode !== null) throw new Error(`Chart server exited: ${log}`);
      try {
        online = (await fetch("http://127.0.0.1:4175", { signal: AbortSignal.timeout(1000) })).ok;
      } catch {}
      if (online) break;
      await delay(100);
    }
    assert.ok(online, log);
    await page.goto("http://127.0.0.1:4175", { waitUntil: "networkidle" });
    await ready();
    await page.locator(".bvm-chart canvas").waitFor();
    const firstCanvas = await canvasDigest();
    await page.getByRole("button", { name: "Calculated chart", exact: true }).click();
    await ready();
    assert.notEqual(await canvasDigest(), firstCanvas, "Expression-aware chart did not redraw");
    await page.getByRole("button", { name: "Data table", exact: true }).click();
    await page.getByRole("table").waitFor();
    assert.equal(await page.locator("table tbody tr").count(), 25);
    assert.ok(
      (await page.getByRole("table").textContent()).includes(
        '<img src="https://example.invalid/tracker"',
      ),
    );
    assert.equal(await page.locator("img").count(), 0, "Raw cell became an image");
    assert.equal(
      await page.locator("table tbody tr").first().locator("td").nth(1).textContent(),
      "1",
      "Source rows were replaced with transformed chart output",
    );
    await page.getByRole("button", { name: "Next rows", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "26–31 of 31 rows" }).waitFor();
    assert.equal(await page.locator("table tbody tr").count(), 6);
    await page.getByRole("button", { name: "Fewer rows", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "1–3 of 3 rows" }).waitFor();
    assert.ok(await page.getByRole("button", { name: "Previous rows", exact: true }).isDisabled());
    await page.getByRole("button", { name: "Empty rows", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "No inline rows" }).waitFor();
    await page.getByRole("button", { name: "Recover chart", exact: true }).click();
    await page.getByRole("button", { name: "Chart", exact: true }).click();
    await ready();
    const beforePause = await page.getByTestId("ready").textContent();
    await page.getByRole("button", { name: "Toggle active", exact: true }).click();
    await page.getByTestId("active").filter({ hasText: "false" }).waitFor();
    await page.getByRole("button", { name: "Update rows", exact: true }).click();
    assert.equal(await page.getByTestId("ready").textContent(), beforePause);
    await page.getByRole("button", { name: "Toggle active", exact: true }).click();
    await ready();
    for (const action of ["Line chart", "Composed chart"]) {
      await page.getByRole("button", { name: action, exact: true }).click();
      await ready();
      if (action === "Line chart") {
        await page.getByText("Encoding notes (1)", { exact: true }).click();
        await page.getByText(/Connected marks imply an ordered path/).waitFor();
      }
    }
    for (const action of [
      "Invalid grammar",
      "External data",
      "External image",
      "External link",
      "External binding",
    ]) {
      await page.getByRole("button", { name: action, exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.notEqual(
        await page.getByTestId("ready").textContent(),
        await page.getByTestId("revision").textContent(),
        `${action} was falsely acknowledged`,
      );
      assert.equal(await page.getByLabel("Host input").inputValue(), "untouched");
      await page.getByRole("button", { name: "Recover chart", exact: true }).click();
      await ready();
      assert.equal(await page.getByRole("alert").count(), 0);
    }
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.waitForFunction(() => {
        const outer = document.querySelector(".bvm-chart")?.getBoundingClientRect();
        const inner = document.querySelector(".bvm-chart canvas")?.getBoundingClientRect();
        return outer && inner && inner.width > 50 && inner.width <= outer.width + 1;
      });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: resolve(output, `chart-${width}.png`), fullPage: true });
    }
    const reported = await page.getByTestId("failures").textContent();
    assert.ok(
      !reported.includes("Service 1") &&
        !reported.includes("tracker") &&
        !reported.includes("bvm_rows"),
      "A renderer error exposed source rows",
    );
    assert.deepEqual(errors, [], "Unhandled chart failure");
    assert.deepEqual(external, [], "Chart attempted external resources");
    assert.deepEqual(
      await page.evaluate(() => window.cspViolations),
      [],
      "Chart required weaker CSP",
    );
    results.push(
      "interpreted calculations under strict script CSP",
      "fitted and composed charts",
      "reactive rows",
      "pause and resume",
      "raw accessible pagination",
      "non-mutating chart encoding guidance",
      "empty rows",
      "malicious cell text remains text",
      "no resource requests",
      "compiler error recovery without source-data disclosure",
      "small-screen fit",
    );
    return { device: "chart-contract", passed: true, assertions: results };
  } catch (error) {
    await page
      .screenshot({ path: resolve(output, "chart-contract-failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      resolve(output, "chart-contract-error.json"),
      JSON.stringify(
        {
          error: String(error),
          errors,
          external,
          csp: await page.evaluate(() => window.cspViolations).catch(() => []),
          log,
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await context.close();
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await Promise.race([
        exited,
        delay(3000).then(() => {
          if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
        }),
      ]);
    }
  }
}
