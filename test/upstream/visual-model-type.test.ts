import assert from "node:assert/strict";
import test from "node:test";
import {
  VISUAL_FAMILIES,
  VISUAL_RENDERERS,
  VISUAL_TEMPLATES,
  validateVisualContent,
  visualModelType,
} from "../../src/index.ts";

test("each renderer has one model type, and it is derived from the renderer", () => {
  for (const family of VISUAL_FAMILIES) {
    assert.equal(typeof family.modelType, "string", family.id);
    assert.equal(visualModelType(family.id), family.modelType);
    assert.equal(
      VISUAL_RENDERERS.find((entry) => entry.id === family.id)?.modelType,
      family.modelType,
    );
  }
  assert.throws(() => visualModelType("kroki"), /Unknown renderer: kroki/);
});

test("a template names its renderer, never a second model type that could disagree", () => {
  for (const template of VISUAL_TEMPLATES)
    assert.equal(Object.hasOwn(template, "modelType"), false);
});

test("a mismatched model type is refused with the renderer's own", () => {
  const [template] = VISUAL_TEMPLATES.filter((entry) => entry.renderer === "infographic");
  assert.ok(template);
  assert.throws(
    () => validateVisualContent("infographic", "chart", template.content),
    /Renderer infographic draws model type infographic, not chart; omit modelType and it is derived/,
  );
  validateVisualContent("infographic", "infographic", template.content);
});
