import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  REJECTION_STAGES,
  formatRejectionSummary,
  recordRejection,
  type RejectionReasons,
} from "./rejection-reasons.ts";

test("stores a rejection stage separately from its reason", () => {
  const reasons: RejectionReasons = new Map();
  recordRejection(reasons, "candidate-1", "MONTAGE", "MONTAGE_SOURCE_COUNT_INVALID");
  assert.deepEqual(reasons.get("candidate-1"), {
    stage: "MONTAGE",
    reason: "MONTAGE_SOURCE_COUNT_INVALID",
  });
});

test("defines exactly the five approved rejection stages", () => {
  assert.deepEqual(REJECTION_STAGES, [
    "DISCOVER",
    "SELECT-MONTAGE",
    "MONTAGE",
    "REVISION",
    "TEST",
  ]);
});

test("formats the rejection summary as ID [STAGE]: reason", () => {
  const reasons: RejectionReasons = new Map();
  recordRejection(reasons, "candidate-2", "MONTAGE", "MONTAGE_SOURCE_COUNT_INVALID");
  recordRejection(reasons, "candidate-3", "TEST", "TEST rejected: weak ending");
  assert.deepEqual(formatRejectionSummary(reasons), [
    "- candidate-2 [MONTAGE]: MONTAGE_SOURCE_COUNT_INVALID",
    "- candidate-3 [TEST]: TEST rejected: weak ending",
  ]);
});

test("assigns the approved stage at all seven orchestrator rejection call sites", async () => {
  const orchestratorPath = fileURLToPath(
    new URL("../journal-orchestrator.ts", import.meta.url),
  );
  const source = await readFile(orchestratorPath, "utf8");
  const callPatterns = [
    /reject\(\s*selectedId,\s*"DISCOVER",\s*"DISCOVER candidate failed source validation",?\s*\)/s,
    /reject\(\s*selectedId,\s*"SELECT-MONTAGE",[\s\S]{0,120}candidate_id mismatch/s,
    /reject\(\s*selectedId,\s*"MONTAGE",\s*validation\.reason\s*\)/s,
    /reject\(\s*selectedId,\s*"MONTAGE",\s*"identical montage repeated",?\s*\)/s,
    /reject\(\s*selectedId,\s*"REVISION",\s*"revision limit exceeded",?\s*\)/s,
    /reject\(\s*selectedId,\s*"REVISION",\s*"repeated revision instruction",?\s*\)/s,
    /reject\(\s*selectedId,\s*"TEST",[\s\S]{0,100}TEST rejected: \$\{task3\.reason\}/s,
  ];

  assert.equal(source.match(/^\s*reject\(/gm)?.length, 7);
  for (const pattern of callPatterns) {
    assert.match(source, pattern);
  }
});
