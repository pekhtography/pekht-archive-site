import { createHash } from "node:crypto";
import { runPortfolioOrchestrator } from "../orchestrator.ts";
import {
  validatePortfolioSnapshot,
  type LoadedPortfolioSnapshot,
  type PortfolioSnapshot,
} from "../snapshot.ts";
import {
  validateGeminiOutput,
  validatePortfolioSemantics,
  validatePortfolioProcess,
} from "../validation/index.ts";
import type {
  GeminiOutput,
  ModelCallRecord,
  ProcessAudit,
  PortfolioRunResult,
} from "../validation/types.ts";
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
export const MAX_REVISION_ATTEMPTS = 2;

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

export type MockStage =
  | "SNAPSHOT_VALIDATION"
  | "DISCOVER"
  | "GLOBAL_COMPARISON"
  | "COMPOSE"
  | "TEST"
  | "REVISION"
  | "FINAL_VALIDATION"
  | "PROCESS_AUDIT"
  | "RESULT";

export interface StageExecution {
  sequence: number;
  stage: MockStage;
  input_count: number;
  output_count: number;
  outcome: "PASS" | "REJECT" | "NO_CANDIDATE" | "APPROVED" | "NO_GALLERY";
  detail: string;
}

export interface CandidateComparison {
  candidate_id: string;
  source_ids: string[];
  score: number;
  features: {
    observation_count: number;
    signal_diversity: number;
    lexical_diversity: number;
    graph_edges: number;
  };
}

export interface MockPortfolioReport {
  status: "APPROVED" | "NO_GALLERY" | "INCOMPLETE";
  stages: MockStage[];
  execution_log: StageExecution[];
  snapshot_posts: number;
  discovery_records: number;
  candidates_compared: number;
  comparisons: CandidateComparison[];
  selected_candidate_id: string | null;
  revision_cycles: number;
  model_used: ModelCallRecord[];
  result: PortfolioRunResult;
}

export interface MockPortfolioFixture {
  snapshot: PortfolioSnapshot;
  validationSnapshot: ValidationSnapshot;
  discovery: DiscoveryRecord[];
  candidates: Candidate[];
  testResults: TestResult[];
}

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
    const body = specialBodies.get(source_id)
      ?? `Synthetic control publication ${index + 1}: an ordinary observation with no qualifying curatorial signal.`;
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

function discoverPost(post: PortfolioSnapshot["posts"][number]): DiscoveryRecord {
  const text = post.body.toLowerCase();
  const timeTerms = ["light", "shadow", "river", "yesterday", "hour", "evening", "clock", "dawn", "minute"];
  const materialTerms = ["map", "envelope", "pencil", "paper", "crease", "margin", "notebook", "letter"];
  const matched = [...timeTerms.filter((term) => text.includes(term)), ...materialTerms.filter((term) => text.includes(term))];
  if (matched.length === 0) return { source_id: post.source_id, result: "NO_SIGNAL", observations: [] };
  const prism = materialTerms.some((term) => text.includes(term)) ? "Material" : "Time";
  return {
    source_id: post.source_id,
    result: "SIGNALS_FOUND",
    observations: [{
      prism,
      signal: matched.join(", "),
      interpretation: `The publication's own wording contains the textual signals: ${matched.join(", ")}.`,
      evidence: [{ source: "BODY", quote: post.body }],
    }],
  };
}

function buildCandidate(sourceIds: string[], snapshot: PortfolioSnapshot, discovery: DiscoveryRecord[]): Candidate {
  const observationIds = sourceIds.map((id) => `${id}:0`);
  const relationships = sourceIds.slice(0, -1).map((sourceId, index) => ({
    source_a: sourceId,
    source_b: sourceIds[index + 1],
    type: "SEQUENCE",
    explanation: "Adjacent observations form a continuous synthetic curatorial path.",
    observation_ids: [observationIds[index], observationIds[index + 1]],
  }));
  const candidate: Candidate = {
    candidate_id: computeCandidateId(snapshot.content_sha256, sourceIds),
    source_ids: [...sourceIds],
    observation_ids: observationIds,
    relationships,
  };
  const validationSnapshot: ValidationSnapshot = {
    content_sha256: snapshot.content_sha256,
    posts: snapshot.posts.map(({ source_id, body, original_markdown, hashtags }) => ({
      source_id, body, original_markdown, hashtags,
    })),
  };
  const issues = validateCandidate(candidate, validationSnapshot, discovery);
  if (issues.length) throw new Error(`Candidate validation failed: ${issues.map((issue) => issue.code).join(", ")}`);
  return candidate;
}

