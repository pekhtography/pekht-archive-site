import test from "node:test";
import assert from "node:assert/strict";
import { inspectDiscoveryCoverage, splitIntoBatches } from "./discover-batches.ts";

test("splitIntoBatches preserves order and covers every item exactly once", () => {
  const batches = splitIntoBatches(Array.from({ length: 205 }, (_, index) => index), 100);
  assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 5]);
  assert.deepEqual(batches.flat(), Array.from({ length: 205 }, (_, index) => index));
});

test("splitIntoBatches rejects invalid sizes", () => {
  assert.throws(() => splitIntoBatches([1, 2], 0), /positive integer/);
});

test("inspectDiscoveryCoverage orders complete records and detects missing, duplicate, unexpected IDs", () => {
  const coverage = inspectDiscoveryCoverage(["a", "b", "c"], [
    { source_id: "c" },
    { source_id: "a" },
    { source_id: "a" },
    { source_id: "outside" },
  ]);
  assert.deepEqual(coverage.orderedRecords.map((record) => record.source_id), ["a", "c"]);
  assert.deepEqual(coverage.missingSourceIds, ["a", "b"]);
  assert.deepEqual(coverage.duplicateSourceIds, ["a"]);
  assert.deepEqual(coverage.unexpectedSourceIds, ["outside"]);
});

test("inspectDiscoveryCoverage accepts exact unique coverage", () => {
  const coverage = inspectDiscoveryCoverage(["a", "b"], [
    { source_id: "b" },
    { source_id: "a" },
  ]);
  assert.deepEqual(coverage.missingSourceIds, []);
  assert.deepEqual(coverage.duplicateSourceIds, []);
  assert.deepEqual(coverage.unexpectedSourceIds, []);
  assert.deepEqual(coverage.orderedRecords.map((record) => record.source_id), ["a", "b"]);
});
