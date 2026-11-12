export type ValidationResult = { ok: true; errors: [] } | { ok: false; errors: string[] };
export type GeminiDecision = "APPROVE" | "REJECT";
export type PortfolioRunStatus = "APPROVED" | "NO_GALLERY" | "INCOMPLETE";
export type ValidationStatus = "PASS" | "FAIL" | "NOT_RUN";
export type PortfolioStage = "DISCOVER" | "COMPOSE" | "TEST" | "REVISION";
export type ModelCallOutcome = "SUCCESS" | "FALLBACK" | "FAILED";
export interface GeminiEvidence { quote: string; interpretation: string }
export interface GeminiRole { source_id: string; role: string; operation: string; evidence: GeminiEvidence[]; necessity: string }
export interface GeminiGallery {
  source_ids: string[]; title: string; statement: string; facets: string[]; roles: GeminiRole[];
  composition_rationale: string; alternatives_considered: string[]; doubts: string[];
}
export interface GeminiTest { decision: GeminiDecision; findings: string[]; revision_cycles: number }

/** Independent model-evaluated TEST response v1.3.1; separate from normalized TestResult. */
export interface IndependentTestScores { semantic_coherence: number; curatorial_originality: number; narrative_integrity: number; visual_composition: number; evidence_integrity: number; }
export interface IndependentTestResponse { candidate_id: string; decision: GeminiDecision; scores: IndependentTestScores; findings: string[]; blocking_issues: string[]; }

/** Evidence reference for the versioned structured TEST response contract v1.3.2. */
export type TestEvidenceReferenceV132 =
  | { kind: "SOURCE"; source_id: string; quote: string }
  | { kind: "COMPOSITION"; path: string; quote: string };

export type IndependentTestCriterionV132 =
  | "semantic_coherence"
  | "curatorial_originality"
  | "narrative_integrity"
  | "visual_composition"
  | "evidence_integrity";

export interface IndependentTestFindingV132 {
  criterion: IndependentTestCriterionV132;
  issue: string;
  blocking: boolean;
  evidence: TestEvidenceReferenceV132;
}

/** Versioned v1.3.2 response; does not replace the historical v1.3.1 response type. */
export interface IndependentTestResponseV132 {
  candidate_id: string;
  decision: GeminiDecision;
  scores: IndependentTestScores;
  findings: IndependentTestFindingV132[];
  blocking_issues: string[];
}

export interface GeminiOutput { gallery: GeminiGallery | null; test: GeminiTest }
/** Standalone COMPOSE/REVISION response, deliberately separate from TEST. */
export type GeminiGalleryResponse = GeminiGallery;
export interface PortfolioInputSnapshot {
  schema_version: string; repository_commit: string; generated_at: string;
  sampled_count: 1000; content_sha256: string;
}
export interface ValidationFinding {
  check_id: string; severity: "ERROR" | "WARNING" | "INFO"; message: string; source_id?: string;
}
export interface PortfolioValidation {
  status: ValidationStatus; structural: ValidationStatus; semantic: ValidationStatus;
  process: ValidationStatus; findings: ValidationFinding[];
}
export interface ModelCallRecord {
  /** Stable identifier shared by model attempts in one logical provider call. */
  call_id: string; stage: PortfolioStage; candidate_id: string | null; model: string;
  /** Zero-based position in the configured fallback chain. */
  fallback_index: number;
  /** HTTP/API attempts made against this model. */
  attempts: number; outcome: ModelCallOutcome;
}
export interface PortfolioRunResult {
  status: PortfolioRunStatus; input_snapshot: PortfolioInputSnapshot;
  gemini_output: GeminiOutput | null; validation: PortfolioValidation; model_used: ModelCallRecord[];
}
export interface SnapshotPost { source_id: string; body: string }
export interface PortfolioSnapshot extends Omit<PortfolioInputSnapshot, "schema_version"> {
  /** The persisted Snapshot schema uses numeric version 1; input_snapshot is normalized to a string. */
  schema_version: number;
  posts: SnapshotPost[];
}
export interface ProcessAudit {
  snapshotSourceIds: readonly string[]; processedSourceIds: readonly string[];
  /** Globally deduplicated shortlist; intermediate batch notes are excluded. */
  candidateIds: readonly string[];
  /** Candidate compositions compared against the complete corpus-wide shortlist. */
  candidateSourceIdsById: Readonly<Record<string, readonly string[]>>;
  /** Must be true only after all batch outputs have been merged and compared globally. */
  globalComparisonCompleted: boolean;
  revisionCyclesByCandidate: Readonly<Record<string, number>>;
  modelCalls: readonly ModelCallRecord[];
}
