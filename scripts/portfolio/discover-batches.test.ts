// Contract tests for deterministic DISCOVER batching, strict IDs, BODY evidence, and resume selection.
import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveryResponseSchema, inspectDiscoveryCoverage, mapDiscoverySourceIndexes, selectBatchesToProcess, splitIntoBatches, validateDiscoveryEvidenceQuotes } from "./discover-batches.ts";

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

test("buildDiscoveryResponseSchema uses an integer source index and retains BODY-only evidence", () => {
  const schema = buildDiscoveryResponseSchema() as {
    properties: {
      records: {
        items: {
          required: string[];
          properties: {
            source_index: { type: string };
            source_id?: unknown;
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
  const record = schema.properties.records.items;
  assert.ok(record.required.includes("source_index"));
  assert.equal(record.properties.source_index.type, "integer");
  assert.equal("source_id" in record.properties, false);
  assert.deepEqual(record.properties.observations.items.properties.evidence.items.properties.source.enum, ["BODY"]);
});


test("validateDiscoveryEvidenceQuotes accepts only exact contiguous BODY substrings", () => {
  const posts = [
    { source_id: "a", body: "Red flowers planted in perfect circles 🌺 — the city said: even chaos needs a geometry." },
    { source_id: "b", body: "A hundred years of footsteps — same destination, different soles." },
  ];
  const records = [
    { source_id: "a", observations: [{ evidence: [{ source: "BODY", quote: "Red flowers planted in perfect circles 🌺" }] }] },
    { source_id: "b", observations: [{ evidence: [{ source: "BODY", quote: "same destination, different soles." }] }] },
  ];
  assert.deepEqual(validateDiscoveryEvidenceQuotes(records, posts), []);
});

test("validateDiscoveryEvidenceQuotes rejects paraphrase, omission, emoji loss, and reordered fragments", () => {
  const posts = [
    { source_id: "a", body: "Red flowers planted in perfect circles 🌺 — the city said: even chaos needs a geometry." },
  ];
  const records = [
    { source_id: "a", observations: [
      { evidence: [{ source: "BODY", quote: "Red flowers planted in circles" }] },
      { evidence: [{ source: "BODY", quote: "the city said: even chaos needs geometry." }] },
      { evidence: [{ source: "BODY", quote: "Red flowers planted in perfect circles — 🌺" }] },
    ] },
  ];
  const issues = validateDiscoveryEvidenceQuotes(records, posts);
  assert.equal(issues.length, 3);
  assert.ok(issues.every((issue) => issue.code === "DISCOVERY_EVIDENCE_QUOTE_NOT_FOUND"));
});

test("validateDiscoveryEvidenceQuotes does not treat non-BODY evidence as BODY quotes", () => {
  const issues = validateDiscoveryEvidenceQuotes(
    [{ source_id: "a", observations: [{ evidence: [{ source: "ORIGINAL_MARKDOWN", quote: "not in body" }] }] }],
    [{ source_id: "a", body: "body text" }]
  );
  assert.deepEqual(issues, []);
});

test("mapDiscoverySourceIndexes maps valid positions to exact Snapshot source IDs", () => {
  const batch = [{ source_id: "post-001" }, { source_id: "post-002" }, { source_id: "post-003" }];
  const mapped = mapDiscoverySourceIndexes([
    { source_index: 0, result: "NO_SIGNAL", observations: [] },
    { source_index: 1, result: "NO_SIGNAL", observations: [] },
    { source_index: 2, result: "NO_SIGNAL", observations: [] },
  ], batch);
  assert.deepEqual(mapped.map((record) => record.source_id), ["post-001", "post-002", "post-003"]);
  assert.ok(mapped.every((record) => !("source_index" in record)));
});

test("mapDiscoverySourceIndexes preserves mapping when Gemini returns records out of order", () => {
  const batch = [{ source_id: "post-A" }, { source_id: "post-B" }, { source_id: "post-C" }];
  const mapped = mapDiscoverySourceIndexes([
    { source_index: 2, result: "NO_SIGNAL", observations: [] },
    { source_index: 0, result: "NO_SIGNAL", observations: [] },
    { source_index: 1, result: "NO_SIGNAL", observations: [] },
  ], batch);
  assert.deepEqual(mapped.map((record) => record.source_id), ["post-C", "post-A", "post-B"]);
  const coverage = inspectDiscoveryCoverage(["post-A", "post-B", "post-C"], mapped);
  assert.deepEqual(coverage.missingSourceIds, []);
  assert.deepEqual(coverage.duplicateSourceIds, []);
  assert.deepEqual(coverage.unexpectedSourceIds, []);
});

test("mapDiscoverySourceIndexes leaves duplicate indexes detectable by coverage validation", () => {
  const batch = [{ source_id: "post-A" }, { source_id: "post-B" }];
  const mapped = mapDiscoverySourceIndexes([
    { source_index: 0, result: "NO_SIGNAL", observations: [] },
    { source_index: 0, result: "NO_SIGNAL", observations: [] },
  ], batch);
  const coverage = inspectDiscoveryCoverage(["post-A", "post-B"], mapped);
  assert.deepEqual(coverage.duplicateSourceIds, ["post-A"]);
  assert.deepEqual(coverage.missingSourceIds, ["post-A", "post-B"]);
});

test("mapDiscoverySourceIndexes rejects negative and out-of-range indexes through coverage", () => {
  const batch = [{ source_id: "post-A" }, { source_id: "post-B" }];
  const mapped = mapDiscoverySourceIndexes([
    { source_index: -1, result: "NO_SIGNAL", observations: [] },
    { source_index: 2, result: "NO_SIGNAL", observations: [] },
  ], batch);
  const coverage = inspectDiscoveryCoverage(["post-A", "post-B"], mapped);
  assert.deepEqual(mapped.map((record) => record.source_id), ["", ""]);
  assert.deepEqual(coverage.unexpectedSourceIds, ["[missing-source-id]", "[missing-source-id]"]);
  assert.deepEqual(coverage.missingSourceIds, ["post-A", "post-B"]);
});
