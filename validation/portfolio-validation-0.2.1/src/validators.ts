import { createHash } from 'node:crypto';
import type { Candidate, DiscoveryRecord, EvidenceSource, Observation, Snapshot, TestResult, ValidationIssue } from './types.js';

const fail = (code: string, message: string): ValidationIssue => ({ code, message });
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function computeCandidateId(snapshotIdentity: string, sourceIds: readonly string[]): string {
  if (!/^[a-f0-9]{64}$/.test(snapshotIdentity)) throw new Error('snapshotIdentity must be a lowercase SHA-256 hex digest');
  if (sourceIds.length !== 6 || new Set(sourceIds).size !== 6 || sourceIds.some((id) => !isNonEmptyString(id) || id.length > 128)) {
    throw new Error('candidate identity requires exactly six unique non-empty source IDs');
  }
  const sorted = [...sourceIds].sort();
  const payload = JSON.stringify({ snapshot_identity: snapshotIdentity, source_ids: sorted });
  return `cand_${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

export function validateSetEquality(expected: readonly string[], actual: readonly string[]): ValidationIssue[] {
  if (expected.length !== 6 || actual.length !== 6) return [fail('SET_SIZE', 'Both arrays must contain exactly six IDs')];
  if (new Set(expected).size !== 6 || new Set(actual).size !== 6) return [fail('SET_DUPLICATE', 'Both arrays must contain six unique IDs')];
  const a = [...expected].sort(); const b = [...actual].sort();
  return a.every((value, index) => value === b[index]) ? [] : [fail('SET_MISMATCH', 'The source ID sets differ')];
}

export function validateCandidateSourcesPresent(candidate: Candidate, records: readonly DiscoveryRecord[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (candidate.source_ids.length !== 6) issues.push(fail('CANDIDATE_SOURCE_COUNT', 'Candidate must contain exactly six source IDs'));
  const seen = new Set<string>();
  for (const sourceId of candidate.source_ids) {
    if (typeof sourceId !== 'string') { issues.push(fail('CANDIDATE_SOURCE_NOT_STRING', 'Candidate source IDs must be strings')); continue; }
    if (sourceId.length === 0) { issues.push(fail('CANDIDATE_SOURCE_EMPTY', 'Candidate source IDs must not be empty')); continue; }
    if (seen.has(sourceId)) { issues.push(fail('CANDIDATE_SOURCE_DUPLICATE', `Duplicate candidate source ID ${sourceId}`)); continue; }
    seen.add(sourceId);
    const matches = records.filter((record) => record.source_id === sourceId).length;
    if (matches !== 1) issues.push(fail('CANDIDATE_SOURCE_MISSING', matches === 0 ? `No Discovery record for ${sourceId}` : `Discovery source ${sourceId} is ambiguous (${matches} records)`));
  }
  return issues;
}

function observationFingerprint(observation: Observation): string {
  return JSON.stringify({ prism: observation.prism, signal: observation.signal, interpretation: observation.interpretation, evidence: observation.evidence });
}

export function validateDiscoveryRecords(records: readonly DiscoveryRecord[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sourceCounts = new Map<string, number>();
  for (const record of records) {
    if (!isNonEmptyString(record.source_id)) issues.push(fail('DISCOVERY_SOURCE_INVALID', 'Discovery source_id must be a non-empty string'));
    else sourceCounts.set(record.source_id, (sourceCounts.get(record.source_id) ?? 0) + 1);
    if (!Array.isArray(record.observations)) {
      issues.push(fail('DISCOVERY_OBSERVATION_STRUCTURE', `Observations for ${String(record.source_id)} must be an array`));
      continue;
    }
    const fingerprints = new Set<string>();
    record.observations.forEach((observation, index) => {
      const structurallyValid = observation !== null && typeof observation === 'object'
        && isNonEmptyString(observation.prism) && isNonEmptyString(observation.signal)
        && isNonEmptyString(observation.interpretation) && Array.isArray(observation.evidence)
        && observation.evidence.every((item) => item !== null && typeof item === 'object'
          && (item.source === 'BODY' || item.source === 'ORIGINAL_MARKDOWN') && isNonEmptyString(item.quote));
      if (!structurallyValid) {
        issues.push(fail('DISCOVERY_OBSERVATION_STRUCTURE', `Observation ${record.source_id}:${index} has an invalid structure`));
        return;
      }
      const fingerprint = observationFingerprint(observation);
      if (fingerprints.has(fingerprint)) issues.push(fail('DISCOVERY_OBSERVATION_DUPLICATE', `Duplicate observation in ${record.source_id} at index ${index}`));
      fingerprints.add(fingerprint);
    });
  }
  for (const [sourceId, count] of sourceCounts) {
    if (count > 1) issues.push(fail('DISCOVERY_SOURCE_DUPLICATE', `Discovery source_id ${sourceId} occurs ${count} times`));
  }
  return issues;
}

export function buildUnambiguousDiscoveryRecords(records: readonly DiscoveryRecord[]): DiscoveryRecord[] {
  const counts = new Map<string, number>();
  for (const record of records) if (isNonEmptyString(record.source_id)) counts.set(record.source_id, (counts.get(record.source_id) ?? 0) + 1);
  return records.filter((record) => isNonEmptyString(record.source_id) && counts.get(record.source_id) === 1);
}

export function validateObservationRefs(candidate: Candidate, records: readonly DiscoveryRecord[]): ValidationIssue[] {
  const byId = new Map<string, string>();
  for (const record of records) record.observations.forEach((_, index) => byId.set(`${record.source_id}:${index}`, record.source_id));
  const issues: ValidationIssue[] = [];
  const candidateObservationIds = new Set(candidate.observation_ids);
  for (const id of candidate.observation_ids) if (!byId.has(id)) issues.push(fail('UNKNOWN_OBSERVATION', `Unknown observation reference ${id}`));
  for (const edge of candidate.relationships) {
    if (edge.source_a === edge.source_b) issues.push(fail('SELF_LOOP', `Self-loop at ${edge.source_a}`));
    if (!candidate.source_ids.includes(edge.source_a) || !candidate.source_ids.includes(edge.source_b)) issues.push(fail('EDGE_ENDPOINT', `Relationship endpoint is outside candidate: ${edge.source_a}/${edge.source_b}`));
    const referencedSources = new Set(edge.observation_ids.map((id) => byId.get(id)).filter((value): value is string => Boolean(value)));
    for (const id of edge.observation_ids) {
      if (!candidateObservationIds.has(id)) issues.push(fail('EDGE_OBSERVATION_NOT_IN_CANDIDATE', `Relationship observation ${id} is not declared by candidate`));
      if (!byId.has(id)) issues.push(fail('UNKNOWN_EDGE_OBSERVATION', `Relationship references unknown observation ${id}`));
    }
    if (!referencedSources.has(edge.source_a) || !referencedSources.has(edge.source_b)) issues.push(fail('EDGE_EVIDENCE_ENDPOINTS', `Relationship ${edge.source_a}/${edge.source_b} must reference observations from both endpoints`));
  }
  return issues;
}

export function validateEvidenceAgainstSnapshot(candidate: Candidate, snapshot: Snapshot, records: readonly DiscoveryRecord[]): ValidationIssue[] {
  const postsById = new Map<string, Snapshot['posts'][number]>();
  const duplicatePostIds = new Set<string>();
  for (const post of snapshot.posts) {
    if (postsById.has(post.source_id)) duplicatePostIds.add(post.source_id);
    else postsById.set(post.source_id, post);
  }
  const recordById = new Map(records.map((record) => [record.source_id, record]));
  const issues: ValidationIssue[] = [];
  for (const observationId of candidate.observation_ids) {
    const separator = observationId.lastIndexOf(':');
    if (separator < 1) continue;
    const sourceId = observationId.slice(0, separator);
    const indexText = observationId.slice(separator + 1);
    if (!/^\d+$/.test(indexText)) continue;
    const post = postsById.get(sourceId);
    if (!post || duplicatePostIds.has(sourceId)) { issues.push(fail('UNKNOWN_SOURCE', `No unambiguous snapshot post for ${sourceId}`)); continue; }
    const record = recordById.get(sourceId);
    const observation = record?.observations[Number(indexText)];
    if (!observation) continue;
    for (let evidenceIndex = 0; evidenceIndex < observation.evidence.length; evidenceIndex++) {
      const evidence = observation.evidence[evidenceIndex] as { source: string; quote: string };
      if (evidence.source !== 'BODY' && evidence.source !== 'ORIGINAL_MARKDOWN') {
        issues.push(fail('INVALID_EVIDENCE_SOURCE', `${observationId} evidence ${evidenceIndex} has invalid source ${String(evidence.source)}`));
        continue;
      }
      const sourceText = evidence.source === 'BODY' ? post.body : post.original_markdown;
      if (!evidence.quote || !sourceText.includes(evidence.quote)) issues.push(fail('EVIDENCE_NOT_FOUND', `${observationId} evidence ${evidenceIndex} is not an exact substring of ${evidence.source}`));
    }
  }
  return issues;
}

export function validateDistinctEdges(candidate: Candidate): ValidationIssue[] {
  const edges = new Set<string>(); const issues: ValidationIssue[] = [];
  for (const edge of candidate.relationships) {
    if (edge.source_a === edge.source_b) { issues.push(fail('SELF_LOOP', 'Self-loop is not a publication-level edge')); continue; }
    const [a, b] = [edge.source_a, edge.source_b].sort(); edges.add(JSON.stringify([a, b]));
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
    adjacency.get(edge.source_a)!.add(edge.source_b); adjacency.get(edge.source_b)!.add(edge.source_a);
  }
  const visited = new Set<string>(); const stack = [ids[0]];
  while (stack.length) { const node = stack.pop()!; if (visited.has(node)) continue; visited.add(node); for (const neighbor of adjacency.get(node) ?? []) if (!visited.has(neighbor)) stack.push(neighbor); }
  return visited.size === 6 ? [] : [fail('GRAPH_DISCONNECTED', `Candidate graph reaches ${visited.size} of 6 nodes`)];
}

export function validateTestDecision(result: TestResult): ValidationIssue[] {
  if (result.decision !== 'PASS') return [];
  const scores = result.scores; const issues: ValidationIssue[] = [];
  for (const key of ['semantic_coherence', 'curatorial_originality', 'narrative_integrity', 'visual_composition'] as const) if (scores[key] < 4) issues.push(fail('PASS_SCORE_THRESHOLD', `${key} must be at least 4 for PASS`));
  if (scores.evidence_integrity !== 5) issues.push(fail('PASS_EVIDENCE_SCORE', 'evidence_integrity must equal 5 for PASS'));
  if (result.blocking_issues.length) issues.push(fail('PASS_BLOCKING_ISSUES', 'PASS requires an empty blocking_issues array'));
  return issues;
}

export function validateCandidate(candidate: Candidate, snapshot: Snapshot, records: readonly DiscoveryRecord[]): ValidationIssue[] {
  const discoveryIssues = validateDiscoveryRecords(records);
  const safeRecords = buildUnambiguousDiscoveryRecords(records);
  const issues: ValidationIssue[] = [...discoveryIssues];
  issues.push(...validateCandidateSourcesPresent(candidate, safeRecords));
  issues.push(...validateObservationRefs(candidate, safeRecords));
  issues.push(...validateDistinctEdges(candidate));
  issues.push(...validateCandidateGraph(candidate));
  issues.push(...validateEvidenceAgainstSnapshot(candidate, snapshot, safeRecords));
  try {
    const expectedId = computeCandidateId(snapshot.content_sha256, candidate.source_ids);
    if (candidate.candidate_id !== expectedId) issues.push(fail('CANDIDATE_ID_MISMATCH', 'candidate_id does not match canonical snapshot/source identity'));
  } catch {
    issues.push(fail('CANDIDATE_ID_MISMATCH', 'candidate identity inputs are invalid'));
  }
  return issues;
}
