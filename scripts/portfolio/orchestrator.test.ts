import assert from "node:assert/strict";
import test from "node:test";
import {
  runPortfolioOrchestrator,
  type PortfolioOrchestratorInput,
} from "./orchestrator.ts";
import type {
  GeminiGallery,
  GeminiOutput,
  IndependentTestResponseV132,
  ModelCallRecord,
  ProcessAudit,
} from "./validation/types.ts";
import type {
  JsonSchema,
  PortfolioProviderOptions,
  PortfolioProviderResult,
} from "./provider.ts";
import type { LoadedPortfolioSnapshot, PortfolioSnapshot } from "./snapshot.ts";

const posts = Array.from({ length: 1000 }, (_, index) => ({
  source_id: `source-${index}`,
  x_id: String(1000 + index),
  title: `Title ${index}`,
  body: `Exact publication text ${index} #meaning`,
  hashtags: [] as string[],
  image: `/images/${index}.jpg`,
  created_at: "2025-01-01T00:00:00Z",
  original_markdown: `Original ${index}`,
}));

const snapshot = {
  schema_version: 1 as const,
  purpose: "PEKHTography Portfolio Gemini v1.0 input snapshot" as const,
  generated_at: "2026-11-01T17:22:19.232Z",
  repository_commit: "a".repeat(40),
  sampler: {
    function: "stratifiedSample",
    source_file: "src/lib/stratified-sample.ts",
    sort_function: "sortExploreItems",
    sort_source_file: "src/lib/explore-sort.ts",
    requested_count: 1000,
    random_seed: null,
    reproducibility: "Source records are preserved.",
  },
  archive_markdown_count: 3246,
  active_gallery_exclusions: [],
  cooldown_exclusions: [],
  eligible_archive_count: 3240,
  sampled_count: 1000 as const,
  sampled_source_ids: posts.map((post) => post.source_id),
  content_sha256: "b".repeat(64),
  posts,
} satisfies PortfolioSnapshot;

const loadedSnapshot: LoadedPortfolioSnapshot = {
  snapshot,
  input_snapshot: {
    schema_version: "1",
    repository_commit: snapshot.repository_commit,
    generated_at: snapshot.generated_at,
    sampled_count: 1000,
    content_sha256: snapshot.content_sha256,
  },
};

function makeOutput(overrides: Partial<GeminiOutput> = {}): GeminiOutput {
  const sourceIds = posts.slice(0, 6).map((post) => post.source_id);
  return {
    gallery: {
      source_ids: sourceIds,
      title: "A Shared Measure",
      statement: "Six texts establish a common measure.",
      facets: ["Measure", "Language"],
      roles: sourceIds.map((source_id, index) => ({
        source_id,
        role: `Role ${index}`,
        operation: "Reframing",
        evidence: [{
          quote: posts[index].body,
          interpretation: "The wording establishes the relationship.",
        }],
        necessity: "This publication contributes a distinct movement.",
      })),
      composition_rationale: "The six roles form a coherent progression.",
      alternatives_considered: [],
      doubts: [],
    },
    test: { decision: "APPROVE", findings: [], revision_cycles: 0 },
    ...overrides,
  };
}

function makeAudit(
  overrides: Partial<Omit<ProcessAudit, "modelCalls">> = {},
): Omit<ProcessAudit, "modelCalls"> {
  const sourceIds = posts.slice(0, 6).map((post) => post.source_id);
  return {
    snapshotSourceIds: posts.map((post) => post.source_id),
    processedSourceIds: posts.map((post) => post.source_id),
    candidateIds: ["candidate-1"],
    candidateSourceIdsById: { "candidate-1": sourceIds },
    globalComparisonCompleted: true,
    revisionCyclesByCandidate: { "candidate-1": 0 },
    ...overrides,
  };
}

