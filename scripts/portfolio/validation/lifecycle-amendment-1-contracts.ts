/**
 * Portfolio Lifecycle Amendment 1 — additive contracts.
 *
 * These types intentionally do not replace the existing PortfolioStage,
 * ModelCallRecord, ProcessAudit, or Orchestrator contracts. Integration is a
 * later, separately reviewed step.
 */

export type LifecycleAmendment1Stage =
  | "DISCOVER"
  | "CANDIDATE_GENERATION"
  | "GLOBAL_COMPARISON"
  | "COMPOSE"
  | "TEST"
  | "REVISION";

export type LifecycleAmendment1ModelOutcome = "SUCCESS" | "FALLBACK" | "FAILED";

export interface LifecycleArtifactReference {
  artifact_ref: string;
  content_sha256: string;
}

export interface LifecycleDiscoveryArtifact extends LifecycleArtifactReference {
  record_count: 1000;
}

export interface LifecycleCandidatePoolEntry extends LifecycleArtifactReference {
  candidate_id: string;
  source_ids: string[];
}

export interface LifecycleCandidatePoolV1 {
  schema_version: "1.0";
  snapshot_sha256: string;
  generation_status: "COMPLETE" | "NO_CANDIDATES";
  /** Validated, deduplicated Candidate set; never more than 100. */
  candidates: LifecycleCandidatePoolEntry[];
}

export interface LifecycleCandidateValidationEntry {
  candidate_id: string;
  source_ids: string[];
  status: "PASS" | "REJECTED";
  errors: string[];
}

export interface LifecycleCandidateValidationReportV1 {
  schema_version: "1.0";
  snapshot_sha256: string;
  /** One record per generated Candidate proposal, including rejected proposals. */
  results: LifecycleCandidateValidationEntry[];
}

export type LifecycleComparisonCriterion =
  | "semantic_coherence"
  | "curatorial_originality"
  | "narrative_integrity"
  | "evidence_integrity"
  | "visual_composition_potential";

export type LifecycleEvaluationEvidence =
  | { kind: "OBSERVATION"; observation_id: string }
  | { kind: "SOURCE_IMAGE"; source_id: string };

export interface LifecycleCriterionEvaluation {
  criterion: LifecycleComparisonCriterion;
  score: 1 | 2 | 3 | 4 | 5;
  rationale: string;
  evidence: LifecycleEvaluationEvidence[];
}

export interface LifecycleCandidateEvaluation {
  candidate_id: string;
  /** Exactly one evaluation for each of the five criteria. */
  criteria: LifecycleCriterionEvaluation[];
  blocking_issues: string[];
}

export interface LifecycleGlobalComparisonStage1V1 {
  schema_version: "1.0";
  snapshot_sha256: string;
  candidate_pool_ids: string[];
  evaluations: LifecycleCandidateEvaluation[];
  /** Eligible Candidate ordered by the Amendment 1 lexicographic criterion tuple. */
  stage1_ranking: string[];
  /** First min(10, stage1_ranking.length) Candidate IDs. */
  preliminary_finalists: string[];
}

export type LifecyclePairwiseOutcome = "A_WINS" | "B_WINS" | "DRAW";

export interface LifecyclePairwiseComparison {
  /** Canonical pair ordering: candidate_a_id is lexicographically smaller. */
  candidate_a_id: string;
  candidate_b_id: string;
  outcome: LifecyclePairwiseOutcome;
  rationale: string;
  evidence_observation_ids: string[];
}

export interface LifecycleCopelandStanding {
  candidate_id: string;
  wins: number;
  losses: number;
  draws: number;
  /** Copeland score = wins - losses; draws contribute zero. */
  copeland_score: number;
}

export interface LifecycleGlobalComparisonStage2V1 {
  schema_version: "1.0";
  snapshot_sha256: string;
  finalists: string[];
  candidate_source_ids_by_id: Record<string, string[]>;
  /** Complete pair set: n * (n - 1) / 2 comparisons for n finalists. */
  comparisons: LifecyclePairwiseComparison[];
  standings: LifecycleCopelandStanding[];
  /** Copeland descending, then Stage 1 criterion tuple, then candidate_id ascending. */
  final_ranking: string[];
  /** Greedy in final_ranking order; max three shared source IDs per pair. */
  shortlist: string[];
}

export interface LifecycleAmendment1ModelCallRecord {
  call_id: string;
  stage: LifecycleAmendment1Stage;
  /** null for corpus-level stages; Candidate ID for COMPOSE/TEST/REVISION. */
  candidate_id: string | null;
  model: string;
  fallback_index: number;
  attempts: number;
  outcome: LifecycleAmendment1ModelOutcome;
}

export interface LifecycleGlobalComparisonAuditV1 {
  stage1_artifact: LifecycleArtifactReference;
  stage2_artifact: LifecycleArtifactReference;
  completed: boolean;
}

export interface PortfolioProcessAuditV2 {
  schema_version: "2.0";
  snapshot_source_ids: string[];
  processed_source_ids: string[];
  discovery_artifact: LifecycleArtifactReference;
  candidate_pool_artifact: LifecycleArtifactReference;
  candidate_validation_artifact: LifecycleArtifactReference;
  candidate_pool_ids: string[];
  shortlist_ids: string[];
  /** Must contain exactly one entry for each Candidate in candidate_pool_ids. */
  candidate_source_ids_by_id: Record<string, string[]>;
  global_comparison: LifecycleGlobalComparisonAuditV1;
  revision_cycles_by_candidate: Record<string, number>;
  model_calls: LifecycleAmendment1ModelCallRecord[];
}

/**
 * Runtime-only invariants not expressible by the individual JSON Schemas:
 * - snapshot_source_ids and processed_source_ids are the same set of 1000 IDs;
 * - Candidate IDs are unique and Candidate artifacts match their recorded hashes;
 * - Candidate pool, validation report, Stage 1 and Stage 2 ID sets reconcile exactly;
 * - each Candidate has exactly six source IDs from the verified Snapshot;
 * - Stage 1 has one unique evaluation per pool Candidate and five unique criteria;
 * - visual_composition_potential evidence uses SOURCE_IMAGE only; all other
 *   criteria use OBSERVATION evidence;
 * - Stage 1 ranking is the eligible Candidate set sorted by the lexicographic
 *   tuple: semantic_coherence, curatorial_originality, narrative_integrity,
 *   evidence_integrity, visual_composition_potential (descending), then ID
 *   ascending; candidates with blocking issues are ineligible;
 * - Stage 2 contains every unordered finalist pair exactly once;
 * - Copeland totals and final_ranking are recomputed, not trusted;
 * - shortlist is the greedy scan of final_ranking with <= 3 shared source IDs
 *   against every already selected Candidate;
 * - corpus-level stages have candidate_id=null; candidate-level stages do not;
 * - fallback chains and lifecycle call ordering follow the existing rules.
 */
