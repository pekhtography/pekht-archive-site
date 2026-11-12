import { createHash } from "node:crypto";
import { runPortfolioOrchestrator } from "../orchestrator.ts";
import {
  validatePortfolioSnapshot,
  type LoadedPortfolioSnapshot,
  type PortfolioSnapshot,
} from "../snapshot.ts";
import {
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
  ValidationIssue,
} from "../../../validation/portfolio-validation-0.2.1/src/types.ts";

const GENERATED_AT = "2026-11-12T00:00:00.000Z";
const REPOSITORY_COMMIT = "a".repeat(40);
const POST_COUNT = 1000;
export const MAX_REVISION_ATTEMPTS = 2;
const DEFAULT_MINIMUM_PUBLISH_SCORE = 0.75;
const NO_GALLERY_MINIMUM_PUBLISH_SCORE = 0.99;

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
  | "CANDIDATE_GENERATION"
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

export interface MockStageEvent {
  sequence: number;
  stage: MockStage;
  event: "START" | "COMPLETE";
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

export interface MockPortfolioFixture {
  /** Synthetic in-memory data only. No validation or downstream stages run here. */
  snapshot: PortfolioSnapshot;
  validationSnapshot: ValidationSnapshot;
}

export interface MockPortfolioReport {
  status: "APPROVED" | "NO_GALLERY" | "INCOMPLETE";
  stages: MockStage[];
  execution_log: StageExecution[];
  event_trace: MockStageEvent[];
  snapshot_posts: number;
  discovery_records: number;
  candidates_compared: number;
  comparisons: CandidateComparison[];
  selected_candidate_id: string | null;
  revision_cycles: number;
  test_results: TestResult[];
  model_used: ModelCallRecord[];
  result: PortfolioRunResult;
}

export interface MockPipelineDependencies {
  buildSnapshot?: () => PortfolioSnapshot;
  validateSnapshot?: (snapshot: PortfolioSnapshot) => void;
  discoverPost?: (post: PortfolioSnapshot["posts"][number]) => DiscoveryRecord;
  validateDiscovery?: (snapshot: ValidationSnapshot, records: readonly DiscoveryRecord[]) => ValidationIssue[];
  buildCandidates?: (snapshot: PortfolioSnapshot, records: DiscoveryRecord[], validationSnapshot: ValidationSnapshot) => Candidate[];
  compareCandidates?: (candidates: Candidate[], discovery: DiscoveryRecord[], snapshot: PortfolioSnapshot) => CandidateComparison[];
  buildGallery?: (snapshot: PortfolioSnapshot, sourceIds: string[]) => NonNullable<GeminiOutput["gallery"]>;
  onStageEvent?: (event: MockStageEvent) => void;
  minimumPublishScore?: number;
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

function toValidationSnapshot(snapshot: PortfolioSnapshot): ValidationSnapshot {
  return {
    content_sha256: snapshot.content_sha256,
    posts: snapshot.posts.map(({ source_id, body, original_markdown, hashtags }) => ({
      source_id, body, original_markdown, hashtags,
    })),
  };
}

/** Fixture creation is deliberately limited to data generation and projection. */
export function createMockPortfolioFixture(): MockPortfolioFixture {
  const snapshot = buildSnapshot();
  return { snapshot, validationSnapshot: toValidationSnapshot(snapshot) };
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

export function buildMockCandidates(
  snapshot: PortfolioSnapshot,
  records: DiscoveryRecord[],
  validationSnapshot: ValidationSnapshot,
): Candidate[] {
  const recordsById = new Map(records.map((record) => [record.source_id, record]));
  const candidates = groupIds.map((sourceIds) => {
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
    const issues = validateCandidate(candidate, validationSnapshot, records);
    if (issues.length) throw new Error(`Candidate validation failed: ${issues.map((issue) => issue.code).join(", ")}`);
    if (sourceIds.some((id) => !recordsById.has(id))) {
      throw new Error("Candidate generation received a source without a Discovery record.");
    }
    return candidate;
  });
  return candidates;
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

function emitEvent(
  events: MockStageEvent[],
  callback: MockPipelineDependencies["onStageEvent"],
  stage: MockStage,
  event: MockStageEvent["event"],
): void {
  const entry = Object.freeze({ sequence: events.length + 1, stage, event });
  events.push(entry);
  callback?.(entry);
}

function executeStage<T>(
  log: StageExecution[],
  events: MockStageEvent[],
  callback: MockPipelineDependencies["onStageEvent"],
  stage: MockStage,
  inputCount: number,
  outcome: StageExecution["outcome"],
  detail: string,
  work: () => T,
  outputCount: (value: T) => number,
): T {
  emitEvent(events, callback, stage, "START");
  const value = work();
  appendStage(log, stage, inputCount, outputCount(value), outcome, detail);
  emitEvent(events, callback, stage, "COMPLETE");
  return value;
}

export function assertTraceMatchesLog(
  log: readonly StageExecution[],
  events: readonly MockStageEvent[],
): void {
  const completed = events.filter((event) => event.event === "COMPLETE");
  const started = events.filter((event) => event.event === "START");
  if (completed.length !== log.length || started.length !== log.length) {
    throw new Error("Process audit found a stage event/log count mismatch.");
  }
  if (completed.some((event, index) => event.stage !== log[index]?.stage)) {
    throw new Error("Process audit found a stage log that does not match completed stage events.");
  }
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].sequence !== index + 1) throw new Error("Stage event trace sequence is not contiguous.");
    if (events[index].event === "START") {
      const next = events[index + 1];
      if (!next || next.event !== "COMPLETE" || next.stage !== events[index].stage) {
        throw new Error(`Process audit found an incomplete or reordered stage: ${events[index].stage}`);
      }
    }
  }
  log.forEach((entry, index) => {
    if (entry.sequence !== index + 1) throw new Error("Stage execution log sequence is not contiguous.");
    if (entry.input_count < 0 || entry.output_count < 0) throw new Error("Stage execution counts cannot be negative.");
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

function makeTestResult(
  candidateId: string,
  semanticErrors: readonly string[],
): TestResult {
  const passed = semanticErrors.length === 0;
  return {
    candidate_id: candidateId,
    decision: passed ? "PASS" : "FAIL",
    scores: passed
      ? { semantic_coherence: 5, curatorial_originality: 4, narrative_integrity: 5, visual_composition: 4, evidence_integrity: 5 }
      : { semantic_coherence: 3, curatorial_originality: 3, narrative_integrity: 3, visual_composition: 3, evidence_integrity: 4 },
    blocking_issues: passed ? [] : [...semanticErrors],
  };
}

function buildProcessAudit(
  snapshot: PortfolioSnapshot,
  discovery: DiscoveryRecord[],
  shortlist: CandidateComparison[],
  revisionCyclesByCandidate: Record<string, number>,
): ProcessAudit {
  return {
    snapshotSourceIds: snapshot.sampled_source_ids,
    processedSourceIds: discovery.map((record) => record.source_id),
    candidateIds: shortlist.map((candidate) => candidate.candidate_id),
    candidateSourceIdsById: Object.fromEntries(shortlist.map((candidate) => [candidate.candidate_id, candidate.source_ids])),
    globalComparisonCompleted: true,
    revisionCyclesByCandidate,
    modelCalls: [],
  };
}

async function runMockPipeline(
  dependencies: MockPipelineDependencies,
  minimumPublishScore: number,
): Promise<MockPortfolioReport> {
  const fixture = createMockPortfolioFixture();
  const snapshot = fixture.snapshot;
  const validationSnapshot = fixture.validationSnapshot;
  const log: StageExecution[] = [];
  const events: MockStageEvent[] = [];
  const testResults: TestResult[] = [];
  const validateSnapshot = dependencies.validateSnapshot ?? validatePortfolioSnapshot;
  const discover = dependencies.discoverPost ?? discoverPost;
  const validateDiscovery = dependencies.validateDiscovery ?? validateDiscoveryCoverage;
  const generateCandidates = dependencies.buildCandidates ?? buildMockCandidates;
  const compare = dependencies.compareCandidates ?? compareCandidates;
  const compose = dependencies.buildGallery ?? buildGallery;

  executeStage(log, events, dependencies.onStageEvent, "SNAPSHOT_VALIDATION", POST_COUNT, "PASS",
    "The synthetic Snapshot passed the existing Snapshot validator.",
    () => { validateSnapshot(snapshot); return snapshot; },
    (value) => value.posts.length);

  const discovery = executeStage(log, events, dependencies.onStageEvent, "DISCOVER", POST_COUNT, "PASS",
    "One deterministic Discovery result was produced for every Snapshot publication.",
    () => {
      const records = snapshot.posts.map(discover);
      const issues = validateDiscovery(validationSnapshot, records);
      if (issues.length) throw new Error(`Discovery coverage failed: ${issues.map((issue) => issue.code).join(", ")}`);
      return records;
    },
    (records) => records.length);

  const candidates = executeStage(log, events, dependencies.onStageEvent, "CANDIDATE_GENERATION", discovery.length, "PASS",
    "Candidates were generated only from the validated Discovery records and individually validated.",
    () => generateCandidates(snapshot, discovery, validationSnapshot),
    (value) => value.length);

  const comparison = executeStage(log, events, dependencies.onStageEvent, "GLOBAL_COMPARISON", candidates.length, "PASS",
    "Global Comparison ranked the Candidates using evidence, signal, lexical-diversity and graph features.",
    () => compare(candidates, discovery, snapshot),
    (value) => value.length);

  const shortlist = comparison.filter((entry) =>
    entry.score >= minimumPublishScore
    && entry.features.observation_count === 6
    && entry.features.graph_edges >= 5,
  );
  const selectedComparison = shortlist[0] ?? null;
  const selected = selectedComparison
    ? candidates.find((candidate) => candidate.candidate_id === selectedComparison.candidate_id) ?? null
    : null;
  if (selectedComparison && !selected) throw new Error("Global Comparison selected an unknown Candidate.");

  let draft: NonNullable<GeminiOutput["gallery"]> | null = null;
  let revisionCycles = 0;
  let result: PortfolioRunResult;

  if (selected) {
    const selectedIds = [...selected.source_ids];
    draft = executeStage(log, events, dependencies.onStageEvent, "COMPOSE", selectedIds.length, "PASS",
      "Composition was assembled from the globally selected Candidate and exact source text.",
      () => compose(snapshot, selectedIds),
      (value) => value.roles.length);

    // The first TEST receives a deliberately corrupted quotation so the rejection path is exercised.
    draft.roles[0].evidence[0].quote = "A deliberately altered quotation that is absent from the source.";
    const firstTest = executeStage(log, events, dependencies.onStageEvent, "TEST", 1, "REJECT",
      "TEST rejected the deliberately altered, non-verbatim quotation.",
      () => {
        const semantic = validatePortfolioSemantics(
          { gallery: draft },
          snapshot as unknown as Parameters<typeof validatePortfolioSemantics>[1],
          selectedIds,
        );
        const testResult = makeTestResult(selected.candidate_id, semantic.errors);
        const issues = validateTestDecision(testResult);
        if (issues.length) throw new Error(`TestResult validation failed: ${issues.map((issue) => issue.code).join(", ")}`);
        testResults.push(testResult);
        return { testResult, semantic };
      },
      (value) => value.testResult.decision === "PASS" ? 1 : 0);

    let accepted = firstTest.testResult.decision === "PASS";
    while (!accepted && revisionCycles < MAX_REVISION_ATTEMPTS) {
      revisionCycles += 1;
      draft = executeStage(log, events, dependencies.onStageEvent, "REVISION", 1, "PASS",
        `REVISION ${revisionCycles} rebuilt the draft from the selected Candidate.`,
        () => compose(snapshot, selectedIds),
        (value) => value.roles.length);
      const revisedTest = executeStage(log, events, dependencies.onStageEvent, "TEST", 1, "PASS",
        "TEST revalidated the revised draft and accepted exact source evidence.",
        () => {
          const semantic = validatePortfolioSemantics(
            { gallery: draft },
            snapshot as unknown as Parameters<typeof validatePortfolioSemantics>[1],
            selectedIds,
          );
          const testResult = makeTestResult(selected.candidate_id, semantic.errors);
          const issues = validateTestDecision(testResult);
          if (issues.length) throw new Error(`Revised TestResult validation failed: ${issues.map((issue) => issue.code).join(", ")}`);
          testResults.push(testResult);
          return { testResult, semantic };
        },
        (value) => value.testResult.decision === "PASS" ? 1 : 0);
      accepted = revisedTest.testResult.decision === "PASS";
    }
    if (!accepted || !draft) throw new Error("Revision limit exhausted without a passing TEST result.");

    const finalOutput: GeminiOutput = {
      gallery: draft,
      test: { decision: "APPROVE", findings: [], revision_cycles: revisionCycles },
    };
    const revisionMap = Object.fromEntries(shortlist.map((candidate) => [
      candidate.candidate_id,
      candidate.candidate_id === selected.candidate_id ? revisionCycles : 0,
    ]));
    const audit = buildProcessAudit(snapshot, discovery, shortlist, revisionMap);
    const finalTestCall = modelCall("mock-final-validation-test", "TEST", selected.candidate_id);

    result = executeStage(log, events, dependencies.onStageEvent, "FINAL_VALIDATION", 1, "PASS",
      "The existing Orchestrator independently validated structure, semantics and process evidence.",
      () => runPortfolioOrchestrator({
        snapshotPath: "MOCK_ONLY_NO_FILE_READ",
        prompt: "Validate the already composed deterministic mock Portfolio output.",
        candidateId: selected.candidate_id,
        processAudit: audit,
      }, {
        readSnapshot: async () => makeLoadedSnapshot(snapshot),
        schema: {},
        generate: async (_prompt, _schema, options) => {
          if (options.stage !== "TEST" || options.candidateId !== selected.candidate_id) {
            throw new Error("Mock final validator received an unexpected Provider stage or Candidate.");
          }
          return { data: finalOutput, model_used: [finalTestCall] };
        },
      }),
      (value) => value.status === "APPROVED" ? 1 : 0);
    if (result.status !== "APPROVED") throw new Error(`Orchestrator final result was ${result.status}`);

    executeStage(log, events, dependencies.onStageEvent, "PROCESS_AUDIT", snapshot.posts.length, "PASS",
      "Process Audit compared the completed stage log with the independently recorded invocation trace and revalidated actual model-call records.",
      () => {
        assertTraceMatchesLog(log, events);
        const checked = validatePortfolioProcess({
          ...audit,
          modelCalls: result.model_used,
        }, {
          actualSnapshotSourceIds: snapshot.sampled_source_ids,
          selectedCandidateId: selected.candidate_id,
          reportedRevisionCycles: revisionCycles,
        });
        if (!checked.ok) throw new Error(`Process audit failed: ${checked.errors.join("; ")}`);
        return checked;
      },
      (value) => value.ok ? 1 : 0);
  } else {
    if (shortlist.length !== 0) throw new Error("A shortlist exists but no matching Candidate was available.");
    const audit = buildProcessAudit(snapshot, discovery, shortlist, {});
    const noGalleryCall = modelCall("mock-no-gallery-decision", "DISCOVER", null);
    result = executeStage(log, events, dependencies.onStageEvent, "FINAL_VALIDATION", 1, "NO_GALLERY",
      "The Orchestrator validated the explicit no-selection result; no gallery composition was requested.",
      () => runPortfolioOrchestrator({
        snapshotPath: "MOCK_ONLY_NO_FILE_READ",
        prompt: "Return NO_GALLERY because Global Comparison selected no publishable Candidate.",
        processAudit: audit,
      }, {
        readSnapshot: async () => makeLoadedSnapshot(snapshot),
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
            model_used: [noGalleryCall],
          };
        },
      }),
      (value) => value.status === "NO_GALLERY" ? 0 : 1);
    if (result.status !== "NO_GALLERY") throw new Error(`NO_GALLERY scenario returned ${result.status}`);

    executeStage(log, events, dependencies.onStageEvent, "PROCESS_AUDIT", snapshot.posts.length, "PASS",
      "Process Audit verified the actual Snapshot, Discovery, Candidate Generation and Global Comparison execution trace.",
      () => {
        assertTraceMatchesLog(log, events);
        const checked = validatePortfolioProcess({
          ...audit,
          modelCalls: result.model_used,
        }, {
          actualSnapshotSourceIds: snapshot.sampled_source_ids,
          selectedCandidateId: null,
        });
        if (!checked.ok) throw new Error(`NO_GALLERY process audit failed: ${checked.errors.join("; ")}`);
        return checked;
      },
      (value) => value.ok ? 1 : 0);
  }

  executeStage(log, events, dependencies.onStageEvent, "RESULT", 1, "APPROVED",
    result.status === "NO_GALLERY"
      ? "No Candidate passed Global Comparison; no gallery was composed."
      : "The mock Orchestrator returned APPROVED after all validation gates passed.",
    () => result.status,
    (value) => value === "APPROVED" ? 1 : 0);

  assertTraceMatchesLog(log, events);
  return {
    status: result.status,
    stages: log.map((entry) => entry.stage),
    execution_log: log,
    event_trace: events,
    snapshot_posts: snapshot.posts.length,
    discovery_records: discovery.length,
    candidates_compared: comparison.length,
    comparisons: comparison,
    selected_candidate_id: selected?.candidate_id ?? null,
    revision_cycles: revisionCycles,
    test_results: testResults,
    model_used: result.model_used,
    result,
  };
}

export async function runMockPortfolioImplementation(
  dependencies: MockPipelineDependencies = {},
): Promise<MockPortfolioReport> {
  return runMockPipeline(
    dependencies,
    dependencies.minimumPublishScore ?? DEFAULT_MINIMUM_PUBLISH_SCORE,
  );
}

export async function runMockNoGalleryScenario(
  dependencies: MockPipelineDependencies = {},
): Promise<MockPortfolioReport> {
  return runMockPipeline(
    dependencies,
    dependencies.minimumPublishScore ?? NO_GALLERY_MINIMUM_PUBLISH_SCORE,
  );
}
