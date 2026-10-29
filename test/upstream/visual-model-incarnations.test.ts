import assert from "node:assert/strict";
import test from "node:test";
import {
  assertModelIncarnations,
  assignModelIncarnations,
  VISUAL_MODEL_VERSION,
  VISUAL_RENDERERS,
  type VisualModel,
} from "../../src/index.ts";

// Two rows in every collection the renderer declares, each with its lifetime. The assertion
// reads only rows and identities, so the rows need nothing but an id.
function stored(renderer: (typeof VISUAL_RENDERERS)[number]): VisualModel {
  let minted = 0;
  return assignModelIncarnations(
    {
      id: "example",
      generation: "generation",
      schemaVersion: VISUAL_MODEL_VERSION,
      revision: 1,

      title: "Example",
      description: "",
      modelType: renderer.modelType,
      renderer: renderer.id,
      rendererVersion: renderer.version,
      content: Object.fromEntries(
        renderer.records.map((collection) => [
          collection,
          [{ id: `${collection}-a` }, { id: `${collection}-b` }],
        ]),
      ),
      status: "active",
      role: "model",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      createdBy: "test",
      updatedBy: "test",
    },
    undefined,
    () => `incarnation-${String(++minted).padStart(8, "0")}`,
  );
}

function without(model: VisualModel, collection: string, rows: boolean): VisualModel {
  const { [collection]: _map, ...identities } = model.elementIncarnations ?? {};
  const { [collection]: _rows, ...content } = model.content;
  return { ...model, content: rows ? model.content : content, elementIncarnations: identities };
}

test("a collection declared after a model was stored needs no map until it has rows", () => {
  const refused: string[] = [];
  for (const renderer of VISUAL_RENDERERS) {
    const model = stored(renderer);
    assertModelIncarnations(model);
    for (const collection of renderer.records) {
      // Stored before the family declared it: no rows, no map.
      try {
        assertModelIncarnations(without(model, collection, false));
      } catch (error) {
        refused.push(`${renderer.id}.${collection}: ${(error as Error).message}`);
      }
      // Rows still need their exact lifetimes.
      assert.throws(
        () => assertModelIncarnations(without(model, collection, true)),
        /Element identity membership differs from model content/,
        `${renderer.id}.${collection} with rows and no map`,
      );
    }
  }
  assert.deepEqual(refused, []);
});

test("a map for a collection this build does not declare stands only while it is empty", () => {
  for (const renderer of VISUAL_RENDERERS) {
    const model = stored(renderer);
    // A newer build declared `later` and wrote its empty map on an unrelated edit.
    const touched = {
      ...model,
      elementIncarnations: { ...model.elementIncarnations, later: {} },
    };
    assertModelIncarnations(touched);
    // A member there is a record this build cannot read.
    assert.throws(
      () =>
        assertModelIncarnations({
          ...model,
          elementIncarnations: {
            ...model.elementIncarnations,
            later: { "later-a": "incarnation-99999999" },
          },
        }),
      /Invalid model element identities/,
      renderer.id,
    );
    // The next write keeps exactly the declared maps.
    const written = assignModelIncarnations(touched, touched, () => "incarnation-fresh-000");
    assert.deepEqual(Object.keys(written.elementIncarnations ?? {}), [...renderer.records]);
  }
});

// The record collections of each family version. A version's collections never change: an older
// build validates a model of a version it knows and refuses rows it cannot read, so a family that
// adds or drops a collection takes a new version, which a content write stamps on the model.
const RECORDS_BY_VERSION: Record<string, readonly string[]> = {
  "analysis@1": ["nodes", "links"],
  "application@1": ["parameters", "targets", "documents"],
  "application@2": ["parameters", "targets", "documents"],
  "diagram@1": ["nodes", "edges"],
  "diagram@2": ["nodes", "edges"],
  "c4@1": ["elements", "relationships", "views"],
  "gantt@1": ["workstreams", "tasks", "dependencies"],
  "geography@1": ["features"],
  "infographic@2": ["items", "relations"],
  "scene3d@1": ["nodes", "assets", "viewpoints"],
  "scene3d@2": ["nodes", "assets", "viewpoints", "measures"],
  "source-diagram@1": [],
  "spatial-layers@1": ["layers", "rows"],
  "timeline@2": ["lanes", "events"],
  "vega-lite@1": ["annotations"],
};

test("a family version's record collections never change", () => {
  for (const { id, version, records } of VISUAL_RENDERERS)
    assert.deepEqual(
      records,
      RECORDS_BY_VERSION[`${id}@${version}`],
      `${id}@${version}: changing a family's record collections bumps its version; pin the new one here`,
    );
});
