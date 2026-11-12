import { createHash } from "node:crypto";
import { runPortfolioOrchestrator } from "../orchestrator.ts";
import { validatePortfolioSnapshot, type LoadedPortfolioSnapshot, type PortfolioSnapshot } from "../snapshot.ts";
import { validateGeminiOutput, validatePortfolioSemantics, validatePortfolioProcess } from "../validation/index.ts";
import type { GeminiOutput, ModelCallRecord, ProcessAudit } from "../validation/types.ts";
import {
  computeCandidateId,
  validateCandidate,
  validateDiscoveryCoverage,
  validateTestDecision,
} from "../../../validation/portfolio-validation-0.2.1/src/validators.ts";
import type {
  Candidate,
  DiscoveryRecord,
  Snapshot as ValidationSnapshot,
  TestResult,
} from "../../../validation/portfolio-validation-0.2.1/src/types.ts";

const GENERATED_AT = "2026-11-12T00:00:00.000Z";
const REPOSITORY_COMMIT = "a".repeat(40);
const POST_COUNT = 1000;

const thematicGroups = [
  [
    "The first light measures the room in silence.",
    "A shadow stretches beyond the hour marked on the wall.",
    "The river carries yesterday beneath today's bridge.",
    "A window holds the last blue minute of evening.",
    "The station clock pauses while footsteps continue.",
    "At dawn, the street returns every borrowed color.",
  ],
  [
    "A folded map keeps the pressure of an absent hand.",
    "The envelope waits with its corners turned inward.",
    "A pencil line crosses the distance between two names.",
    "The paper remembers a crease after the letter is gone.",
    "An empty margin becomes a place to begin again.",
    "The notebook closes around a sentence left unfinished.",
  ],
] as const;

const groupIds = [
  Array.from({ length: 6 }, (_, index) => `mock-source-${String(index + 1).padStart(4, "0")}`),
  Array.from({ length: 6 }, (_, index) => `mock-source-${String(index + 7).padStart(4, "0")}`),
];

function hashSnapshot(posts: PortfolioSnapshot["posts"], ids: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ sampled_source_ids: ids, posts }), "utf8")
    .digest("hex");
}

function buildSnapshot(): PortfolioSnapshot {
  const specialBodies = new Map<string, string>();
  groupIds.forEach((ids, groupIndex) => {
    ids.forEach((id, index) => specialBodies.set(id, thematicGroups[groupIndex][index]));
  });

  const posts = Array.from({ length: POST_COUNT }, (_, index) => {
    const source_id = `mock-source-${String(index + 1).padStart(4, "0")}`;
    const body = specialBodies.get(source_id) ?? `Synthetic control publication ${index + 1}: an ordinary observation with no qualifying curatorial signal.`;
    return {
      source_id,
      x_id: `mock-x-${String(index + 1).padStart(4, "0")}`,
      title: `Synthetic publication ${index + 1}`,
      body,
      hashtags: [] as string[],
      image: `/mock-only/${source_id}.jpg`,
      created_at: "2025-01-01T00:00:00.000Z",
      original_markdown: `---\nsource_id: ${source_id}\n---\n\n${body}`,
    };
  });
  const sampled_source_ids = posts.map((post) => post.source_id);
  return {
    schema_version: 1,
    purpose: "PEKHTography Portfolio Gemini v1.0 input snapshot",
    generated_at: GENERATED_AT,
    repository_commit: REPOSITORY_COMMIT,
    sampler: {
      function: "deterministicMockSampler",
      source_file: "scripts/portfolio/mock/implementation.ts",
      sort_function: "stableSourceOrder",
      sort_source_file: "scripts/portfolio/mock/implementation.ts",
      requested_count: POST_COUNT,
      random_seed: 0,
      reproducibility: "Synthetic fixture; deterministic and never read from the live archive.",
    },
    archive_markdown_count: POST_COUNT,
    active_gallery_exclusions: [],
    cooldown_exclusions: [],
    eligible_archive_count: POST_COUNT,
    sampled_count: POST_COUNT,
    sampled_source_ids,
    content_sha256: hashSnapshot(posts, sampled_source_ids),
    posts,
  };
}

