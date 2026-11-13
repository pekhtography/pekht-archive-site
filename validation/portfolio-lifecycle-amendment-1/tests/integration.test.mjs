import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import {
  computeCandidateId,
  validateCandidate,
  validateDiscoveryCoverage,
  validateDiscoveryRecords,
} from "../../portfolio-validation-0.2.1/src/validators.ts";
import { validateLifecycleAmendment1 } from "../runtime/validate-amendment-1.mjs";

const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
import { createHash } from "node:crypto";

const snapshotHash = "c".repeat(64);
const sourceIds = Array.from({ length: 1000 }, (_, index) =>
  `source-${String(index).padStart(4, "0")}`);
const sourceA = sourceIds.slice(0, 6);
const sourceB = [...sourceIds.slice(0, 4), ...sourceIds.slice(6, 8)];
const candidateSources = [sourceA, sourceB];
const criteria = [
  "semantic_coherence",
  "curatorial_originality",
  "narrative_integrity",
  "evidence_integrity",
  "visual_composition_potential",
];

const snapshot = {
  content_sha256: snapshotHash,
  posts: sourceIds.map((source_id) => ({
    source_id,
    body: `Exact evidence quote for ${source_id}.`,
    original_markdown: `# ${source_id}\n\nExact evidence quote for ${source_id}.`,
  })),
};

const candidateSourceSet = new Set([...sourceA, ...sourceB]);
const discoveryRecords = sourceIds.map((source_id) => {
  const observations = candidateSourceSet.has(source_id)
    ? [{
        prism: "Motif",
        signal: "recurring textual detail",
        interpretation: "A publication-level textual observation",
        evidence: [{ source: "BODY", quote: `Exact evidence quote for ${source_id}` }],
      }]
    : [];
  return {
    source_id,
    result: observations.length ? "SIGNALS_FOUND" : "NO_SIGNAL",
    observations,
  };
});

function makeCandidate(ids) {
  const observation_ids = ids.map((id) => `${id}:0`);
  const relationships = [];
  for (let index = 0; index < ids.length - 1; index += 1) {
    relationships.push({
      source_a: ids[index],
      source_b: ids[index + 1],
      type: "resonance",
      explanation: "The two publications share a grounded textual relationship.",
      observation_ids: [observation_ids[index], observation_ids[index + 1]],
    });
  }
  return {
    candidate_id: computeCandidateId(snapshotHash, ids),
    source_ids: [...ids],
    observation_ids,
    relationships,
  };
}

const candidates = candidateSources.map(makeCandidate);
const [candidateA, candidateB] = candidates;
const candidateAId = candidateA.candidate_id;
const candidateBId = candidateB.candidate_id;
const orderedPair = [candidateAId, candidateBId].sort();
const pairWinnerOutcome = orderedPair[0] === candidateAId ? "A_WINS" : "B_WINS";

function artifact(value) {
  const content = JSON.stringify(value);
  return { artifact_ref: `memory://${hash(content)}`, content };
}

function makeEvaluation(candidate, firstScore) {
  return {
    candidate_id: candidate.candidate_id,
    criteria: criteria.map((criterion, index) => ({
      criterion,
      score: index === 0 ? firstScore : 4,
      rationale: "Grounded fixture rationale.",
      evidence: [{
        kind: index === 4 ? "SOURCE_IMAGE" : "OBSERVATION",
        ...(index === 4
          ? { source_id: candidate.source_ids[0] }
          : { observation_id: candidate.observation_ids[0] }),
      }],
    })),
    blocking_issues: [],
  };
}

