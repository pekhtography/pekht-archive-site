import assert from "node:assert/strict";
import testRunner from "node:test";
import {
  assertTraceMatchesLog,
  buildMockCandidates,
  compareCandidates,
  createMockPortfolioFixture,
  runMockPortfolioImplementation,
  runMockNoGalleryScenario,
} from "./implementation.ts";
import { computeCandidateId, validateTestDecision } from "../../../validation/portfolio-validation-0.2.1/src/validators.ts";
import type { DiscoveryRecord } from "../../../validation/portfolio-validation-0.2.1/src/types.ts";

testRunner("mock pipeline executes real stages in order and returns APPROVED", async () => {
  const report = await runMockPortfolioImplementation();
  assert.equal(report.status, "APPROVED");
  assert.deepEqual(report.stages, [
    "SNAPSHOT_VALIDATION", "DISCOVER", "CANDIDATE_GENERATION", "GLOBAL_COMPARISON",
    "COMPOSE", "TEST", "REVISION", "TEST", "FINAL_VALIDATION", "PROCESS_AUDIT", "RESULT",
  ]);
  assert.deepEqual(report.execution_log.map((entry) => entry.sequence), Array.from({ length: report.execution_log.length }, (_, index) => index + 1));
  assert.equal(report.snapshot_posts, 1000);
  assert.equal(report.discovery_records, 1000);
  assert.equal(report.candidates_compared, 2);
  assert.equal(report.selected_candidate_id, report.comparisons[0].candidate_id);
  assert.equal(report.revision_cycles, 1);
  assert.deepEqual(report.test_results.map((entry) => entry.decision), ["FAIL", "PASS"]);
  assert.equal(report.result.validation.status, "PASS");
  assert.equal(report.result.validation.structural, "PASS");
  assert.equal(report.result.validation.semantic, "PASS");
  assert.equal(report.result.validation.process, "PASS");
  assert.deepEqual(report.model_used.map((call) => call.stage), ["COMPOSE", "TEST", "REVISION", "TEST"]);
  assert.equal(new Set(report.model_used.filter((call) => call.stage === "TEST").map((call) => call.call_id)).size, 2);
  assert.ok(report.result.candidate_results?.some((candidate) => candidate.status === "APPROVED"));
  assert.ok(report.model_used.every((call) => call.model.startsWith("mock://")));
  assert.ok(report.comparisons.every((candidate) => candidate.score >= 0 && candidate.score <= 1));
  assert.notEqual(report.comparisons[0].score, 0.94);
  assertTraceMatchesLog(report.execution_log, report.event_trace);
});

testRunner("fixture generation does not execute validation or downstream pipeline stages", () => {
  const fixture = createMockPortfolioFixture();
  assert.equal(fixture.snapshot.posts.length, 1000);
  assert.equal(fixture.validationSnapshot.posts.length, 1000);
  assert.equal("discovery" in fixture, false);
  assert.equal("candidates" in fixture, false);
  assert.equal("testResults" in fixture, false);
});

testRunner("Snapshot Validation failure blocks Discovery", async () => {
  let discoveryCalls = 0;
  const events: string[] = [];
  await assert.rejects(
    runMockPortfolioImplementation({
      validateSnapshot: () => { throw new Error("synthetic snapshot validation failure"); },
      discoverPost: (post) => {
        discoveryCalls += 1;
        return { source_id: post.source_id, result: "NO_SIGNAL", observations: [] };
      },
      onStageEvent: (event) => events.push(`${event.stage}:${event.event}`),
    }),
    /synthetic snapshot validation failure/,
  );
  assert.equal(discoveryCalls, 0);
  assert.deepEqual(events, ["SNAPSHOT_VALIDATION:START"]);
});

testRunner("Discovery coverage failure blocks Candidate Generation", async () => {
  let candidateGenerationCalls = 0;
  const invalidDiscovery = (post: { source_id: string }): DiscoveryRecord => ({
    source_id: post.source_id,
    result: "NO_SIGNAL",
    observations: [{
      prism: "Invalid",
      signal: "invalid",
      interpretation: "NO_SIGNAL cannot contain observations",
      evidence: [{ source: "BODY", quote: "invalid" }],
    }],
  });
  await assert.rejects(
    runMockPortfolioImplementation({
      discoverPost: invalidDiscovery,
      buildCandidates: () => {
        candidateGenerationCalls += 1;
        return [];
      },
    }),
    /Discovery coverage failed/,
  );
  assert.equal(candidateGenerationCalls, 0);
});

testRunner("Candidate Generation consumes the actual validated Discovery records", async () => {
  let observedRecords: DiscoveryRecord[] | undefined;
  const report = await runMockPortfolioImplementation({
    buildCandidates: (snapshot, records, validationSnapshot) => {
      observedRecords = records;
      return buildMockCandidates(snapshot, records, validationSnapshot);
    },
  });
  assert.ok(observedRecords);
  assert.equal(observedRecords.length, 1000);
  assert.equal(observedRecords[0].source_id, "mock-source-0001");
  assert.equal(observedRecords.at(-1)?.source_id, "mock-source-1000");
  assert.equal(observedRecords.filter((record) => record.result === "SIGNALS_FOUND").length, 12);
  assert.equal(observedRecords.filter((record) => record.result === "NO_SIGNAL").length, 988);
});

testRunner("Global Comparison receives the Candidates produced by Candidate Generation", async () => {
  let comparedIds: string[] = [];
  const report = await runMockPortfolioImplementation({
    compareCandidates: (candidates, discovery, snapshot) => {
      comparedIds = candidates.map((candidate) => candidate.candidate_id).sort();
      return compareCandidates(candidates, discovery, snapshot);
    },
  });
  assert.deepEqual(comparedIds, report.comparisons.map((candidate) => candidate.candidate_id).sort());
  assert.equal(comparedIds.length, 2);
});