function buildDiscovery(snapshot: PortfolioSnapshot): DiscoveryRecord[] {
  const signalById = new Map<string, { prism: string; signal: string }>();
  groupIds.forEach((ids, groupIndex) => ids.forEach((id, index) => {
    signalById.set(id, {
      prism: groupIndex === 0 ? "Time" : "Material",
      signal: groupIndex === 0 ? `temporal image ${index + 1}` : `paper trace ${index + 1}`,
    });
  }));

  return snapshot.posts.map((post): DiscoveryRecord => {
    const signal = signalById.get(post.source_id);
    if (!signal) return { source_id: post.source_id, result: "NO_SIGNAL", observations: [] };
    return {
      source_id: post.source_id,
      result: "SIGNALS_FOUND",
      observations: [{
        prism: signal.prism,
        signal: signal.signal,
        interpretation: `The publication expresses ${signal.signal} in its own wording.`,
        evidence: [{ source: "BODY", quote: post.body }],
      }],
    };
  });
}

function buildCandidate(sourceIds: string[], snapshot: PortfolioSnapshot): Candidate {
  const observationIds = sourceIds.map((id) => `${id}:0`);
  const relationships = sourceIds.slice(0, -1).map((sourceId, index) => ({
    source_a: sourceId,
    source_b: sourceIds[index + 1],
    type: "SEQUENCE",
    explanation: "Adjacent observations form a continuous synthetic curatorial path.",
    observation_ids: [observationIds[index], observationIds[index + 1]],
  }));
  return {
    candidate_id: computeCandidateId(snapshot.content_sha256, sourceIds),
    source_ids: [...sourceIds],
    observation_ids: observationIds,
    relationships,
  };
}

function modelCall(
  callId: string,
  stage: ModelCallRecord["stage"],
  candidateId: string | null,
): ModelCallRecord {
  return {
    call_id: callId,
    stage,
    candidate_id: candidateId,
    model: "mock://deterministic-fixture",
    fallback_index: 0,
    attempts: 1,
    outcome: "SUCCESS",
  };
}

function buildGallery(snapshot: PortfolioSnapshot, sourceIds: string[]): NonNullable<GeminiOutput["gallery"]> {
  const posts = new Map(snapshot.posts.map((post) => [post.source_id, post]));
  const roles = sourceIds.map((source_id, index) => {
    const post = posts.get(source_id);
    if (!post) throw new Error(`Mock fixture is missing ${source_id}`);
    return {
      source_id,
      role: [
        "Establishes the opening measure",
        "Introduces a counterforce",
        "Carries the transition",
        "Holds the visual threshold",
        "Interrupts the expected rhythm",
        "Resolves the sequence without closing it",
      ][index],
      operation: "Reframing",
      evidence: [{
        quote: post.body,
        interpretation: "The exact publication wording supports this role in the sequence.",
      }],
      necessity: "Removing this source would break one distinct movement in the six-part progression.",
    };
  });

  return {
    source_ids: [...sourceIds],
    title: "The Measure of Passing Light",
    statement: "Time becomes visible when light, shadow, and movement leave their marks on ordinary places.",
    facets: ["Time", "Light", "Movement", "Threshold"],
    roles,
    composition_rationale: "Six distinct textual observations move from first light through interruption to dawn.",
    alternatives_considered: ["A purely chronological sequence", "A sequence organized only by color"],
    doubts: [],
  };
}

export interface MockPortfolioReport {
  status: "APPROVED" | "NO_GALLERY" | "INCOMPLETE";
  stages: string[];
  snapshot_posts: number;
  discovery_records: number;
  candidates_compared: number;
  selected_candidate_id: string;
  revision_cycles: number;
  model_used: ModelCallRecord[];
  result: Awaited<ReturnType<typeof runPortfolioOrchestrator>>;
}

export interface MockPortfolioFixture {
  snapshot: PortfolioSnapshot;
  validationSnapshot: ValidationSnapshot;
  discovery: DiscoveryRecord[];
  candidates: Candidate[];
  testResults: TestResult[];
}