function lexicalDiversity(texts: string[]): number {
  const words = texts.flatMap((text) => text.toLowerCase().match(/[a-z']+/g) ?? []);
  return words.length === 0 ? 0 : new Set(words).size / words.length;
}

export function compareCandidates(
  candidates: Candidate[],
  discovery: DiscoveryRecord[],
  snapshot: PortfolioSnapshot,
): CandidateComparison[] {
  const bySource = new Map(discovery.map((record) => [record.source_id, record]));
  const postsById = new Map(snapshot.posts.map((post) => [post.source_id, post]));
  return candidates.map((candidate) => {
    const observations = candidate.source_ids.flatMap((id) => bySource.get(id)?.observations ?? []);
    const texts = candidate.source_ids.map((id) => postsById.get(id)?.body ?? "");
    const signalDiversity = new Set(observations.map((item) => item.signal)).size;
    const lexical = lexicalDiversity(texts);
    const edgeCount = new Set(candidate.relationships.map((edge) =>
      [edge.source_a, edge.source_b].sort().join("|"),
    )).size;
    const features = {
      observation_count: observations.length,
      signal_diversity: signalDiversity,
      lexical_diversity: lexical,
      graph_edges: edgeCount,
    };
    const score = Number((
      (features.observation_count / 6) * 0.25
      + (features.signal_diversity / 6) * 0.25
      + features.lexical_diversity * 0.25
      + (features.graph_edges / 5) * 0.25
    ).toFixed(6));
    return { candidate_id: candidate.candidate_id, source_ids: [...candidate.source_ids], score, features };
  }).sort((a, b) => b.score - a.score || a.candidate_id.localeCompare(b.candidate_id));
}

function modelCall(callId: string, stage: ModelCallRecord["stage"], candidateId: string | null): ModelCallRecord {
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

function appendStage(
  log: StageExecution[],
  stage: MockStage,
  inputCount: number,
  outputCount: number,
  outcome: StageExecution["outcome"],
  detail: string,
): void {
  log.push({ sequence: log.length + 1, stage, input_count: inputCount, output_count: outputCount, outcome, detail });
}

const EXPECTED_STAGES: MockStage[] = [
  "SNAPSHOT_VALIDATION", "DISCOVER", "GLOBAL_COMPARISON", "COMPOSE", "TEST",
  "REVISION", "FINAL_VALIDATION", "PROCESS_AUDIT", "RESULT",
];

function assertExecutionLog(log: StageExecution[], allowNoGallery: boolean): void {
  const stages = log.map((entry) => entry.stage);
  const expected = allowNoGallery
    ? ["SNAPSHOT_VALIDATION", "DISCOVER", "GLOBAL_COMPARISON", "PROCESS_AUDIT", "RESULT"]
    : EXPECTED_STAGES;
  if (JSON.stringify(stages) !== JSON.stringify(expected)) {
    throw new Error(`Stage execution order mismatch: ${stages.join(" -> ")}`);
  }
  log.forEach((entry, index) => {
    if (entry.sequence !== index + 1) throw new Error("Stage execution log sequence is not contiguous");
    if (entry.input_count < 0 || entry.output_count < 0) throw new Error("Stage execution counts cannot be negative");
  });
}

function makeLoadedSnapshot(snapshot: PortfolioSnapshot): LoadedPortfolioSnapshot {
  return {
    snapshot,
    input_snapshot: {
      schema_version: "1",
      repository_commit: snapshot.repository_commit,
      generated_at: snapshot.generated_at,
      sampled_count: POST_COUNT,
      content_sha256: snapshot.content_sha256,
    },
  };
}

export function createMockPortfolioFixture(): MockPortfolioFixture {
  const snapshot = buildSnapshot();
  validatePortfolioSnapshot(snapshot);
  const validationSnapshot: ValidationSnapshot = {
    content_sha256: snapshot.content_sha256,
    posts: snapshot.posts.map(({ source_id, body, original_markdown, hashtags }) => ({
      source_id, body, original_markdown, hashtags,
    })),
  };
  const discovery = snapshot.posts.map(discoverPost);
  const coverageIssues = validateDiscoveryCoverage(validationSnapshot, discovery);
  if (coverageIssues.length) throw new Error(`Discovery coverage failed: ${coverageIssues.map((issue) => issue.code).join(", ")}`);

  const candidates = groupIds.map((ids) => buildCandidate(ids, snapshot, discovery));
  const testResults: TestResult[] = candidates.map((candidate, index) => ({
    candidate_id: candidate.candidate_id,
    decision: index === 0 ? "PASS" : "FAIL",
    scores: index === 0
      ? { semantic_coherence: 5, curatorial_originality: 4, narrative_integrity: 5, visual_composition: 4, evidence_integrity: 5 }
      : { semantic_coherence: 3, curatorial_originality: 3, narrative_integrity: 3, visual_composition: 3, evidence_integrity: 5 },
    blocking_issues: index === 0 ? [] : ["The alternative sequence is less coherent in the synthetic comparison."],
  }));
  for (const testResult of testResults) {
    const issues = validateTestDecision(testResult);
    if (issues.length) throw new Error(`TestResult validation failed: ${issues.map((issue) => issue.code).join(", ")}`);
  }
  return { snapshot, validationSnapshot, discovery, candidates, testResults };
}

function buildProcessAudit(
  fixture: MockPortfolioFixture,
  shortlist: CandidateComparison[],
  revisionCyclesByCandidate: Record<string, number>,
  modelCalls: ModelCallRecord[],
): ProcessAudit {
  return {
    snapshotSourceIds: fixture.snapshot.sampled_source_ids,
    processedSourceIds: fixture.discovery.map((record) => record.source_id),
    candidateIds: shortlist.map((candidate) => candidate.candidate_id),
    candidateSourceIdsById: Object.fromEntries(shortlist.map((candidate) => [candidate.candidate_id, candidate.source_ids])),
    globalComparisonCompleted: true,
    revisionCyclesByCandidate,
    modelCalls,
  };
}

export async function runMockPortfolioImplementation(): Promise<MockPortfolioReport> {
  const fixture = createMockPortfolioFixture();
  const log: StageExecution[] = [];
  appendStage(log, "SNAPSHOT_VALIDATION", POST_COUNT, fixture.snapshot.posts.length, "PASS", "Synthetic Snapshot structure and content hash verified.");
  appendStage(log, "DISCOVER", POST_COUNT, fixture.discovery.length, "PASS", "Every source received exactly one SIGNALS_FOUND or NO_SIGNAL record.");

  const comparisons = compareCandidates(fixture.candidates, fixture.discovery, fixture.snapshot);
  const shortlist = comparisons.filter((entry) => entry.features.observation_count === 6 && entry.features.graph_edges >= 5);
  if (shortlist.length !== fixture.candidates.length) throw new Error("Global comparison unexpectedly dropped a valid synthetic Candidate.");
  const selectedComparison = shortlist[0];
  const selected = fixture.candidates.find((candidate) => candidate.candidate_id === selectedComparison.candidate_id);
  if (!selected) throw new Error("Global comparison selected an unknown Candidate.");
  appendStage(log, "GLOBAL_COMPARISON", comparisons.length, shortlist.length, "PASS", "Candidates ranked by computed evidence, signal, lexical-diversity and graph features.");

  const selectedIds = selected.source_ids;
  const callRecords: ModelCallRecord[] = [
    modelCall("mock-discovery", "DISCOVER", null),
    modelCall("mock-compose", "COMPOSE", selected.candidate_id),
  ];
  let draft = buildGallery(fixture.snapshot, selectedIds);
  appendStage(log, "COMPOSE", selectedIds.length, draft.roles.length, "PASS", "Composition assembled from the globally selected Candidate and its exact source evidence.");

  // The first draft deliberately fails exact-quotation validation.
  draft.roles[0].evidence[0].quote = "A deliberately altered quotation that is absent from the source.";
  const firstSemantic = validatePortfolioSemantics(
    { gallery: draft },
    fixture.snapshot as unknown as Parameters<typeof validatePortfolioSemantics>[1],
    selectedIds,
  );
  if (firstSemantic.ok) throw new Error("The negative Test fixture unexpectedly passed semantic validation.");
  callRecords.push(modelCall("mock-test-initial", "TEST", selected.candidate_id));
  appendStage(log, "TEST", 1, 0, "REJECT", "Initial Test rejected a non-verbatim quotation.");

  let revisionCycles = 0;
  let finalSemantic: ReturnType<typeof validatePortfolioSemantics> = firstSemantic;
  while (!finalSemantic.ok && revisionCycles < MAX_REVISION_ATTEMPTS) {
    revisionCycles += 1;
    callRecords.push(modelCall(`mock-revision-${revisionCycles}`, "REVISION", selected.candidate_id));
    draft = buildGallery(fixture.snapshot, selectedIds);
    finalSemantic = validatePortfolioSemantics(
      { gallery: draft },
      fixture.snapshot as unknown as Parameters<typeof validatePortfolioSemantics>[1],
      selectedIds,
    );
  }
  if (!finalSemantic.ok) throw new Error("Revision limit exhausted without a semantically valid composition.");
  appendStage(log, "REVISION", 1, 1, "PASS", `Revision repaired the evidence in ${revisionCycles} cycle(s); maximum is ${MAX_REVISION_ATTEMPTS}.`);

  const finalOutput: GeminiOutput = {
    gallery: draft,
    test: { decision: "APPROVE", findings: [], revision_cycles: revisionCycles },
  };
  const structural = validateGeminiOutput(finalOutput);
  const semantic = validatePortfolioSemantics(
    finalOutput,
    fixture.snapshot as unknown as Parameters<typeof validatePortfolioSemantics>[1],
    selectedIds,
  );
  if (!structural.ok || !semantic.ok) {
    throw new Error(`Final validation failed: ${[...structural.errors, ...semantic.errors].join("; ")}`);
  }
  appendStage(log, "FINAL_VALIDATION", 1, 1, "PASS", "Independent structural and semantic validators passed.");

  const auditBeforeFinalCall = buildProcessAudit(
    fixture,
    shortlist,
    { [selected.candidate_id]: revisionCycles, ...Object.fromEntries(shortlist.filter((item) => item.candidate_id !== selected.candidate_id).map((item) => [item.candidate_id, 0])) },
    callRecords,
  );
  const processCheck = validatePortfolioProcess(auditBeforeFinalCall, {
    actualSnapshotSourceIds: fixture.snapshot.sampled_source_ids,
    selectedCandidateId: selected.candidate_id,
    reportedRevisionCycles: revisionCycles,
  });
  if (!processCheck.ok) throw new Error(`Process audit failed: ${processCheck.errors.join("; ")}`);
  appendStage(log, "PROCESS_AUDIT", fixture.snapshot.posts.length, auditBeforeFinalCall.processedSourceIds.length, "PASS", "Audit checked the executed stage log, complete source coverage, shortlist, model calls and revision count.");

  const finalTestCall = modelCall("mock-orchestrator-final-test", "TEST", selected.candidate_id);
  const finalAudit = buildProcessAudit(fixture, shortlist, auditBeforeFinalCall.revisionCyclesByCandidate as Record<string, number>, callRecords);
  const result = await runPortfolioOrchestrator({
    snapshotPath: "MOCK_ONLY_NO_FILE_READ",
    prompt: "Validate the already composed deterministic mock Portfolio output.",
    candidateId: selected.candidate_id,
    processAudit: finalAudit,
  }, {
    readSnapshot: async () => makeLoadedSnapshot(fixture.snapshot),
    schema: {},
    generate: async (_prompt, _schema, options) => {
      if (options.stage !== "TEST" || options.candidateId !== selected.candidate_id) {
        throw new Error("Mock final validator received an unexpected Provider stage or Candidate.");
      }
      return { data: finalOutput, model_used: [finalTestCall] };
    },
  });
  if (result.status !== "APPROVED") throw new Error(`Orchestrator final result was ${result.status}`);
  appendStage(log, "RESULT", 1, 1, "APPROVED", "Orchestrator accepted structural, semantic and process validation.");
  assertExecutionLog(log, false);

  return {
    status: result.status,
    stages: log.map((entry) => entry.stage),
    execution_log: log,
    snapshot_posts: fixture.snapshot.posts.length,
    discovery_records: fixture.discovery.length,
    candidates_compared: comparisons.length,
    comparisons,
    selected_candidate_id: selected.candidate_id,
    revision_cycles: revisionCycles,
    model_used: result.model_used,
    result,
  };
}

export async function runMockNoGalleryScenario(): Promise<MockPortfolioReport> {
  const fixture = createMockPortfolioFixture();
  const log: StageExecution[] = [];
  appendStage(log, "SNAPSHOT_VALIDATION", POST_COUNT, fixture.snapshot.posts.length, "PASS", "Synthetic Snapshot structure and content hash verified.");
  appendStage(log, "DISCOVER", POST_COUNT, fixture.discovery.length, "PASS", "Discovery coverage completed for all synthetic sources.");

  // A deliberately conservative comparison policy excludes all candidates.
  // This is an explicit no-selection outcome, not a fabricated gallery result.
  const comparisons = compareCandidates(fixture.candidates, fixture.discovery, fixture.snapshot);
  const shortlist: CandidateComparison[] = [];
  appendStage(log, "GLOBAL_COMPARISON", comparisons.length, shortlist.length, "NO_CANDIDATE", "No Candidate met the configured mock publication threshold.");

  const audit = buildProcessAudit(fixture, shortlist, {}, []);
  const result = await runPortfolioOrchestrator({
    snapshotPath: "MOCK_ONLY_NO_FILE_READ",
    prompt: "Return NO_GALLERY because Global Comparison selected no publishable Candidate.",
    processAudit: audit,
  }, {
    readSnapshot: async () => makeLoadedSnapshot(fixture.snapshot),
    schema: {},
    generate: async (_prompt, _schema, options) => {
      if (options.stage !== "DISCOVER" || options.candidateId !== null) {
        throw new Error("Mock NO_GALLERY provider received an unexpected stage or Candidate.");
      }
      return {
        data: {
          gallery: null,
          test: { decision: "REJECT", findings: ["Global Comparison selected no Candidate."], revision_cycles: 0 },
        },
        model_used: [modelCall("mock-no-gallery-decision", "DISCOVER", null)],
      };
    },
  });
  if (result.status !== "NO_GALLERY") throw new Error(`NO_GALLERY scenario returned ${result.status}`);
  appendStage(log, "PROCESS_AUDIT", fixture.snapshot.posts.length, audit.processedSourceIds.length, "PASS", "Audit verified complete Discovery coverage and an empty globally compared shortlist.");
  appendStage(log, "RESULT", 1, 0, "NO_GALLERY", "No Candidate was selected; no gallery was created or published.");
  assertExecutionLog(log, true);

  return {
    status: result.status,
    stages: log.map((entry) => entry.stage),
    execution_log: log,
    snapshot_posts: fixture.snapshot.posts.length,
    discovery_records: fixture.discovery.length,
    candidates_compared: comparisons.length,
    comparisons,
    selected_candidate_id: null,
    revision_cycles: 0,
    model_used: result.model_used,
    result,
  };
}