function modelCall(overrides: Partial<ModelCallRecord> = {}): ModelCallRecord {
  return {
    call_id: "mock-call",
    stage: "TEST",
    candidate_id: "candidate-1",
    model: "mock-model",
    fallback_index: 0,
    attempts: 1,
    outcome: "SUCCESS",
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<PortfolioOrchestratorInput> = {},
): PortfolioOrchestratorInput {
  return {
    snapshotPath: "/unused/snapshot.json",
    prompt: "Apply the Portfolio curatorial instruction.",
    processAudit: makeAudit(),
    candidateId: "candidate-1",
    ...overrides,
  };
}

function dependencies(
  output: unknown = makeOutput(),
  records: ModelCallRecord[] = [modelCall()],
) {
  let capturedPrompt = "";
  let capturedOptions: PortfolioProviderOptions | undefined;
  return {
    get capturedPrompt() { return capturedPrompt; },
    get capturedOptions() { return capturedOptions; },
    dependencies: {
      readSnapshot: async () => loadedSnapshot,
      schema: {} as JsonSchema,
      generate: async (
        prompt: string,
        _schema: JsonSchema,
        options: PortfolioProviderOptions,
      ): Promise<PortfolioProviderResult> => {
        capturedPrompt = prompt;
        capturedOptions = options;
        return { data: output as GeminiOutput, model_used: records };
      },
    },
  };
}

test("approved: runs provider and all validators, returning APPROVED", async () => {
  const harness = dependencies();
  const result = await runPortfolioOrchestrator(makeInput(), harness.dependencies);

  assert.equal(result.status, "APPROVED");
  assert.deepEqual(result.validation, {
    status: "PASS",
    structural: "PASS",
    semantic: "PASS",
    process: "PASS",
    findings: [],
  });
  assert.equal(result.model_used.length, 1);
  assert.match(harness.capturedPrompt, /Exact publication text 0 #meaning/);
  assert.equal(harness.capturedOptions?.stage, "TEST");
  assert.equal(harness.capturedOptions?.candidateId, "candidate-1");
});

test("NO_GALLERY: preserves a valid Gemini rejection as a non-error result", async () => {
  const output: GeminiOutput = {
    gallery: null,
    test: { decision: "REJECT", findings: ["No coherent composition"], revision_cycles: 0 },
  };
  const harness = dependencies(output, [modelCall({ stage: "DISCOVER", candidate_id: null })]);
  const result = await runPortfolioOrchestrator(
    makeInput({ candidateId: undefined, processAudit: makeAudit({ candidateIds: [], candidateSourceIdsById: {}, revisionCyclesByCandidate: {} }) }),
    harness.dependencies,
  );

  assert.equal(result.status, "NO_GALLERY");
  assert.equal(result.validation.status, "PASS");
});

test("semantic failure: rejects a quotation that is not an exact body excerpt", async () => {
  const output = makeOutput();
  output.gallery!.roles[0].evidence[0].quote = "A quotation absent from body";
  const harness = dependencies(output);
  const result = await runPortfolioOrchestrator(makeInput(), harness.dependencies);

  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.validation.structural, "PASS");
  assert.equal(result.validation.semantic, "FAIL");
  assert.ok(result.validation.findings.some((finding) => finding.message.startsWith("QUOTE_NOT_EXACT")));
});

test("structural failure: returns INCOMPLETE without storing malformed Gemini output", async () => {
  const output = {
    ...makeOutput(),
    unexpected: true,
  };
  const harness = dependencies(output);
  const result = await runPortfolioOrchestrator(makeInput(), harness.dependencies);

  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.validation.structural, "FAIL");
  assert.equal(result.gemini_output, null);
});

test("process failure: requires complete corpus processing and global comparison evidence", async () => {
  const harness = dependencies();
  const result = await runPortfolioOrchestrator(
    makeInput({ processAudit: makeAudit({ globalComparisonCompleted: false }) }),
    harness.dependencies,
  );

  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.validation.process, "FAIL");
  assert.ok(result.validation.findings.some((finding) => finding.message === "GLOBAL_COMPARISON_NOT_COMPLETED"));
});