export function createMockPortfolioFixture(): MockPortfolioFixture {
  const snapshot = buildSnapshot();
  if (!validatePortfolioSnapshot(snapshot)) throw new Error("Synthetic Snapshot validation failed");
  const validationSnapshot: ValidationSnapshot = {
    content_sha256: snapshot.content_sha256,
    posts: snapshot.posts.map(({ source_id, body, original_markdown, hashtags }) => ({
      source_id, body, original_markdown, hashtags,
    })),
  };
  const discovery = buildDiscovery(snapshot);
  const coverageIssues = validateDiscoveryCoverage(validationSnapshot, discovery);
  if (coverageIssues.length) throw new Error(`Mock Discovery coverage failed: ${coverageIssues.map((item) => item.code).join(", ")}`);

  const candidates = groupIds.map((ids) => buildCandidate(ids, snapshot));
  for (const candidate of candidates) {
    const issues = validateCandidate(candidate, validationSnapshot, discovery);
    if (issues.length) throw new Error(`Mock Candidate validation failed: ${issues.map((item) => item.code).join(", ")}`);
  }

  const testResults: TestResult[] = [
    {
      candidate_id: candidates[0].candidate_id,
      decision: "PASS",
      scores: { semantic_coherence: 5, curatorial_originality: 4, narrative_integrity: 5, visual_composition: 4, evidence_integrity: 5 },
      blocking_issues: [],
    },
    {
      candidate_id: candidates[1].candidate_id,
      decision: "FAIL",
      scores: { semantic_coherence: 3, curatorial_originality: 3, narrative_integrity: 3, visual_composition: 3, evidence_integrity: 5 },
      blocking_issues: ["The alternative sequence is less coherent in the synthetic comparison."],
    },
  ];
  for (const testResult of testResults) {
    const issues = validateTestDecision(testResult);
    if (issues.length) throw new Error(`Mock TestResult validation failed: ${issues.map((item) => item.code).join(", ")}`);
  }
  return { snapshot, validationSnapshot, discovery, candidates, testResults };
}

export async function runMockPortfolioImplementation(): Promise<MockPortfolioReport> {
  const fixture = createMockPortfolioFixture();
  const ranked = fixture.candidates
    .map((candidate, index) => ({ candidate, score: index === 0 ? 0.94 : 0.72 }))
    .sort((left, right) => right.score - left.score);
  const selected = ranked[0].candidate;
  const selectedIds = selected.source_ids;

  const audit: Omit<ProcessAudit, "modelCalls"> & { modelCalls: readonly ModelCallRecord[] } = {
    snapshotSourceIds: fixture.snapshot.sampled_source_ids,
    processedSourceIds: fixture.discovery.map((record) => record.source_id),
    candidateIds: ranked.map(({ candidate }) => candidate.candidate_id),
    candidateSourceIdsById: Object.fromEntries(ranked.map(({ candidate }) => [candidate.candidate_id, candidate.source_ids])),
    globalComparisonCompleted: true,
    revisionCyclesByCandidate: {
      [fixture.candidates[0].candidate_id]: 1,
      [fixture.candidates[1].candidate_id]: 0,
    },
    modelCalls: [
      modelCall("mock-discover", "DISCOVER", null),
      modelCall("mock-compose", "COMPOSE", selected.candidate_id),
      modelCall("mock-test-initial", "TEST", selected.candidate_id),
      modelCall("mock-revision", "REVISION", selected.candidate_id),
    ],
  };

  // First composition intentionally contains a non-verbatim quote; the mock Test
  // rejects it, and the single deterministic Revision repairs the evidence.
  const firstDraft = buildGallery(fixture.snapshot, selectedIds);
  firstDraft.roles[0].evidence[0].quote = "A deliberately altered quotation that is absent from the source.";
  const firstSemanticCheck = validatePortfolioSemantics(
    { gallery: firstDraft },
    fixture.snapshot as unknown as Parameters<typeof validatePortfolioSemantics>[1],
    selectedIds,
  );
  if (firstSemanticCheck.ok) throw new Error("Mock Test fixture error: deliberately invalid evidence unexpectedly passed");

  const initialTest: TestResult = {
    candidate_id: selected.candidate_id,
    decision: "FAIL",
    scores: { semantic_coherence: 4, curatorial_originality: 4, narrative_integrity: 4, visual_composition: 4, evidence_integrity: 3 },
    blocking_issues: ["QUOTE_NOT_EXACT"],
  };
  if (validateTestDecision(initialTest).length) throw new Error("Mock initial TestResult structure unexpectedly failed");

  const revisedGallery = buildGallery(fixture.snapshot, selectedIds);
  const finalOutput: GeminiOutput = {
    gallery: revisedGallery,
    test: { decision: "APPROVE", findings: [], revision_cycles: 1 },
  };
  const structural = validateGeminiOutput(finalOutput);
  const semantic = validatePortfolioSemantics(
    finalOutput,
    fixture.snapshot as unknown as Parameters<typeof validatePortfolioSemantics>[1],
    selectedIds,
  );
  if (!structural.ok || !semantic.ok) {
    throw new Error(`Mock final validation failed: ${[...structural.errors, ...semantic.errors].join("; ")}`);
  }

  const loaded: LoadedPortfolioSnapshot = {
    snapshot: fixture.snapshot,
    input_snapshot: {
      schema_version: "1",
      repository_commit: fixture.snapshot.repository_commit,
      generated_at: fixture.snapshot.generated_at,
      sampled_count: POST_COUNT,
      content_sha256: fixture.snapshot.content_sha256,
    },
  };
  const finalTestCall = modelCall("mock-test-final", "TEST", selected.candidate_id);
  const result = await runPortfolioOrchestrator({
    snapshotPath: "MOCK_ONLY_NO_FILE_READ",
    prompt: "Run the deterministic mock Portfolio composition and final validation.",
    candidateId: selected.candidate_id,
    processAudit: audit,
  }, {
    readSnapshot: async () => loaded,
    schema: {},
    generate: async (_prompt, _schema, options) => {
      if (options.stage !== "TEST" || options.candidateId !== selected.candidate_id) {
        throw new Error("Mock provider received an unexpected stage or candidate.");
      }
      return { data: finalOutput, model_used: [finalTestCall] };
    },
  });

  const processCheck = validatePortfolioProcess({
    ...audit,
    modelCalls: [...audit.modelCalls, finalTestCall],
  }, {
    actualSnapshotSourceIds: fixture.snapshot.sampled_source_ids,
    selectedCandidateId: selected.candidate_id,
    reportedRevisionCycles: finalOutput.test.revision_cycles,
  });
  if (!processCheck.ok) throw new Error(`Mock Process Audit failed: ${processCheck.errors.join("; ")}`);

  return {
    status: result.status,
    stages: [
      "SNAPSHOT_VALIDATION",
      "DISCOVER",
      "GLOBAL_COMPARISON",
      "COMPOSE",
      "TEST_REJECT",
      "REVISION",
      "FINAL_VALIDATION",
      "PROCESS_AUDIT",
      "RESULT",
    ],
    snapshot_posts: fixture.snapshot.posts.length,
    discovery_records: fixture.discovery.length,
    candidates_compared: ranked.length,
    selected_candidate_id: selected.candidate_id,
    revision_cycles: finalOutput.test.revision_cycles,
    model_used: result.model_used,
    result,
  };
}


