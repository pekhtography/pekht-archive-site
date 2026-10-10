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

test("preserves T5 snapshot diagnostic format for declared and composition source IDs", () => {
  const declared = check(valid({ source_ids: ["a", "b", "c", "outside"] }));
  assert.equal(
    declared.ok ? "" : declared.reason,
    "MONTAGE_SOURCE_NOT_IN_SNAPSHOT: stage=MONTAGE source_id=outside is not in the DISCOVER snapshot.",
  );

  const composition = (valid().composition as Record<string, unknown>[]).map((block) => ({ ...block }));
  composition[3].source_id = "outside";
  const composed = check(valid({ composition }));
  assert.equal(
    composed.ok ? "" : composed.reason,
    "MONTAGE_SOURCE_NOT_IN_SNAPSHOT: stage=MONTAGE composition source_id=outside is not in the DISCOVER snapshot.",
  );
});

test("preserves T5 composition mismatch diagnostic and sorted symmetric difference", () => {
  const mismatchSnapshot = new Set(["a", "b", "c", "d", "e"]);
  const mismatchImages = new Map([...mismatchSnapshot].map((id) => [id, `/images/${id}.jpg`]));
  const composition = [
    { type: "source", source_id: "a", text: "Text for a" },
    { type: "source", source_id: "b", text: "Text for b" },
    { type: "source", source_id: "c", text: "Text for c" },
    { type: "source", source_id: "e", text: "Text for e" },
  ];
  const result = validateMontage(valid(), "candidate-1", mismatchSnapshot, mismatchImages);
  assert.equal(result.ok, false);
  const mismatch = validateMontage(
    valid({ composition }),
    "candidate-1",
    mismatchSnapshot,
    mismatchImages,
  );
  assert.equal(
    mismatch.ok ? "" : mismatch.reason,
    "MONTAGE_COMPOSITION_MISMATCH: stage=MONTAGE source_id set differs between task2.source_ids and composition source blocks; mismatched source_id(s): d, e.",
  );
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
test("accepts six unique sources with a non-empty bridge block", () => {
  const sixIds = ["a", "b", "c", "d", "e", "f"];
  const sixSnapshot = new Set(sixIds);
  const sixImages = new Map(sixIds.map((id) => [id, `/images/${id}.jpg`]));
  const six = {
    ...valid(),
    source_ids: sixIds,
    composition: [
      { type: "source", source_id: "a", text: "Text a" },
      { type: "source", source_id: "b", text: "Text b" },
      { type: "bridge", text: "A short connecting bridge." },
      ...sixIds.slice(2).map((source_id) => ({ type: "source", source_id, text: `Text ${source_id}` })),
    ],
  };
  const result = validateMontage(six, "candidate-1", sixSnapshot, sixImages);
  assert.equal(result.ok, true);
});