test("provider error: merges prior process audit records with Provider diagnostics", async () => {
  const providerRecord = modelCall({
    call_id: "provider-call",
    outcome: "FAILED",
    attempts: 3,
  });
  const auditRecord = modelCall({
    call_id: "prior-discover-call",
    stage: "DISCOVER",
    candidate_id: null,
    outcome: "SUCCESS",
  });
  const providerError = Object.assign(new Error("mock provider failure"), {
    model_used: [providerRecord],
  });
  const harness = dependencies();
  const failingDependencies = {
    ...harness.dependencies,
    generate: async (
      _prompt: string,
      _schema: JsonSchema,
      _options: PortfolioProviderOptions,
    ): Promise<PortfolioProviderResult> => {
      throw providerError;
    },
  };
  const result = await runPortfolioOrchestrator(
    makeInput({ processAudit: { ...makeAudit(), modelCalls: [auditRecord] } }),
    failingDependencies,
  );

  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.validation.status, "NOT_RUN");
  assert.deepEqual(result.model_used, [auditRecord, providerRecord]);
  assert.equal(result.validation.findings[0].check_id, "PROVIDER_ERROR");
});

test("provider error without diagnostics preserves prior audit records and invents none", async () => {
  const auditRecord = modelCall({
    call_id: "prior-discover-call",
    stage: "DISCOVER",
    candidate_id: null,
    outcome: "SUCCESS",
  });
  const harness = dependencies();
  const failingDependencies = {
    ...harness.dependencies,
    generate: async (
      _prompt: string,
      _schema: JsonSchema,
      _options: PortfolioProviderOptions,
    ): Promise<PortfolioProviderResult> => {
      throw new Error("failure before a model attempt");
    },
  };
  const result = await runPortfolioOrchestrator(
    makeInput({ processAudit: { ...makeAudit(), modelCalls: [auditRecord] } }),
    failingDependencies,
  );

  assert.equal(result.status, "INCOMPLETE");
  assert.deepEqual(result.model_used, [auditRecord]);
});

test("snapshot binding: rejects process audit IDs that differ from the loaded snapshot", async () => {
  const harness = dependencies();
  const mismatchedAudit = makeAudit({
    snapshotSourceIds: [...posts.slice(1).map((post) => post.source_id), "outside-snapshot"],
  });
  const result = await runPortfolioOrchestrator(
    makeInput({ processAudit: mismatchedAudit }),
    harness.dependencies,
  );
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.validation.process, "FAIL");
  assert.ok(result.validation.findings.some((finding) => finding.message.startsWith("AUDIT_SNAPSHOT_MISMATCH")));
});

test("candidate binding: rejects a valid six-post gallery from a different candidate", async () => {
  const harness = dependencies();
  const otherCandidateSources = posts.slice(6, 12).map((post) => post.source_id);
  const result = await runPortfolioOrchestrator(
    makeInput({
      processAudit: makeAudit({
        candidateSourceIdsById: { "candidate-1": otherCandidateSources },
      }),
    }),
    harness.dependencies,
  );
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.validation.semantic, "FAIL");
  assert.ok(result.validation.findings.some((finding) => finding.message.startsWith("GALLERY_CANDIDATE_MISMATCH")));
});

test("revision binding: rejects Gemini revision count that differs from process audit", async () => {
  const harness = dependencies();
  const result = await runPortfolioOrchestrator(
    makeInput({
      processAudit: makeAudit({
        revisionCyclesByCandidate: { "candidate-1": 1 },
      }),
    }),
    harness.dependencies,
  );
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.validation.process, "FAIL");
  assert.ok(result.validation.findings.some((finding) => finding.message.startsWith("REVISION_CYCLE_MISMATCH")));
});


test("standalone lifecycle: COMPOSE is followed by an independent TEST and returns separated result fields", async () => {
  const candidateId = "cand_" + "a".repeat(64);
  const sourceIds = posts.slice(0, 6).map((post) => post.source_id);
  const gallery = makeOutput().gallery!;
  const approvedTest = {
    candidate_id: candidateId,
    decision: "APPROVE" as const,
    scores: { semantic_coherence: 4, curatorial_originality: 4, narrative_integrity: 4, visual_composition: 4, evidence_integrity: 5 },
    findings: [],
    blocking_issues: [],
  };
  const result = await runPortfolioOrchestrator(makeInput({
    candidateId,
    processAudit: makeAudit({
      candidateIds: [candidateId],
      candidateSourceIdsById: { [candidateId]: sourceIds },
      revisionCyclesByCandidate: { [candidateId]: 0 },
    }),
  }), {
    readSnapshot: async () => loadedSnapshot,
    gallerySchema: {},
    independentTestSchema: {},
    compose: async (_prompt, _schema, options) => ({
      data: gallery,
      model_used: [modelCall({ call_id: "standalone-compose", stage: options.stage, candidate_id: candidateId })],
    }),
    evaluateTest: async (_prompt, _schema, options) => ({
      data: approvedTest,
      model_used: [modelCall({ call_id: "standalone-test", stage: "TEST", candidate_id: options.candidateId })],
    }),
  });

  assert.equal(result.status, "APPROVED");
  assert.equal(result.gemini_output, null);
  assert.deepEqual(result.composition, gallery);
  assert.deepEqual(result.independent_test, approvedTest);
  assert.equal(result.candidate_results?.[0].status, "APPROVED");
  assert.deepEqual(result.model_used.map((call) => call.stage), ["COMPOSE", "TEST"]);
});


