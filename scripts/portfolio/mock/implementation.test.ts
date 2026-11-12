import assert from "node:assert/strict";
import testRunner from "node:test";
import {
  compareCandidates,
  createMockPortfolioFixture,
  runMockPortfolioImplementation,
  runMockNoGalleryScenario,
} from "./implementation.ts";
import { computeCandidateId } from "../../../validation/portfolio-validation-0.2.1/src/validators.ts";
import {
  validateCandidate,
  validateDiscoveryCoverage,
  validateEvidenceAgainstSnapshot,
  validateTestDecision,
} from "../../../validation/portfolio-validation-0.2.1/src/validators.ts";

testRunner("mock implementation executes each pipeline stage and returns APPROVED", async () => {
  const report = await runMockPortfolioImplementation();
  assert.equal(report.status, "APPROVED");
  assert.deepEqual(report.stages, [
    "SNAPSHOT_VALIDATION", "DISCOVER", "GLOBAL_COMPARISON", "COMPOSE", "TEST",
    "REVISION", "FINAL_VALIDATION", "PROCESS_AUDIT", "RESULT",
  ]);
  assert.deepEqual(report.execution_log.map((entry) => entry.sequence), [1,2,3,4,5,6,7,8,9]);
  assert.equal(report.snapshot_posts, 1000);
  assert.equal(report.discovery_records, 1000);
  assert.equal(report.candidates_compared, 2);
  assert.equal(report.selected_candidate_id, report.comparisons[0].candidate_id);
  assert.equal(report.revision_cycles, 1);
  assert.equal(report.result.validation.status, "PASS");
  assert.equal(report.result.validation.structural, "PASS");
  assert.equal(report.result.validation.semantic, "PASS");
  assert.equal(report.result.validation.process, "PASS");
  assert.ok(report.model_used.every((call) => call.model.startsWith("mock://")));
  assert.ok(report.comparisons.every((candidate) => candidate.score >= 0 && candidate.score <= 1));
  assert.notEqual(report.comparisons[0].score, 0.94);
});

testRunner("mock execution is deterministic across repeated runs", async () => {
  assert.deepEqual(await runMockPortfolioImplementation(), await runMockPortfolioImplementation());
});

testRunner("mock Discovery accounts for all 1,000 synthetic Snapshot sources", () => {
  const fixture = createMockPortfolioFixture();
  assert.deepEqual(validateDiscoveryCoverage(fixture.validationSnapshot, fixture.discovery), []);
  assert.equal(fixture.discovery.length, 1000);
  assert.equal(fixture.discovery.filter((record) => record.result === "SIGNALS_FOUND").length, 12);
  assert.equal(fixture.discovery.filter((record) => record.result === "NO_SIGNAL").length, 988);
});

testRunner("Candidate identity matches the frozen golden vector", () => {
  assert.equal(
    computeCandidateId("a".repeat(64), ["305", "355", "655", "805", "749", "524"]),
    "cand_4842d793284c56fc53a1e8453133677bc9c85c7e351732a8f13ff9cba87edea1",
  );
});

testRunner("mock Candidates satisfy identity, exact evidence and graph contracts", () => {
  const fixture = createMockPortfolioFixture();
  for (const candidate of fixture.candidates) {
    assert.deepEqual(validateCandidate(candidate, fixture.validationSnapshot, fixture.discovery), []);
    assert.deepEqual(validateEvidenceAgainstSnapshot(candidate, fixture.validationSnapshot, fixture.discovery), []);
  }
});

testRunner("Global Comparison derives its ranking from Candidate features", () => {
  const fixture = createMockPortfolioFixture();
  const ranked = compareCandidates(fixture.candidates, fixture.discovery, fixture.snapshot);
  assert.equal(ranked.length, 2);
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.notDeepEqual(ranked[0].features, ranked[1].features);
});

testRunner("mock TestResult PASS requires every frozen score threshold", () => {
  const fixture = createMockPortfolioFixture();
  assert.deepEqual(validateTestDecision(fixture.testResults[0]), []);
  const invalidPass = {
    ...fixture.testResults[0],
    scores: { ...fixture.testResults[0].scores, evidence_integrity: 4 },
  };
  assert.ok(validateTestDecision(invalidPass).some((issue) => issue.code === "PASS_EVIDENCE_SCORE"));
});

testRunner("NO_GALLERY follows Discovery and Global Comparison with no selected Candidate", async () => {
  const report = await runMockNoGalleryScenario();
  assert.equal(report.status, "NO_GALLERY");
  assert.equal(report.result.gemini_output?.gallery, null);
  assert.equal(report.result.validation.status, "PASS");
  assert.deepEqual(report.stages, [
    "SNAPSHOT_VALIDATION", "DISCOVER", "GLOBAL_COMPARISON", "PROCESS_AUDIT", "RESULT",
  ]);
  assert.equal(report.selected_candidate_id, null);
  assert.equal(report.execution_log[2].outcome, "NO_CANDIDATE");
  assert.equal(report.execution_log[2].input_count, 2);
  assert.equal(report.execution_log[2].output_count, 0);
  assert.ok(report.comparisons.every((candidate) => candidate.score < 1.01));
  assert.equal(report.model_used.length, 1);
  assert.equal(report.model_used[0].stage, "DISCOVER");
});