testRunner("TEST results are created only after COMPOSE and TEST invocation", async () => {
  const report = await runMockPortfolioImplementation();
  const composeComplete = report.event_trace.findIndex((event) => event.stage === "COMPOSE" && event.event === "COMPLETE");
  const firstTestStart = report.event_trace.findIndex((event) => event.stage === "TEST" && event.event === "START");
  assert.ok(composeComplete >= 0 && firstTestStart > composeComplete);
  assert.deepEqual(report.test_results.map((entry) => entry.decision), ["FAIL", "PASS"]);
  assert.ok(report.test_results.every((entry) => validateTestDecision(entry).length === 0));
});

testRunner("REVISION cannot run before an actual TEST rejection", async () => {
  const report = await runMockPortfolioImplementation();
  const rejectedTestComplete = report.event_trace.findIndex((event) => event.stage === "TEST" && event.event === "COMPLETE");
  const revisionStart = report.event_trace.findIndex((event) => event.stage === "REVISION" && event.event === "START");
  assert.ok(rejectedTestComplete >= 0 && revisionStart > rejectedTestComplete);
  assert.equal(report.execution_log.find((entry) => entry.stage === "TEST")?.outcome, "REJECT");
});

testRunner("NO_GALLERY short-circuits after Global Comparison without Compose, TEST or REVISION", async () => {
  const report = await runMockNoGalleryScenario();
  assert.equal(report.status, "NO_GALLERY");
  assert.equal(report.result.gemini_output, null);
  assert.equal(report.result.composition, null);
  assert.equal(report.result.independent_test, null);
  assert.equal(report.result.validation.status, "PASS");
  assert.deepEqual(report.stages, [
    "SNAPSHOT_VALIDATION", "DISCOVER", "CANDIDATE_GENERATION", "GLOBAL_COMPARISON",
    "FINAL_VALIDATION", "PROCESS_AUDIT", "RESULT",
  ]);
  assert.equal(report.selected_candidate_id, null);
  assert.equal(report.test_results.length, 0);
  assert.ok(!report.stages.includes("COMPOSE"));
  assert.ok(!report.stages.includes("TEST"));
  assert.ok(!report.stages.includes("REVISION"));
  assert.ok(report.comparisons.every((candidate) => candidate.score < 0.99));
  assert.equal(report.model_used.length, 0);
  assert.equal(report.execution_log.at(-1)?.outcome, "NO_GALLERY");
});

testRunner("two rejected revisions exhaust the first Candidate and continue to the next", async () => {
  const report = await runMockPortfolioImplementation({
    testDecisions: ["REJECT", "REJECT", "REJECT", "APPROVE"],
  });
  assert.equal(report.status, "APPROVED");
  assert.equal(report.result.candidate_results?.[0].status, "REVISION_EXHAUSTED");
  assert.equal(report.result.candidate_results?.[0].revision_cycles, 2);
  assert.equal(report.result.candidate_results?.[1].status, "APPROVED");
  assert.equal(report.selected_candidate_id, report.result.candidate_results?.[1].candidate_id);
  assert.deepEqual(report.model_used.map((call) => call.stage), [
    "COMPOSE", "TEST", "REVISION", "TEST", "REVISION", "TEST", "COMPOSE", "TEST",
  ]);
  assert.equal(report.result.validation.process, "PASS");
});

testRunner("all shortlisted Candidates exhausted by independent TEST produce NO_GALLERY", async () => {
  const report = await runMockPortfolioImplementation({
    testDecisions: ["REJECT", "REJECT", "REJECT", "REJECT", "REJECT", "REJECT"],
  });
  assert.equal(report.status, "NO_GALLERY");
  assert.equal(report.result.composition, null);
  assert.equal(report.result.independent_test, null);
  assert.deepEqual(report.result.candidate_results?.map((candidate) => candidate.status), [
    "REVISION_EXHAUSTED", "REVISION_EXHAUSTED",
  ]);
  assert.equal(report.result.validation.status, "PASS");
  assert.equal(report.result.validation.process, "PASS");
  assert.equal(report.model_used.filter((call) => call.stage === "TEST").length, 6);
  assert.equal(new Set(report.model_used.filter((call) => call.stage === "TEST").map((call) => call.call_id)).size, 6);
});

testRunner("Process Audit detects a mismatch between actual stage events and the stage log", async () => {
  const report = await runMockPortfolioImplementation();
  const tamperedTrace = report.event_trace.filter((_event, index) => index !== 1);
  assert.throws(() => assertTraceMatchesLog(report.execution_log, tamperedTrace), /event\/log count mismatch/);
  assert.equal(report.result.validation.process, "PASS");
});

testRunner("mock execution is deterministic across repeated runs", async () => {
  assert.deepEqual(await runMockPortfolioImplementation(), await runMockPortfolioImplementation());
  assert.deepEqual(await runMockNoGalleryScenario(), await runMockNoGalleryScenario());
});


testRunner("mock comparison threshold must remain within the normalized score range", async () => {
  await assert.rejects(
    runMockPortfolioImplementation({ minimumPublishScore: 1.01 }),
    /minimumPublishScore must be a finite number between 0 and 1/,
  );
});

testRunner("Candidate identity matches the frozen golden vector", () => {
  assert.equal(
    computeCandidateId("a".repeat(64), ["305", "355", "655", "805", "749", "524"]),
    "cand_4842d793284c56fc53a1e8453133677bc9c85c7e351732a8f13ff9cba87edea1",
  );
});
