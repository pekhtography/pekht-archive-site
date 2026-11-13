import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateLifecycleAmendment1 } from "../runtime/validate-amendment-1.mjs";

const hash = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const ids = Array.from({ length: 1000 }, (_, index) => `source-${String(index).padStart(4, "0")}`);
const candidateA = `cand_${"a".repeat(64)}`;
const candidateB = `cand_${"b".repeat(64)}`;
const criteria = [
  "semantic_coherence", "curatorial_originality", "narrative_integrity",
  "evidence_integrity", "visual_composition_potential",
];

function makeCandidate(id, sourceIds) {
  const observationIds = sourceIds.map((sourceId) => `${sourceId}:0`);
  return { candidate_id: id, source_ids: sourceIds, observation_ids: observationIds,
    relationships: [] };
}
function artifact(content) {
  const serialized = JSON.stringify(content);
  return { artifact_ref: `memory://${hash(serialized)}`, content: serialized };
}
function evaluation(id, sourceIds, score) {
  return {
    candidate_id: id,
    criteria: criteria.map((criterion, index) => ({
      criterion, score: index === 0 ? score : 4, rationale: "Supported test rationale",
      evidence: [{ kind: index === 4 ? "SOURCE_IMAGE" : "OBSERVATION",
        ...(index === 4 ? { source_id: sourceIds[0] } : { observation_id: `${sourceIds[0]}:0` }) }],
    })),
    blocking_issues: [],
  };
}
function makeValidInput() {
  const sourceA = ids.slice(0, 6);
  const sourceB = [...ids.slice(0, 4), ...ids.slice(6, 8)];
  const candidateRecords = [makeCandidate(candidateA, sourceA), makeCandidate(candidateB, sourceB)];
  const candidateArtifacts = Object.fromEntries(candidateRecords.map((candidate) => {
    const stored = artifact(candidate);
    return [candidate.candidate_id, stored];
  }));
  const entries = candidateRecords.map((candidate) => ({
    candidate_id: candidate.candidate_id, source_ids: candidate.source_ids,
    artifact_ref: candidateArtifacts[candidate.candidate_id].artifact_ref,
    content_sha256: hash(candidateArtifacts[candidate.candidate_id].content),
  }));
  const candidatePool = { schema_version: "1.0", snapshot_sha256: "c".repeat(64),
    generation_status: "COMPLETE", candidates: entries };
  const candidateValidationReport = { schema_version: "1.0", snapshot_sha256: "c".repeat(64),
    results: candidateRecords.map((candidate) => ({ candidate_id: candidate.candidate_id,
      source_ids: candidate.source_ids, status: "PASS", errors: [] })) };
  const discoveryRecords = ids.map((source_id) => ({
    source_id,
    observations: sourceA.includes(source_id) || sourceB.includes(source_id)
      ? [{ prism: "Motif", signal: "signal", interpretation: "interpretation",
          evidence: { source: "BODY", quote: "exact quote" } }]
      : [],
  }));
  const stage1 = {
    schema_version: "1.0", snapshot_sha256: "c".repeat(64),
    candidate_pool_ids: [candidateA, candidateB],
    evaluations: [evaluation(candidateA, sourceA, 5), evaluation(candidateB, sourceB, 4)],
    stage1_ranking: [candidateA, candidateB],
    preliminary_finalists: [candidateA, candidateB],
  };
  const stage2 = {
    schema_version: "1.0", snapshot_sha256: "c".repeat(64),
    finalists: [candidateA, candidateB],
    candidate_source_ids_by_id: { [candidateA]: sourceA, [candidateB]: sourceB },
    comparisons: [{ candidate_a_id: candidateA, candidate_b_id: candidateB,
      outcome: "A_WINS", rationale: "More coherent", evidence: [{ kind: "OBSERVATION",
        observation_id: `${sourceA[0]}:0` }] }],
    standings: [
      { candidate_id: candidateA, wins: 1, losses: 0, draws: 0, copeland_score: 1 },
      { candidate_id: candidateB, wins: 0, losses: 1, draws: 0, copeland_score: -1 },
    ],
    final_ranking: [candidateA, candidateB],
    shortlist: [candidateA],
  };
  const contents = {
    discovery: artifact(discoveryRecords),
    candidate_pool: artifact(candidatePool),
    candidate_validation: artifact(candidateValidationReport),
    stage1: artifact(stage1),
    stage2: artifact(stage2),
  };
  const audit = {
    schema_version: "2.0", snapshot_source_ids: ids, processed_source_ids: ids,
    discovery_artifact: { ...contents.discovery, record_count: 1000 },
    candidate_pool_artifact: contents.candidate_pool,
    candidate_validation_artifact: contents.candidate_validation,
    candidate_pool_ids: [candidateA, candidateB], shortlist_ids: [candidateA],
    candidate_source_ids_by_id: { [candidateA]: sourceA, [candidateB]: sourceB },
    global_comparison: { status: "COMPLETED",
      stage1_artifact: contents.stage1, stage2_artifact: contents.stage2 },
    revision_cycles_by_candidate: {}, model_calls: [],
  };
  return {
    snapshot: { source_ids: ids, content_sha256: "c".repeat(64) },
    discoveryRecords, candidateArtifacts, candidatePool, candidateValidationReport,
    stage1, stage2, audit, artifactContents: contents,
  };
}

test("accepts a complete, hash-consistent Amendment 1 lifecycle", () => {
  const result = validateLifecycleAmendment1(makeValidInput());
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("rejects an incomplete pairwise comparison matrix", () => {
  const input = makeValidInput();
  input.stage2.comparisons = [];
  const result = validateLifecycleAmendment1(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("every unordered finalist pair")));
});

test("rejects a Stage 1 ranking that does not follow the score tuple", () => {
  const input = makeValidInput();
  input.stage1.stage1_ranking = [candidateB, candidateA];
  const result = validateLifecycleAmendment1(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("ranking must be recomputed")));
});

test("rejects a Candidate artifact whose bytes do not match its recorded hash", () => {
  const input = makeValidInput();
  input.candidateArtifacts[candidateA].content += " ";
  const result = validateLifecycleAmendment1(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("reference/hash mismatch")));
});

test("rejects a shortlist that violates the maximum-three-source overlap rule", () => {
  const input = makeValidInput();
  input.stage2.shortlist = [candidateA, candidateB];
  input.audit.shortlist_ids = [candidateA, candidateB];
  const result = validateLifecycleAmendment1(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("greedy overlap-constrained")));
});
