import test from "node:test";
import assert from "node:assert/strict";
import { chooseJournalSides } from "../src/lib/journal-layout.ts";

test("vertical, horizontal, horizontal starts left and balances as L-R-R", () => {
  const result = chooseJournalSides(["V", "H", "H"], { forceFirstLeft: true });
  assert.deepEqual(result.sides, [0, 1, 1]);
  assert.equal(result.leftWeight, 2);
  assert.equal(result.rightWeight, 2);
  assert.equal(result.balance, 0);
});

test("vertical and horizontal images cannot be adjacent on the same side", () => {
  const result = chooseJournalSides(["V", "H"], { forceFirstLeft: true });
  assert.deepEqual(result.sides, [0, 1]);
});

test("adjacent vertical images must switch sides", () => {
  const result = chooseJournalSides(["V", "V"], { forceFirstLeft: true });
  assert.deepEqual(result.sides, [0, 1]);
});

test("a same-side H-H pair forces the next image to switch", () => {
  const result = chooseJournalSides(["H", "H", "V"], { forceFirstLeft: true });
  assert.notDeepEqual(result.sides, [0, 0, 0]);
  assert.equal(result.sides[0], 0);
  if (result.sides[0] === result.sides[1]) {
    assert.equal(result.sides[2], 1);
  }
});

test("square images follow horizontal adjacency rules and weight", () => {
  const result = chooseJournalSides(["S", "V"], { forceFirstLeft: true });
  assert.deepEqual(result.sides, [0, 1]);
  assert.equal(result.leftWeight, 1);
  assert.equal(result.rightWeight, 2);
});
