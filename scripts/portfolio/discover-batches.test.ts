import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveryResponseSchema, inspectDiscoveryCoverage, selectBatchesToProcess, splitIntoBatches } from "./discover-batches.ts";

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

test("selectBatchesToProcess retries only batches without reusable successes", () => {
  const batches = Array.from({ length: 10 }, (_, index) => [index + 1]);
  const pending = selectBatchesToProcess(batches, [1, 2, 3, 6, 7]);
  assert.deepEqual(pending.flat(), [4, 5, 8, 9, 10]);
});

test("selectBatchesToProcess rejects invalid or duplicate reusable indexes", () => {
  const batches = [[1], [2], [3]];
  assert.throws(() => selectBatchesToProcess(batches, [1, 1]), /unique/);
  assert.throws(() => selectBatchesToProcess(batches, [4]), /valid 1-based/);
});

test("buildDiscoveryResponseSchema restricts source IDs and evidence to the BODY contract", () => {
  const ids = Array.from({ length: 100 }, (_, index) => `source-${index}`);
  const schema = buildDiscoveryResponseSchema(ids) as {
    properties: {
      records: {
        minItems: number;
        maxItems: number;
        items: {
          properties: {
            source_id: { enum: string[] };
            observations: {
              items: {
                properties: {
                  evidence: {
                    items: { properties: { source: { enum: string[] } } };
                  };
                };
              };
            };
          };
        };
      };
    };
  };
  const record = schema.properties.records;
  assert.equal(record.minItems, 100);
  assert.equal(record.maxItems, 100);
  assert.deepEqual(record.items.properties.source_id.enum, ids);
  assert.deepEqual(record.items.properties.observations.items.properties.evidence.items.properties.source.enum, ["BODY"]);
});

test("buildDiscoveryResponseSchema rejects invalid batch ID sets", () => {
  assert.throws(() => buildDiscoveryResponseSchema(["only-one"]), /exactly 100/);
  assert.throws(() => buildDiscoveryResponseSchema(Array(100).fill("duplicate")), /unique/);
});
