export type EvidenceSource = 'BODY' | 'ORIGINAL_MARKDOWN';
export type RunStatus = 'APPROVED' | 'NO_GALLERY' | 'INCOMPLETE';

export interface SnapshotPost {
  source_id: string;
  body: string;
  original_markdown: string;
  hashtags?: string[];
}

export interface Snapshot {
  content_sha256: string;
  posts: SnapshotPost[];
}

export interface Evidence {
  source: EvidenceSource;
  quote: string;
}

export interface Observation {
  prism: string;
  signal: string;
  interpretation: string;
  evidence: Evidence[];
}

export interface DiscoveryRecord {
  source_id: string;
  result: 'SIGNALS_FOUND' | 'NO_SIGNAL';
  observations: Observation[];
}

export interface Relationship {
  source_a: string;
  source_b: string;
  type: string;
  explanation: string;
  observation_ids: string[];
}

export interface Candidate {
  candidate_id: string;
  source_ids: string[];
  observation_ids: string[];
  relationships: Relationship[];
}

export interface TestScores {
  semantic_coherence: number;
  curatorial_originality: number;
  narrative_integrity: number;
  visual_composition: number;
  evidence_integrity: number;
}

export interface TestResult {
  candidate_id: string;
  decision: 'PASS' | 'FAIL';
  scores: TestScores;
  blocking_issues: string[];
}

export interface ValidationIssue {
  code: string;
  message: string;
}
