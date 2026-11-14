// Contract tests for deterministic DISCOVER batching, strict IDs, BODY evidence, and resume selection.
import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveryResponseSchema, inspectDiscoveryCoverage, selectBatchesToProcess, splitIntoBatches, validateDiscoveryEvidenceQuotes } from "./discover-batches.ts";

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
