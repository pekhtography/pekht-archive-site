import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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


test("six-article diagnostic preserves the fixed tulip and applies the 2x2 cycle", () => {
  const history = [{ sides: ["left", "right", "right"] as ("left" | "right")[] }];
  const cases = [
    { number: 2, orientations: ["H", "H", "H", "H", "H"] as ("H" | "V" | "S")[], expected: ["right", "left", "left", "right", "right"], mode: "normal" },
    { number: 3, orientations: ["H", "H", "H", "H", "H"] as ("H" | "V" | "S")[], expected: ["left", "right", "left", "right", "left"], mode: "normal" },
    { number: 4, orientations: ["H", "H", "H", "H"] as ("H" | "V" | "S")[], expected: ["left", "right", "right", "left"], mode: "random" },
    { number: 5, orientations: ["H", "H", "H", "H", "H"] as ("H" | "V" | "S")[], expected: ["right", "left", "left", "right", "right"], mode: "random" },
    { number: 6, orientations: ["V", "H", "H", "V", "H"] as ("H" | "V" | "S")[], expected: ["right", "left", "right", "left", "right"], mode: "normal" },
  ];

  for (const item of cases) {
    const result = calculateJournalLayoutWithCycle(item.orientations, history, item.number, {
      random: () => item.number === 4 ? 0.1 : 0.9,
    });
    assert.equal(result.mode, item.mode);
    assert.deepEqual(result.sides, item.expected);
    assert.ok(result.validCandidates > 0);
    history.push({ sides: result.sides });
  }
});


test("JournalComposition bridges saved-layout mode into the client script", () => {
  const component = readFileSync(
    new URL("../../src/components/static/JournalComposition.astro", import.meta.url),
    "utf8",
  );
  const scriptStart = component.indexOf("<script>");
  const scriptEnd = component.indexOf("</script>", scriptStart);
  const clientScript = component.slice(scriptStart + "<script>".length, scriptEnd);

  assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "client script must exist");
  assert.ok(
    component.includes('data-use-saved-layout={useSavedLayout ? "true" : "false"}'),
    "server-rendered root must expose both saved and normal modes",
  );
  assert.ok(
    clientScript.includes('root.dataset.useSavedLayout === "true"'),
    "client script must read the saved-layout mode from the DOM",
  );
  assert.ok(
    !clientScript.includes("\n            useSavedLayout &&"),
    "Astro frontmatter props must not be referenced directly by the client script",
  );
  assert.ok(
    clientScript.includes('section.dataset.imageSide === "left"') &&
      clientScript.includes('section.dataset.imageSide === "right"'),
    "saved mode must validate both supported side values",
  );
  assert.ok(
    clientScript.includes("const sides = chooseSides(records)"),
    "normal and incomplete-saved modes must retain the client-side fallback",
  );
});
