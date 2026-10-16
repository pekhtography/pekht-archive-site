import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJournalArticleSafely } from "./safe-write.ts";
import { assertCompleteJournalLayout, calculateJournalLayout, calculateJournalLayoutWithCycle } from "../../src/lib/journal-layout-algorithm.ts";

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


test("history breaks equal-balance ties by preferring a different starting side", () => {
  const history = [
    { sides: ["left", "right"] as ("left" | "right")[] },
    { sides: ["left", "left"] as ("left" | "right")[] },
  ];
  const result = calculateJournalLayout(["H", "H"], history);

  assert.equal(result.balance, 0);
  assert.deepEqual(result.sides, ["right", "left"]);
});

test("all short V/H/S orientation combinations satisfy the hard constraints", () => {
  const orientations: ("V" | "H" | "S")[] = ["V", "H", "S"];
  const cases: ("V" | "H" | "S")[][] = [];

  const buildCases = (prefix: ("V" | "H" | "S")[], remaining: number): void => {
    if (remaining === 0) {
      cases.push(prefix);
      return;
    }
    for (const orientation of orientations) {
      buildCases([...prefix, orientation], remaining - 1);
    }
  };

  for (let length = 1; length <= 4; length += 1) {
    buildCases([], length);
  }

  for (const sequence of cases) {
    const result = calculateJournalLayout(sequence);
    assert.equal(result.sides.length, sequence.length, `side count for ${sequence.join("")}`);

    for (let i = 0; i < sequence.length - 1; i += 1) {
      if (sequence[i] === "V" || sequence[i + 1] === "V") {
        assert.notEqual(
          result.sides[i],
          result.sides[i + 1],
          `vertical adjacency constraint for ${sequence.join("")}`,
        );
      }

      const currentIsHorizontal = sequence[i] !== "V";
      const nextIsHorizontal = sequence[i + 1] !== "V";
      if (
        currentIsHorizontal &&
        nextIsHorizontal &&
        result.sides[i] === result.sides[i + 1] &&
        i + 2 < sequence.length
      ) {
        assert.notEqual(
          result.sides[i + 2],
          result.sides[i + 1],
          `horizontal-pair follow-up constraint for ${sequence.join("")}`,
        );
      }
    }
  }

  assert.equal(cases.length, 120);
});


test("complete saved layout passes the integrity gate", () => {
  assert.doesNotThrow(() => assertCompleteJournalLayout("article-ok", [
    { type: "source", image_side: "left" },
    { type: "bridge" },
    { type: "source", image_side: "right" },
  ]));
});

test("incomplete saved layout is rejected with article ID and invalid count", () => {
  assert.throws(
    () => assertCompleteJournalLayout("article-bad", [
      { type: "source", image_side: "left" },
      { type: "source" },
      { type: "source", image_side: "center" },
    ]),
    /article "article-bad": 2 source block\(s\) without valid image_side/,
  );
});

test("incomplete version-1 layout warns with article ID and falls back", () => {
  const component = readFileSync(new URL("../../src/components/static/JournalComposition.astro", import.meta.url), "utf8");
  assert.ok(component.includes('root.dataset.useSavedLayout === "true" && !hasCompleteSavedLayout'));
  assert.ok(component.includes('root.dataset.articleId || "unknown"'));
  assert.ok(component.includes("Falling back to chooseSides()."));
  assert.ok(component.includes("console.warn("));
});

test("ordinary articles retain the chooseSides fallback", () => {
  const component = readFileSync(new URL("../../src/components/static/JournalComposition.astro", import.meta.url), "utf8");
  const start = component.indexOf("<script>");
  const end = component.indexOf("</script>", start);
  const script = component.slice(start, end);
  assert.ok(script.includes("const sides = chooseSides(records)"));
  assert.ok(script.includes('root.dataset.useSavedLayout === "true" && !hasCompleteSavedLayout'));
});

test("orchestrator routes final composition through the tested integrity-gated writer", () => {
  const orchestrator = readFileSync(new URL("../../scripts/journal-orchestrator.ts", import.meta.url), "utf8");
  const safeWriter = readFileSync(new URL("./safe-write.ts", import.meta.url), "utf8");
  assert.ok(orchestrator.includes("writeJournalArticleSafely(slug, finalComposition, outputPath, markdown, writeFileFn)"));
  const gate = safeWriter.indexOf("assertCompleteJournalLayout(articleId, composition)");
  const write = safeWriter.indexOf("await writeFileFn(outputPath, markdown, { encoding: " + '"utf8"' + ', flag: "wx" });');
  assert.ok(gate >= 0 && write > gate);
  assert.ok(safeWriter.includes('flag: "wx"'));
  assert.ok(orchestrator.includes("layout_algorithm_version: 1"));
});


test("orchestrator safe-write path rejects an invalid final layout before creating a file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "journal-gate-new-"));
  const outputPath = join(directory, "article.md");
  try {
    await assert.rejects(
      writeJournalArticleSafely("article-gate-new", [
        { type: "source", image_side: "left" },
        { type: "source" },
      ], outputPath, "must not be written"),
      /Layout integrity violation for article "article-gate-new": 1 source block/,
    );
    assert.equal(existsSync(outputPath), false, "invalid article must not be created");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("orchestrator safe-write path refuses to overwrite an existing article", async () => {
  const directory = mkdtempSync(join(tmpdir(), "journal-gate-existing-"));
  const outputPath = join(directory, "article.md");
  try {
    writeFileSync(outputPath, "original content", "utf8");
    await assert.rejects(
      writeJournalArticleSafely("article-existing", [
        { type: "source", image_side: "left" },
        { type: "source", image_side: "right" },
      ], outputPath, "replacement content"),
      /JOURNAL_OUTPUT_CONFLICT: refusing to overwrite existing publication article-existing\.md/,
    );
    assert.equal(readFileSync(outputPath, "utf8"), "original content");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("orchestrator safe-write path writes a complete final layout", async () => {
  const directory = mkdtempSync(join(tmpdir(), "journal-gate-valid-"));
  const outputPath = join(directory, "article.md");
  try {
    await writeJournalArticleSafely("article-valid", [
      { type: "source", image_side: "left" },
      { type: "bridge" },
      { type: "source", image_side: "right" },
    ], outputPath, "valid markdown");
    assert.equal(readFileSync(outputPath, "utf8"), "valid markdown");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