/** Exercises the conservative NO_GALLERY outcome when global comparison finds
 * no publishable composition. The Snapshot is still synthetic and in-memory. */
export async function runMockNoGalleryScenario(): Promise<Awaited<ReturnType<typeof runPortfolioOrchestrator>>> {
  const fixture = createMockPortfolioFixture();
  const loaded: LoadedPortfolioSnapshot = {
    snapshot: fixture.snapshot,
    input_snapshot: {
      schema_version: "1",
      repository_commit: fixture.snapshot.repository_commit,
      generated_at: fixture.snapshot.generated_at,
      sampled_count: POST_COUNT,
      content_sha256: fixture.snapshot.content_sha256,
    },
  };
  const discoveryCall = modelCall("mock-no-gallery-discover", "DISCOVER", null);
  return runPortfolioOrchestrator({
    snapshotPath: "MOCK_ONLY_NO_FILE_READ",
    prompt: "Return NO_GALLERY when global comparison finds no convincing composition.",
    processAudit: {
      snapshotSourceIds: fixture.snapshot.sampled_source_ids,
      processedSourceIds: fixture.discovery.map((record) => record.source_id),
      candidateIds: [],
      candidateSourceIdsById: {},
      globalComparisonCompleted: true,
      revisionCyclesByCandidate: {},
      modelCalls: [],
    },
  }, {
    readSnapshot: async () => loaded,
    schema: {},
    generate: async (_prompt, _schema, options) => {
      if (options.stage !== "DISCOVER" || options.candidateId !== null) {
        throw new Error("Mock NO_GALLERY provider received an unexpected stage or candidate.");
      }
      return {
        data: {
          gallery: null,
          test: {
            decision: "REJECT",
            findings: ["No convincing six-source composition survived global comparison."],
            revision_cycles: 0,
          },
        },
        model_used: [discoveryCall],
      };
    },
  });
}