function makeIntegratedInput() {
  const candidateArtifacts = Object.fromEntries(candidates.map((candidate) => [
    candidate.candidate_id,
    artifact(candidate),
  ]));
  const poolEntries = candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    source_ids: candidate.source_ids,
    artifact_ref: candidateArtifacts[candidate.candidate_id].artifact_ref,
    content_sha256: hash(candidateArtifacts[candidate.candidate_id].content),
  }));
  const candidatePool = {
    schema_version: "1.0",
    snapshot_sha256: snapshotHash,
    generation_status: "COMPLETE",
    candidates: poolEntries,
  };
  const candidateValidationReport = {
    schema_version: "1.0",
    snapshot_sha256: snapshotHash,
    results: candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      source_ids: candidate.source_ids,
      status: "PASS",
      errors: [],
    })),
  };
  const stage1 = {
    schema_version: "1.0",
    snapshot_sha256: snapshotHash,
    candidate_pool_ids: [candidateAId, candidateBId],
    evaluations: [makeEvaluation(candidateA, 5), makeEvaluation(candidateB, 4)],
    stage1_ranking: [candidateAId, candidateBId],
    preliminary_finalists: [candidateAId, candidateBId],
  };
  const stage2 = {
    schema_version: "1.0",
    snapshot_sha256: snapshotHash,
    finalists: [candidateAId, candidateBId],
    candidate_source_ids_by_id: {
      [candidateAId]: sourceA,
      [candidateBId]: sourceB,
    },
    comparisons: [{
      candidate_a_id: orderedPair[0],
      candidate_b_id: orderedPair[1],
      outcome: pairWinnerOutcome,
      rationale: "Candidate A has the stronger grounded curatorial structure.",
      evidence: [{ kind: "OBSERVATION", observation_id: candidateA.observation_ids[0] }],
    }],
    standings: [
      {
        candidate_id: candidateAId,
        wins: 1,
        losses: 0,
        draws: 0,
        copeland_score: 1,
      },
      {
        candidate_id: candidateBId,
        wins: 0,
        losses: 1,
        draws: 0,
        copeland_score: -1,
      },
    ],
    final_ranking: [candidateAId, candidateBId],
    shortlist: [candidateAId],
  };
  const artifactContents = {
    discovery: artifact(discoveryRecords),
    candidate_pool: artifact(candidatePool),
    candidate_validation: artifact(candidateValidationReport),
    stage1: artifact(stage1),
    stage2: artifact(stage2),
  };
  const audit = {
    schema_version: "2.0",
    snapshot_source_ids: sourceIds,
    processed_source_ids: sourceIds,
    discovery_artifact: {
      artifact_ref: artifactContents.discovery.artifact_ref,
      content_sha256: hash(artifactContents.discovery.content),
      record_count: 1000,
    },
    candidate_pool_artifact: {
      artifact_ref: artifactContents.candidate_pool.artifact_ref,
      content_sha256: hash(artifactContents.candidate_pool.content),
    },
    candidate_validation_artifact: {
      artifact_ref: artifactContents.candidate_validation.artifact_ref,
      content_sha256: hash(artifactContents.candidate_validation.content),
    },
    candidate_pool_ids: [candidateAId, candidateBId],
    shortlist_ids: [candidateAId],
    candidate_source_ids_by_id: {
      [candidateAId]: sourceA,
      [candidateBId]: sourceB,
    },
    global_comparison: {
      status: "COMPLETED",
      stage1_artifact: {
        artifact_ref: artifactContents.stage1.artifact_ref,
        content_sha256: hash(artifactContents.stage1.content),
      },
      stage2_artifact: {
        artifact_ref: artifactContents.stage2.artifact_ref,
        content_sha256: hash(artifactContents.stage2.content),
      },
    },
    revision_cycles_by_candidate: {},
    model_calls: [],
  };

  return {
    snapshot: { source_ids: sourceIds, content_sha256: snapshotHash },
    discoveryRecords,
    candidateArtifacts,
    candidatePool,
    candidateValidationReport,
    stage1,
    stage2,
    audit,
    artifactContents,
  };
}

const candidateSchema = JSON.parse(await readFile(
  new URL("../../portfolio-validation-0.2.1/schemas/candidate.schema.json", import.meta.url),
  "utf8",
));
const validateCandidateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(candidateSchema);

test("runs Validation 0.2.1 Candidate gates before Amendment 1 runtime gate on the same artifacts", () => {
  const input = makeIntegratedInput();

  assert.deepEqual(validateDiscoveryRecords(input.discoveryRecords), []);
  assert.deepEqual(validateDiscoveryCoverage(snapshot, input.discoveryRecords), []);

  for (const candidate of candidates) {
    assert.equal(
      validateCandidateSchema(candidate),
      true,
      JSON.stringify(validateCandidateSchema.errors, null, 2),
    );
    assert.deepEqual(validateCandidate(candidate, snapshot, input.discoveryRecords), []);
  }

  const amendmentResult = validateLifecycleAmendment1(input);
  assert.deepEqual(amendmentResult, { valid: true, errors: [] });
});

test("the integrated Candidate gate rejects evidence that is not an exact Snapshot substring", () => {
  const invalidCandidate = structuredClone(candidateA);
  const invalidRecordSet = structuredClone(discoveryRecords);
  invalidRecordSet.find((record) => record.source_id === sourceA[0])
    .observations[0].evidence[0].quote = "This quote is not present in the Snapshot.";

  assert.equal(validateCandidateSchema(invalidCandidate), true);
  const issues = validateCandidate(invalidCandidate, snapshot, invalidRecordSet);
  assert.ok(issues.some((issue) => issue.code === "EVIDENCE_NOT_FOUND"));
});


