import assert from "node:assert/strict";
import test from "node:test";
import {
  runPortfolioOrchestrator,
  type PortfolioOrchestratorInput,
} from "./orchestrator.ts";
import type {
  GeminiOutput,
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
