import assert from "node:assert/strict";
import testRunner from "node:test";
import {
  createMockPortfolioFixture,
  runMockPortfolioImplementation,
} from "./implementation.ts";
import {
  validateCandidate,
  validateDiscoveryCoverage,
  validateEvidenceAgainstSnapshot,
  validateTestDecision,
} from "../../../validation/portfolio-validation-0.2.1/src/validators.ts";

testRunner("mock implementation executes all nine stages and returns APPROVED", async () => {
  const report = await runMockPortfolioImplementation();
  assert.equal(report.status, "APPROVED");
  assert.deepEqual(report.stages, [
    "SNAPSHOT_VALIDATION",
    "DISCOVER",
    "GLOBAL_COMPARISON",
    "COMPOSE",
    "TEST_REJECT",
    "REVISION",
    "FINAL_VALIDATION",
    "PROCESS_AUDIT",
    "RESULT",
  ]);
  assert.equal(report.snapshot_posts, 1000);
  assert.equal(report.discovery_records, 1000);
  assert.equal(report.candidates_compared, 2);
  assert.equal(report.revision_cycles, 1);
  assert.equal(report.result.validation.status, "PASS");
  assert.equal(report.result.validation.structural, "PASS");
  assert.equal(report.result.validation.semantic, "PASS");
  assert.equal(report.result.validation.process, "PASS");
  assert.ok(report.model_used.every((call) => call.model.startsWith("mock://")));
  assert.deepEqual(
    [...new Set(report.model_used.map((call) => call.stage))].sort(),
    ["COMPOSE", "DISCOVER", "REVISION", "TEST"],
  );
});

testRunner("mock execution is deterministic across repeated runs", async () => {
  const first = await runMockPortfolioImplementation();
  const second = await runMockPortfolioImplementation();
  assert.deepEqual(second, first);
});

testRunner("mock Discovery accounts for every synthetic Snapshot source", () => {
  const fixture = createMockPortfolioFixture();
  assert.deepEqual(validateDiscoveryCoverage(fixture.validationSnapshot, fixture.discovery), []);
  assert.equal(fixture.discovery.length, 1000);
  assert.equal(fixture.discovery.filter((record) => record.result === "SIGNALS_FOUND").length, 12);
  assert.equal(fixture.discovery.filter((record) => record.result === "NO_SIGNAL").length, 988);
});

testRunner("mock Candidates satisfy the frozen identity, evidence and graph contracts", () => {
  const fixture = createMockPortfolioFixture();
  for (const candidate of fixture.candidates) {
    assert.deepEqual(validateCandidate(candidate, fixture.validationSnapshot, fixture.discovery), []);
    assert.deepEqual(
      validateEvidenceAgainstSnapshot(candidate, fixture.validationSnapshot, fixture.discovery),
      [],
    );
  }
});

testRunner("mock validation rejects missing Discovery, altered evidence and invalid PASS scores", () => {
  const fixture = createMockPortfolioFixture();
  assert.ok(validateDiscoveryCoverage(fixture.validationSnapshot, fixture.discovery.slice(1)).length > 0);

  const candidate = structuredClone(fixture.candidates[0]);
  const discovery = structuredClone(fixture.discovery);
  discovery[0].observations[0].evidence[0].quote = "not an exact source quotation";
  assert.ok(validateEvidenceAgainstSnapshot(candidate, fixture.validationSnapshot, discovery).length > 0);

  const invalidPass = {
    ...fixture.testResults[0],
    scores: { ...fixture.testResults[0].scores, evidence_integrity: 4 },
  };
  assert.ok(validateTestDecision(invalidPass).some((issue) => issue.code === "PASS_EVIDENCE_SCORE"));
});
