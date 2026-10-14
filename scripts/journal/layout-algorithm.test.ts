import assert from "node:assert/strict";
import test from "node:test";
import { calculateJournalLayout } from "../../src/lib/journal-layout-algorithm.ts";

test("Tulip composition resolves to L-R-R with perfectly balanced image weight", () => {
  const result = calculateJournalLayout(["V", "H", "H"]);

  assert.deepEqual(result.sides, ["left", "right", "right"]);
  assert.equal(result.leftWeight, 2);
  assert.equal(result.rightWeight, 2);
  assert.equal(result.balance, 0);
  assert.ok(result.validCandidates > 0);
});

test("square images follow horizontal-image constraints", () => {
  const result = calculateJournalLayout(["V", "S", "H"]);

  assert.equal(result.sides[0], "left");
  assert.notEqual(result.sides[0], result.sides[1]);
  assert.equal(result.balance, 0);
});

test("missing image classifications fail explicitly", () => {
  assert.throws(
    () => calculateJournalLayout([]),
    /no source images/i,
  );
});
