import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createModel, type VisualModel } from "../src/index.ts";
import { useVisualModel } from "../src/react/useVisualModel.ts";

test("React model subscriptions supply immutable SSR snapshots without freezing host-owned models", () => {
  const host = createModel({
    id: "ssr",
    title: "Server snapshot",
    renderer: "diagram",
    content: { nodes: [], edges: [] },
  });
  let observed: VisualModel | undefined;
  const source = { get: () => host, subscribe: () => () => {} };
  function Read() {
    observed = useVisualModel(source, "ssr");
    return createElement("span", null, observed?.title);
  }
  assert.equal(renderToString(createElement(Read)), "<span>Server snapshot</span>");
  assert.ok(Object.isFrozen(observed));
  assert.ok(Object.isFrozen(observed!.content));
  assert.notEqual(observed, host);
  assert.equal(Object.isFrozen(host), false);
  host.title = "New host title";
  assert.equal(observed!.title, "Server snapshot");
});
test("missing models have a stable undefined SSR snapshot", () => {
  const source = { get: () => undefined, subscribe: () => () => {} };
  function Read() {
    return createElement("span", null, useVisualModel(source, "missing")?.title ?? "Loading");
  }
  assert.equal(renderToString(createElement(Read)), "<span>Loading</span>");
});