const standaloneCandidateId = "cand_" + "a".repeat(64);
const standaloneSourceIds = posts.slice(0, 6).map((post) => post.source_id);
const standaloneGallery = makeOutput().gallery!;
function standaloneInput(candidateIds = [standaloneCandidateId]) {
  return makeInput({
    candidateId: undefined,
    processAudit: makeAudit({
      candidateIds,
      candidateSourceIdsById: Object.fromEntries(candidateIds.map((id) => [id, standaloneSourceIds])),
      revisionCyclesByCandidate: Object.fromEntries(candidateIds.map((id) => [id, 0])),
    }),
  });
}
function independentTest(
  decision: "APPROVE" | "REJECT",
  candidateId = standaloneCandidateId,
) {
  return {
    candidate_id: candidateId,
    decision,
    scores: {
      semantic_coherence: 4,
      curatorial_originality: 4,
      narrative_integrity: 4,
      visual_composition: 4,
      evidence_integrity: decision === "APPROVE" ? 5 : 4,
    },
    findings: decision === "APPROVE" ? [] : [{
      criterion: "semantic_coherence" as const,
      issue: "The composition does not yet establish a coherent relation.",
      blocking: true,
      evidence: { kind: "SOURCE" as const, source_id: standaloneSourceIds[0], quote: posts[0].body },
    }],
    blocking_issues: decision === "APPROVE" ? [] : ["The composition does not yet establish a coherent relation."],
  };
}
function standaloneDependencies(options: {
  compose?: (stage: "COMPOSE" | "REVISION", call: number) => unknown;
  evaluate?: (call: number) => unknown;
} = {}) {
  let composeCount = 0;
  let testCount = 0;
  return {
    dependencies: {
      readSnapshot: async () => loadedSnapshot,
      gallerySchema: {},
      independentTestSchema: {},
      compose: async (_prompt: string, _schema: JsonSchema, providerOptions: PortfolioProviderOptions) => {
        const call = ++composeCount;
        const stage = providerOptions.stage as "COMPOSE" | "REVISION";
        const data = options.compose ? options.compose(stage, call) : standaloneGallery;
        return {
          data: data as GeminiGallery,
          model_used: [modelCall({
            call_id: `compose-${call}`,
            stage,
            candidate_id: standaloneCandidateId,
          })],
        };
      },
      evaluateTest: async (_prompt: string, _schema: JsonSchema, providerOptions: PortfolioProviderOptions) => {
        const call = ++testCount;
        const data = options.evaluate ? options.evaluate(call) : independentTest("APPROVE");
        return {
          data: data as IndependentTestResponseV132,
          model_used: [modelCall({
            call_id: `test-${call}`,
            stage: "TEST",
            candidate_id: providerOptions.candidateId as string,
          })],
        };
      },
    },
  };
}

test("standalone lifecycle: malformed independent TEST is INCOMPLETE and stops candidate processing", async () => {
  const harness = standaloneDependencies({
    evaluate: () => ({ ...independentTest("APPROVE"), candidate_id: "cand_" + "b".repeat(64) }),
  });
  const result = await runPortfolioOrchestrator(standaloneInput([standaloneCandidateId, "cand_" + "b".repeat(64)]), harness.dependencies);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.candidate_results?.[0].status, "INCOMPLETE");
  assert.equal(result.candidate_results?.length, 1);
  assert.equal(result.independent_test, null);
  assert.equal(result.validation.status, "FAIL");
  assert.ok(result.candidate_results?.[0].findings.some((finding) => finding.includes("candidate_id")));
});

