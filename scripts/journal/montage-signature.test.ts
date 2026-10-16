import test from "node:test";
import assert from "node:assert/strict";
import { createMontageSignature } from "./montage-signature.ts";

const sourceIds = ["a", "b", "c", "d"];
const markdown = "A composed thought.";

function composition(sides: string[] = ["left", "right", "left", "right"]) {
  return sourceIds.map((source_id, index) => ({
    type: "source",
    source_id,
    text: `Text for ${source_id}.`,
    image_side: sides[index],
  }));
}

function signature(
  ids = sourceIds,
  text = markdown,
  blocks: Record<string, unknown>[] = composition(),
) {
  return createMontageSignature(ids, text, blocks);
}

test("same editorial montage with different image sides is a repeat", () => {
  assert.equal(
    signature(sourceIds, markdown, composition(["left", "right", "left", "right"])),
    signature(sourceIds, markdown, composition(["right", "left", "right", "left"])),
  );
});

test("different source order remains a different montage", () => {
  const reorderedIds = ["b", "a", "c", "d"];
  const reorderedBlocks = [
    composition()[1],
    composition()[0],
    composition()[2],
    composition()[3],
  ];
  assert.notEqual(
    signature(),
    signature(reorderedIds, markdown, reorderedBlocks),
  );
});

test("changed source text remains a different montage", () => {
  const changed = composition();
  changed[1] = { ...changed[1], text: "A materially different passage." };
  assert.notEqual(signature(), signature(sourceIds, markdown, changed));
});

test("bridge presence, type, and text remain part of the signature", () => {
  const base = composition();
  const withBridge = [
    base[0],
    { type: "bridge", text: "A line that connects the passages." },
    ...base.slice(1),
  ];
  const changedBridge = [
    base[0],
    { type: "bridge", text: "A different connecting line." },
    ...base.slice(1),
  ];
  const changedType = [
    base[0],
    { type: "source", text: "A line that connects the passages." },
    ...base.slice(1),
  ];

  assert.notEqual(signature(), signature(sourceIds, markdown, withBridge));
  assert.notEqual(
    signature(sourceIds, markdown, withBridge),
    signature(sourceIds, markdown, changedBridge),
  );
  assert.notEqual(
    signature(sourceIds, markdown, withBridge),
    signature(sourceIds, markdown, changedType),
  );
});

test("changed montage markdown remains a different montage", () => {
  assert.notEqual(signature(), signature(sourceIds, "A changed composed thought."));
});