function makeRejectedProposal() {
  const rejectedSourceIds = sourceIds.slice(8, 14);
  const candidate = makeCandidate(rejectedSourceIds);
  const records = structuredClone(discoveryRecords);
  for (const sourceId of rejectedSourceIds) {
    const record = records.find((item) => item.source_id === sourceId);
    record.result = "SIGNALS_FOUND";
    record.observations = [{
      prism: "Motif",
      signal: "recurring textual detail",
      interpretation: "A publication-level textual observation",
      evidence: [{ source: "BODY", quote: "A fabricated quote absent from the Snapshot." }],
    }];
  }
  return { candidate, records, rejectedSourceIds };
}

test("preserves rejected proposals in the report without admitting them to the Candidate Pool", () => {
  const input = makeIntegratedInput();
  const { candidate, records } = makeRejectedProposal();
  const candidateIssues = validateCandidate(candidate, snapshot, records);

  assert.ok(candidateIssues.some((issue) => issue.code === "EVIDENCE_NOT_FOUND"));
  assert.equal(validateCandidateSchema(candidate), true);

  input.discoveryRecords = records;
  input.artifactContents.discovery = artifact(records);
  input.audit.discovery_artifact = {
    artifact_ref: input.artifactContents.discovery.artifact_ref,
    content_sha256: hash(input.artifactContents.discovery.content),
    record_count: 1000,
  };
  input.candidateValidationReport.results.push({
    candidate_id: candidate.candidate_id,
    source_ids: candidate.source_ids,
    status: "REJECTED",
    errors: candidateIssues.map((issue) => `${issue.code}: ${issue.message}`),
  });
  input.artifactContents.candidate_validation = artifact(input.candidateValidationReport);
  input.audit.candidate_validation_artifact = {
    artifact_ref: input.artifactContents.candidate_validation.artifact_ref,
    content_sha256: hash(input.artifactContents.candidate_validation.content),
  };

  assert.deepEqual(validateLifecycleAmendment1(input), { valid: true, errors: [] });
  assert.equal(input.candidatePool.candidates.some((entry) =>
    entry.candidate_id === candidate.candidate_id), false);
});

test("a completed run with every proposal rejected is a valid empty-pool content outcome", () => {
  const input = makeIntegratedInput();
  const { candidate, records } = makeRejectedProposal();
  const candidateIssues = validateCandidate(candidate, snapshot, records);

  input.discoveryRecords = records;
  input.artifactContents.discovery = artifact(records);
  input.audit.discovery_artifact = {
    artifact_ref: input.artifactContents.discovery.artifact_ref,
    content_sha256: hash(input.artifactContents.discovery.content),
    record_count: 1000,
  };
  input.candidatePool.candidates = [];
  input.candidateValidationReport.results = [{
    candidate_id: candidate.candidate_id,
    source_ids: candidate.source_ids,
    status: "REJECTED",
    errors: candidateIssues.map((issue) => `${issue.code}: ${issue.message}`),
  }];
  input.candidateArtifacts = {};
  input.stage1 = null;
  input.stage2 = null;
  input.audit.candidate_pool_ids = [];
  input.audit.shortlist_ids = [];
  input.audit.candidate_source_ids_by_id = {};
  input.audit.global_comparison = { status: "NOT_APPLICABLE_EMPTY_POOL" };
  input.artifactContents.candidate_pool = artifact(input.candidatePool);
  input.artifactContents.candidate_validation = artifact(input.candidateValidationReport);
  input.audit.candidate_pool_artifact = {
    artifact_ref: input.artifactContents.candidate_pool.artifact_ref,
    content_sha256: hash(input.artifactContents.candidate_pool.content),
  };
  input.audit.candidate_validation_artifact = {
    artifact_ref: input.artifactContents.candidate_validation.artifact_ref,
    content_sha256: hash(input.artifactContents.candidate_validation.content),
  };
  delete input.artifactContents.stage1;
  delete input.artifactContents.stage2;

  assert.ok(candidateIssues.some((issue) => issue.code === "EVIDENCE_NOT_FOUND"));
  assert.deepEqual(validateLifecycleAmendment1(input), { valid: true, errors: [] });
});

test("does not accept a technical Candidate Generation failure as a completed empty pool", () => {
  const input = makeIntegratedInput();
  input.candidatePool.candidates = [];
  input.candidatePool.generation_status = "FAILED";
  const result = validateLifecycleAmendment1(input);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) =>
    error.includes("generation_status must be COMPLETE")));
});
