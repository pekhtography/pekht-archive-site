import assert from "node:assert/strict";
import test from "node:test";
import { calculateJournalLayout, calculateJournalLayoutWithCycle } from "../../src/lib/journal-layout-algorithm.ts";

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


test("layout cycle follows normal, normal, random, random and repeats", () => {
  const modes = [2, 3, 4, 5, 6, 7].map((articleNumber) =>
    calculateJournalLayoutWithCycle(["H", "H", "H", "H"], [], articleNumber, {
      random: () => 0.9,
    }).mode,
  );

  assert.deepEqual(modes, ["normal", "normal", "random", "random", "normal", "normal"]);
});

test("random slot independently inverts all sides when coin toss is below 0.5", () => {
  const normal = calculateJournalLayoutWithCycle(["H", "H", "H", "H"], [], 2);
  const random = calculateJournalLayoutWithCycle(["H", "H", "H", "H"], [], 4, {
    random: () => 0.1,
  });

  assert.equal(random.mode, "random");
  assert.equal(random.inverted, true);
  assert.deepEqual(random.sides, normal.sides.map((side) => side === "left" ? "right" : "left"));
  assert.equal(random.balance, normal.balance);
});

test("disabling the cycle preserves the optimizer and prevents random inversion", () => {
  const baseline = calculateJournalLayout(["H", "H", "H", "H"]);
  const disabled = calculateJournalLayoutWithCycle(["H", "H", "H", "H"], [], 4, {
    enabled: false,
    random: () => 0,
  });

  assert.equal(disabled.mode, "normal");
  assert.equal(disabled.inverted, false);
  assert.deepEqual(disabled.sides, baseline.sides);
});
