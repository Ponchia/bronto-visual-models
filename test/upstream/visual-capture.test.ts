import assert from "node:assert/strict";
import test from "node:test";
import {
  parseVisualCaptureAttestation,
  readVisualCapture,
  visualCaptureAttestation,
  visualCaptureQuery,
} from "../../src/index.ts";

test("the capture query reads back as the intent it was built from", () => {
  const search = `?${visualCaptureQuery({ viewpoint: "top" })}`;
  assert.deepEqual(readVisualCapture({ pathname: "/c/canvas/scene", search }, "scene"), {
    capture: true,
    still: true,
    viewpoint: "top",
  });
  assert.deepEqual(
    readVisualCapture({ pathname: "/c/canvas/scene", search: `?${visualCaptureQuery()}` }, "scene"),
    { capture: true, still: true },
  );
});

test("capture and still rule the page; the viewpoint only the node the path names", () => {
  const page = { pathname: "/c/canvas/scene", search: "?visualCapture=1&still=1&view=top" };
  assert.deepEqual(readVisualCapture(page, "other"), { capture: true, still: true });
  assert.deepEqual(
    readVisualCapture({ pathname: "/c/canvas/scene%20a", search: "?view=top" }, "scene a"),
    { capture: false, still: false, viewpoint: "top" },
  );
  assert.deepEqual(
    readVisualCapture({ pathname: "/c/canvas/scene", search: "?still=0" }, "scene"),
    {
      capture: false,
      still: false,
    },
  );
  assert.deepEqual(
    readVisualCapture({ pathname: "/c/canvas/scene", search: `?view=${"x".repeat(65)}` }, "scene"),
    { capture: false, still: false },
  );
});

test("a malformed path segment names no node instead of throwing", () => {
  // The web host reads this at module scope, so a throw would take the page's
  // visual views down with it.
  assert.deepEqual(readVisualCapture({ pathname: "/c/x/%E0%A4", search: "?view=a" }, ""), {
    capture: false,
    still: false,
  });
  assert.deepEqual(
    readVisualCapture({ pathname: "/c/x/%E0%A4", search: "?visualCapture=1&view=a" }, "%E0%A4"),
    { capture: true, still: false },
  );
});

test("an attestation round-trips and anything else reads as none", () => {
  const applied = { viewpoint: "top", still: true, fit: true };
  assert.deepEqual(parseVisualCaptureAttestation(visualCaptureAttestation(applied)), applied);
  assert.equal(
    visualCaptureAttestation(applied),
    visualCaptureAttestation({ fit: true, still: true, viewpoint: "top" }),
  );
  for (const value of [
    null,
    "",
    "not json",
    "[]",
    '{"viewpoint":null,"still":true}',
    '{"viewpoint":3,"still":true,"fit":true}',
  ])
    assert.equal(parseVisualCaptureAttestation(value), null, String(value));
});