test("standalone lifecycle: provider fallback exhaustion preserves real diagnostics and returns INCOMPLETE", async () => {
  const harness = standaloneDependencies();
  const failedCall = modelCall({
    call_id: "test-fallback",
    stage: "TEST",
    candidate_id: standaloneCandidateId,
    fallback_index: 0,
    outcome: "FAILED",
    attempts: 3,
  });
  const failure = Object.assign(new Error("all configured TEST providers failed"), { model_used: [failedCall] });
  const dependenciesWithFailure = {
    ...harness.dependencies,
    evaluateTest: async () => { throw failure; },
  };
  const result = await runPortfolioOrchestrator(standaloneInput(), dependenciesWithFailure);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.validation.status, "FAIL");
  assert.ok(result.model_used.some((call) => call.call_id === "test-fallback" && call.outcome === "FAILED"));
  assert.equal(result.model_used.filter((call) => call.stage === "TEST").length, 1);
});

test("standalone lifecycle: candidate/source mismatch is rejected before independent TEST", async () => {
  const harness = standaloneDependencies({
    compose: () => ({ ...standaloneGallery, source_ids: posts.slice(6, 12).map((post) => post.source_id) }),
  });
  const result = await runPortfolioOrchestrator(standaloneInput(), harness.dependencies);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.validation.semantic, "FAIL");
  assert.equal(result.model_used.filter((call) => call.stage === "TEST").length, 0);
  assert.ok(result.validation.findings.some((finding) => finding.message.startsWith("GALLERY_CANDIDATE_MISMATCH")));
});

test("standalone lifecycle: structurally malformed COMPOSE is INCOMPLETE", async () => {
  const harness = standaloneDependencies({ compose: () => ({ ...standaloneGallery, unexpected: true }) });
  const result = await runPortfolioOrchestrator(standaloneInput(), harness.dependencies);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.validation.structural, "FAIL");
  assert.equal(result.model_used.filter((call) => call.stage === "TEST").length, 0);
});

test("standalone lifecycle: semantically invalid REVISION is INCOMPLETE and does not run another TEST", async () => {
  const harness = standaloneDependencies({
    compose: (stage) => stage === "COMPOSE"
      ? standaloneGallery
      : { ...standaloneGallery, roles: standaloneGallery.roles.map((role, index) =>
          index === 0 ? { ...role, evidence: [{ ...role.evidence[0], quote: "fabricated quotation" }] } : role) },
    evaluate: (call) => independentTest(call === 1 ? "REJECT" : "APPROVE"),
  });
  const result = await runPortfolioOrchestrator(standaloneInput(), harness.dependencies);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.validation.semantic, "FAIL");
  assert.deepEqual(result.model_used.map((call) => call.stage), ["COMPOSE", "TEST", "REVISION"]);
});

test("standalone lifecycle: fallback attempts share one TEST call_id; post-REVISION TEST gets a new ID", async () => {
  const harness = standaloneDependencies({
    evaluate: (call) => independentTest(call === 1 ? "REJECT" : "APPROVE"),
  });
  const originalEvaluate = harness.dependencies.evaluateTest;
  const dependenciesWithFallback = {
    ...harness.dependencies,
    evaluateTest: async (prompt: string, schema: JsonSchema, options: PortfolioProviderOptions) => {
      const result = await originalEvaluate(prompt, schema, options);
      const invocation = result.model_used[0].call_id;
      return {
        ...result,
        model_used: [
          { ...result.model_used[0], call_id: invocation, fallback_index: 0, outcome: "FALLBACK" as const },
          { ...result.model_used[0], call_id: invocation, fallback_index: 1, outcome: "SUCCESS" as const },
        ],
      };
    },
  };
  const result = await runPortfolioOrchestrator(standaloneInput(), dependenciesWithFallback);
  assert.equal(result.status, "APPROVED");
  const testCalls = result.model_used.filter((call) => call.stage === "TEST");
  assert.equal(testCalls.length, 4);
  assert.equal(testCalls[0].call_id, testCalls[1].call_id);
  assert.equal(testCalls[2].call_id, testCalls[3].call_id);
  assert.notEqual(testCalls[0].call_id, testCalls[2].call_id);
});
