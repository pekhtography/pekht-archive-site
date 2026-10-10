import test from "node:test";
import assert from "node:assert/strict";
import { validateMontage } from "./montage-validation.ts";

const ids = ["a", "b", "c", "d"];
const snapshot = new Set(ids);
const images = new Map(ids.map((id) => [id, `/images/${id}.jpg`]));

function valid(overrides: Record<string, unknown> = {}) {
  return {
    status: "OK",
    candidate_id: "candidate-1",
    title: "A title",
    description: "A description",
    source_ids: [...ids],
    markdown: "A composed text.",
    composition: ids.map((source_id) => ({
      type: "source",
      source_id,
      text: `Text for ${source_id}`,
      image_side: "left",
      image_size: "medium",
      text_offset: "center",
    })),
    reason: "Valid montage",
    facets: [],
    ...overrides,
  };
}

function check(value: unknown) {
  return validateMontage(value, "candidate-1", snapshot, images);
}

test("accepts a valid four-source montage and empty facets", () => {
  const result = check(valid());
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.sourceIds, ids);
});

test("blocks RETURN and missing status", () => {
  assert.equal(check(valid({ status: "RETURN" })).ok, false);
  const missing = valid();
  delete (missing as Record<string, unknown>).status;
  assert.equal(check(missing).ok, false);
});

test("blocks source counts outside 4–6", () => {
  assert.equal(check(valid({ source_ids: ids.slice(0, 3) })).ok, false);
  assert.equal(check(valid({ source_ids: [...ids, "e", "f", "g"] })).ok, false);
});

test("blocks duplicate declared IDs and duplicate source blocks", () => {
  assert.equal(check(valid({ source_ids: ["a", "b", "c", "a"] })).ok, false);
  const composition = [...(valid().composition as object[]), {
    type: "source", source_id: "a", text: "Duplicate source",
  }];
  assert.equal(check(valid({ composition })).ok, false);
});

test("blocks missing source IDs, empty block text, and invalid block types", () => {
  const missingId = (valid().composition as Record<string, unknown>[]).map((b) => ({ ...b }));
  delete missingId[0].source_id;
  assert.equal(check(valid({ composition: missingId })).ok, false);

  const emptyText = (valid().composition as Record<string, unknown>[]).map((b) => ({ ...b }));
  emptyText[0].text = "  ";
  assert.equal(check(valid({ composition: emptyText })).ok, false);

  const invalidType = (valid().composition as Record<string, unknown>[]).map((b) => ({ ...b }));
  invalidType[0].type = "other";
  assert.equal(check(valid({ composition: invalidType })).ok, false);
});

test("blocks IDs outside snapshot, mismatched IDs, and missing archive images", () => {
  assert.equal(check(valid({ source_ids: ["a", "b", "c", "outside"] })).ok, false);
  assert.equal(check(valid({ source_ids: ["a", "b", "c", "d"], composition: (valid().composition as object[]).slice(0, 3) })).ok, false);
  assert.equal(validateMontage(valid(), "candidate-1", snapshot, new Map([["a", "/a"], ["b", "/b"], ["c", "/c"]])).ok, false);
});

test("blocks missing publication fields and invalid facets", () => {
  assert.equal(check(valid({ title: " " })).ok, false);
  assert.equal(check(valid({ description: "" })).ok, false);
  assert.equal(check(valid({ markdown: "" })).ok, false);
  assert.equal(check(valid({ facets: ["", 42] })).ok, false);
});

test("blocks candidate mismatch", () => {
  assert.equal(check(valid({ candidate_id: "other" })).ok, false);
});
