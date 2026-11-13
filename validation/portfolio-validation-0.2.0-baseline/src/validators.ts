import { createHash } from 'node:crypto';
import type { Candidate, DiscoveryRecord, Snapshot, TestResult, ValidationIssue } from './types.js';

const fail = (code: string, message: string): ValidationIssue => ({ code, message });

export function computeCandidateId(snapshotIdentity: string, sourceIds: readonly string[]): string {
  if (!/^[a-f0-9]{64}$/.test(snapshotIdentity)) throw new Error('snapshotIdentity must be a lowercase SHA-256 hex digest');
  if (sourceIds.length !== 6 || new Set(sourceIds).size !== 6 || sourceIds.some((id) => !id || id.length > 128)) {
    throw new Error('candidate identity requires exactly six unique non-empty source IDs');
  }
  // Canonicalization contract: JS default Array.sort() (UTF-16 code-unit order),
  // object property order as written, compact JSON, UTF-8 bytes, lowercase SHA-256.
  const sorted = [...sourceIds].sort();
  const payload = JSON.stringify({ snapshot_identity: snapshotIdentity, source_ids: sorted });
  return `cand_${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

export function validateSetEquality(expected: readonly string[], actual: readonly string[]): ValidationIssue[] {
  if (expected.length !== 6 || actual.length !== 6) return [fail('SET_SIZE', 'Both arrays must contain exactly six IDs')];
  if (new Set(expected).size !== 6 || new Set(actual).size !== 6) return [fail('SET_DUPLICATE', 'Both arrays must contain six unique IDs')];
  const a = [...expected].sort();
  const b = [...actual].sort();
  return a.every((v, i) => v === b[i]) ? [] : [fail('SET_MISMATCH', 'The source ID sets differ')];
}

export function validateEvidenceAgainstSnapshot(records: readonly DiscoveryRecord[], snapshot: Snapshot): ValidationIssue[] {
  const posts = new Map(snapshot.posts.map((post) => [post.source_id, post]));
  const issues: ValidationIssue[] = [];
  for (const record of records) {
    const post = posts.get(record.source_id);
    if (!post) { issues.push(fail('UNKNOWN_SOURCE', `No snapshot post for ${record.source_id}`)); continue; }
    for (let i = 0; i < record.observations.length; i++) {
      for (let j = 0; j < record.observations[i].evidence.length; j++) {
        const ev = record.observations[i].evidence[j];
        const sourceText = ev.source === 'BODY' ? post.body : post.original_markdown;
        if (!ev.quote || !sourceText.includes(ev.quote)) {
          issues.push(fail('EVIDENCE_NOT_FOUND', `${record.source_id} observation ${i} evidence ${j} is not an exact substring of ${ev.source}`));
        }
      }
    }
  }
  return issues;
}

export function validateObservationRefs(candidate: Candidate, records: readonly DiscoveryRecord[]): ValidationIssue[] {
  const byId = new Map<string, string>();
  for (const record of records) {
    record.observations.forEach((_, index) => byId.set(`${record.source_id}:${index}`, record.source_id));
  }
  const issues: ValidationIssue[] = [];
  const candidateObservationIds = new Set(candidate.observation_ids);
  for (const id of candidate.observation_ids) if (!byId.has(id)) issues.push(fail('UNKNOWN_OBSERVATION', `Unknown observation reference ${id}`));
  for (const edge of candidate.relationships) {
    if (edge.source_a === edge.source_b) issues.push(fail('SELF_LOOP', `Self-loop at ${edge.source_a}`));
    if (!candidate.source_ids.includes(edge.source_a) || !candidate.source_ids.includes(edge.source_b)) {
      issues.push(fail('EDGE_ENDPOINT', `Relationship endpoint is outside candidate: ${edge.source_a}/${edge.source_b}`));
    }
    const referencedSources = new Set(edge.observation_ids.map((id) => byId.get(id)).filter((x): x is string => Boolean(x)));
    for (const id of edge.observation_ids) {
      if (!candidateObservationIds.has(id)) issues.push(fail('EDGE_OBSERVATION_NOT_IN_CANDIDATE', `Relationship observation ${id} is not declared by candidate`));
      if (!byId.has(id)) issues.push(fail('UNKNOWN_EDGE_OBSERVATION', `Relationship references unknown observation ${id}`));
    }
    if (!referencedSources.has(edge.source_a) || !referencedSources.has(edge.source_b)) {
      issues.push(fail('EDGE_EVIDENCE_ENDPOINTS', `Relationship ${edge.source_a}/${edge.source_b} must reference observations from both endpoints`));
    }
  }
  return issues;
}

export function validateDistinctEdges(candidate: Candidate): ValidationIssue[] {
  const edges = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const edge of candidate.relationships) {
    if (edge.source_a === edge.source_b) { issues.push(fail('SELF_LOOP', 'Self-loop is not a publication-level edge')); continue; }
    const [a, b] = [edge.source_a, edge.source_b].sort();
    edges.add(JSON.stringify([a, b]));
  }
  if (edges.size < 5) issues.push(fail('DISTINCT_EDGE_COUNT', `Expected at least five distinct publication-level edges; found ${edges.size}`));
  return issues;
}

export function validateCandidateGraph(candidate: Candidate): ValidationIssue[] {
  const ids = candidate.source_ids;
  if (ids.length !== 6 || new Set(ids).size !== 6) return [fail('CANDIDATE_NODES', 'Candidate must contain exactly six unique source IDs')];
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const edge of candidate.relationships) {
    if (!adjacency.has(edge.source_a) || !adjacency.has(edge.source_b) || edge.source_a === edge.source_b) continue;
    adjacency.get(edge.source_a)!.add(edge.source_b);
    adjacency.get(edge.source_b)!.add(edge.source_a);
  }
  const visited = new Set<string>();
  const stack = [ids[0]];
  while (stack.length) {
    const node = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const neighbor of adjacency.get(node) ?? []) if (!visited.has(neighbor)) stack.push(neighbor);
  }
  return visited.size === 6 ? [] : [fail('GRAPH_DISCONNECTED', `Candidate graph reaches ${visited.size} of 6 nodes`)];
}

export function validateTestDecision(result: TestResult): ValidationIssue[] {
  if (result.decision !== 'PASS') return [];
  const s = result.scores;
  const issues: ValidationIssue[] = [];
  for (const key of ['semantic_coherence', 'curatorial_originality', 'narrative_integrity', 'visual_composition'] as const) {
    if (s[key] < 4) issues.push(fail('PASS_SCORE_THRESHOLD', `${key} must be at least 4 for PASS`));
  }
  if (s.evidence_integrity !== 5) issues.push(fail('PASS_EVIDENCE_SCORE', 'evidence_integrity must equal 5 for PASS'));
  if (result.blocking_issues.length) issues.push(fail('PASS_BLOCKING_ISSUES', 'PASS requires an empty blocking_issues array'));
  return issues;
}

export function validateCandidate(candidate: Candidate, snapshot: Snapshot, records: readonly DiscoveryRecord[]): ValidationIssue[] {
  const issues = [
    ...validateCandidateGraph(candidate),
    ...validateDistinctEdges(candidate),
    ...validateObservationRefs(candidate, records),
    ...validateEvidenceAgainstSnapshot(records, snapshot),
  ];
  const expectedId = computeCandidateId(snapshot.content_sha256, candidate.source_ids);
  if (candidate.candidate_id !== expectedId) issues.push(fail('CANDIDATE_ID_MISMATCH', 'candidate_id does not match canonical snapshot/source identity'));
  return issues;
}
