import { createHash } from "node:crypto";

const CRITERIA = [
  "semantic_coherence",
  "curatorial_originality",
  "narrative_integrity",
  "evidence_integrity",
  "visual_composition_potential",
];
const CORPUS_STAGES = new Set(["DISCOVER", "CANDIDATE_GENERATION", "GLOBAL_COMPARISON"]);
const CANDIDATE_STAGES = new Set(["COMPOSE", "TEST", "REVISION"]);
const idSet = (values) => new Set(values);
const sameSet = (a, b) => a.length === b.length && idSet(a).size === a.length &&
  idSet(b).size === b.length && a.every((value) => idSet(b).has(value));
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const pairKey = (a, b) => [a, b].sort().join("\\u0000");
const observationOwner = (id) => {
  const separator = id.lastIndexOf(":");
  return separator > 0 ? id.slice(0, separator) : null;
};
const scoreTuple = (evaluation) => CRITERIA.map((criterion) =>
  evaluation.criteria.find((item) => item.criterion === criterion)?.score ?? -1
);
const compareTuple = (a, b) => {
  const left = scoreTuple(a), right = scoreTuple(b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return right[i] - left[i];
  }
  return a.candidate_id.localeCompare(b.candidate_id);
};
const unique = (values) => new Set(values).size === values.length;
const jsonParse = (value, label, errors) => {
  try { return JSON.parse(value); }
  catch { errors.push(`${label}: artifact content is not valid JSON`); return null; }
};

/**
 * Validate Amendment 1 cross-artifact and algorithmic invariants.
 *
 * artifactContents keys: discovery, candidate_pool, candidate_validation,
 * stage1, stage2. Each value is { artifact_ref, content } where content is the
 * exact UTF-8 byte string whose SHA-256 is recorded in the audit.
 * candidateArtifacts maps Candidate ID to { artifact_ref, content }; content
 * is the exact serialized Candidate JSON used for its content_sha256.
 *
 * Individual JSON Schema validation remains a separate mandatory gate.
 */
export function validateLifecycleAmendment1(input) {
  const errors = [];
  const {
    snapshot, discoveryRecords, candidateArtifacts, candidatePool,
    candidateValidationReport, stage1, stage2, audit, artifactContents,
  } = input ?? {};

  if (!snapshot || !Array.isArray(snapshot.source_ids) ||
      snapshot.source_ids.length !== 1000 || !unique(snapshot.source_ids)) {
    errors.push("snapshot: exactly 1000 unique source_ids are required");
  }
  const snapshotIds = snapshot?.source_ids ?? [];
  const snapshotSet = idSet(snapshotIds);
  if (!/^[a-f0-9]{64}$/.test(snapshot?.content_sha256 ?? "")) {
    errors.push("snapshot: content_sha256 must be a SHA-256 hex digest");
  }

  if (!Array.isArray(discoveryRecords) || discoveryRecords.length !== 1000) {
    errors.push("discovery: exactly 1000 records are required");
  }
  const discoveryBySource = new Map();
  for (const record of discoveryRecords ?? []) {
    if (!record || typeof record.source_id !== "string" ||
        discoveryBySource.has(record.source_id)) {
      errors.push("discovery: missing or duplicate source_id");
      continue;
    }
    discoveryBySource.set(record.source_id, record);
  }
  if (!sameSet([...discoveryBySource.keys()], snapshotIds)) {
    errors.push("discovery: record source_ids must exactly cover the Snapshot");
  }
  const observations = new Map();
  for (const record of discoveryRecords ?? []) {
    for (const [index, observation] of (record?.observations ?? []).entries()) {
      const id = `${record.source_id}:${index}`;
      if (observations.has(id)) errors.push(`discovery: duplicate observation id ${id}`);
      observations.set(id, record.source_id);
    }
  }

  const poolEntries = candidatePool?.candidates ?? [];
  const poolIds = poolEntries.map((item) => item.candidate_id);
  if (candidatePool?.generation_status !== "COMPLETE") {
    errors.push("candidate pool: generation_status must be COMPLETE");
  }
  if (poolEntries.length > 100 || !unique(poolIds)) {
    errors.push("candidate pool: maximum 100 unique Candidate IDs is required");
  }
  if (candidatePool?.snapshot_sha256 !== snapshot?.content_sha256 ||
      candidateValidationReport?.snapshot_sha256 !== snapshot?.content_sha256) {
    errors.push("candidate pool and validation report must identify the exact Snapshot hash");
  }

  const validationResults = candidateValidationReport?.results ?? [];
  const validationIds = validationResults.map((item) => item.candidate_id);
  if (!unique(validationIds)) errors.push("candidate validation: duplicate proposal IDs");
  const validationById = new Map(validationResults.map((item) => [item.candidate_id, item]));
  for (const entry of poolEntries) {
    const result = validationById.get(entry.candidate_id);
    if (!result || result.status !== "PASS" || result.errors?.length !== 0) {
      errors.push(`candidate validation: pool Candidate ${entry.candidate_id} lacks a clean PASS result`);
    }
    if (result && !sameSet(entry.source_ids, result.source_ids)) {
      errors.push(`candidate validation: source_ids mismatch for ${entry.candidate_id}`);
    }
    if (!Array.isArray(entry.source_ids) || entry.source_ids.length !== 6 ||
        !unique(entry.source_ids) || entry.source_ids.some((id) => !snapshotSet.has(id))) {
      errors.push(`candidate pool: invalid six-source membership for ${entry.candidate_id}`);
    }
    const stored = candidateArtifacts?.[entry.candidate_id];
    if (!stored || stored.artifact_ref !== entry.artifact_ref ||
        !stored.content || sha256(stored.content) !== entry.content_sha256) {
      errors.push(`candidate artifact: reference/hash mismatch for ${entry.candidate_id}`);
    } else {
      const candidate = jsonParse(stored.content, `candidate ${entry.candidate_id}`, errors);
      if (candidate) {
        if (candidate.candidate_id !== entry.candidate_id ||
            !sameSet(candidate.source_ids ?? [], entry.source_ids)) {
          errors.push(`candidate artifact: identity/source_ids mismatch for ${entry.candidate_id}`);
        }
        const candidateObservationIds = candidate.observation_ids ?? [];
        if (!Array.isArray(candidateObservationIds) ||
            candidateObservationIds.some((id) =>
              !observations.has(id) || !entry.source_ids.includes(observations.get(id)))) {
          errors.push(`candidate artifact: observation ownership mismatch for ${entry.candidate_id}`);
        }
      }
    }
  }
  for (const result of validationResults) {
    if (result.status === "PASS" && !poolIds.includes(result.candidate_id)) {
      errors.push(`candidate validation: PASS Candidate ${result.candidate_id} is absent from pool`);
    }
    if (result.status === "REJECTED" && (!Array.isArray(result.errors) || result.errors.length === 0)) {
      errors.push(`candidate validation: REJECTED Candidate ${result.candidate_id} has no reason`);
    }
  }

  if (!audit || audit.schema_version !== "2.0") errors.push("audit: schema_version 2.0 is required");
  if (!sameSet(audit?.snapshot_source_ids ?? [], snapshotIds)) {
    errors.push("audit: snapshot_source_ids must exactly match Snapshot");
  }
  if (!sameSet(audit?.processed_source_ids ?? [], snapshotIds)) {
    errors.push("audit: processed_source_ids must prove complete Discovery coverage");
  }
  if (!sameSet(audit?.candidate_pool_ids ?? [], poolIds)) {
    errors.push("audit: candidate_pool_ids must exactly match Candidate Pool");
  }
  if (!sameSet(audit?.candidate_source_ids_by_id ? Object.keys(audit.candidate_source_ids_by_id) : [], poolIds)) {
    errors.push("audit: candidate_source_ids_by_id must contain exactly the Candidate Pool");
  }
  for (const entry of poolEntries) {
    if (!sameSet(audit?.candidate_source_ids_by_id?.[entry.candidate_id] ?? [], entry.source_ids)) {
      errors.push(`audit: source ID map mismatch for ${entry.candidate_id}`);
    }
  }

  const checkArtifact = (key, reference, expectedHash) => {
    const stored = artifactContents?.[key];
    if (!stored || !reference || stored.artifact_ref !== reference.artifact_ref ||
        sha256(stored.content ?? "") !== (expectedHash ?? reference.content_sha256)) {
      errors.push(`artifact ${key}: missing content or reference/hash mismatch`);
      return null;
    }
    return jsonParse(stored.content, `artifact ${key}`, errors);
  };
  checkArtifact("discovery", audit?.discovery_artifact, audit?.discovery_artifact?.content_sha256);
  checkArtifact("candidate_pool", audit?.candidate_pool_artifact, audit?.candidate_pool_artifact?.content_sha256);
  checkArtifact("candidate_validation", audit?.candidate_validation_artifact, audit?.candidate_validation_artifact?.content_sha256);
  if (audit?.discovery_artifact?.record_count !== 1000) errors.push("audit: Discovery artifact record_count must equal 1000");

  const comparison = audit?.global_comparison;
  if (poolIds.length === 0) {
    if (comparison?.status !== "NOT_APPLICABLE_EMPTY_POOL" ||
        comparison.stage1_artifact || comparison.stage2_artifact ||
        stage1 != null || stage2 != null) {
      errors.push("global comparison: empty pool requires NOT_APPLICABLE_EMPTY_POOL and no Stage 1/2 artifacts");
    }
    if ((audit?.shortlist_ids ?? []).length !== 0) errors.push("audit: empty pool requires an empty shortlist");
  } else {
    if (comparison?.status !== "COMPLETED" || !stage1 || !stage2) {
      errors.push("global comparison: non-empty pool requires completed Stage 1 and Stage 2 artifacts");
    }
    if (stage1 && stage2) {
      const stage1Hash = comparison?.stage1_artifact?.content_sha256;
      const stage2Hash = comparison?.stage2_artifact?.content_sha256;
      checkArtifact("stage1", comparison?.stage1_artifact, stage1Hash);
      checkArtifact("stage2", comparison?.stage2_artifact, stage2Hash);
      if (stage1.snapshot_sha256 !== snapshot?.content_sha256 ||
          stage2.snapshot_sha256 !== snapshot?.content_sha256) {
        errors.push("global comparison: stage artifacts must identify the exact Snapshot hash");
      }
      if (!sameSet(stage1.candidate_pool_ids ?? [], poolIds)) {
        errors.push("Stage 1: candidate_pool_ids must exactly match Candidate Pool");
      }
      const evaluations = stage1.evaluations ?? [];
      const evaluationIds = evaluations.map((item) => item.candidate_id);
      if (!sameSet(evaluationIds, poolIds)) errors.push("Stage 1: exactly one evaluation per pool Candidate is required");
      const evaluationById = new Map(evaluations.map((item) => [item.candidate_id, item]));
      for (const evaluation of evaluations) {
        const criteria = evaluation.criteria ?? [];
        if (!sameSet(criteria.map((item) => item.criterion), CRITERIA)) {
          errors.push(`Stage 1: five unique criteria are required for ${evaluation.candidate_id}`);
        }
        const sourceIds = audit?.candidate_source_ids_by_id?.[evaluation.candidate_id] ?? [];
        for (const criterion of criteria) {
          for (const evidence of criterion.evidence ?? []) {
            if (evidence.kind === "OBSERVATION") {
              if (!observations.has(evidence.observation_id) ||
                  !sourceIds.includes(observations.get(evidence.observation_id))) {
                errors.push(`Stage 1: invalid observation evidence for ${evaluation.candidate_id}`);
              }
            } else if (evidence.kind === "SOURCE_IMAGE") {
              if (criterion.criterion !== "visual_composition_potential" ||
                  !sourceIds.includes(evidence.source_id)) {
                errors.push(`Stage 1: invalid image evidence for ${evaluation.candidate_id}`);
              }
            } else errors.push(`Stage 1: unsupported evidence kind for ${evaluation.candidate_id}`);
            if (criterion.criterion === "visual_composition_potential" && evidence.kind !== "SOURCE_IMAGE") {
              errors.push(`Stage 1: visual evidence must be SOURCE_IMAGE for ${evaluation.candidate_id}`);
            }
            if (criterion.criterion !== "visual_composition_potential" && evidence.kind !== "OBSERVATION") {
              errors.push(`Stage 1: semantic evidence must be OBSERVATION for ${evaluation.candidate_id}`);
            }
          }
        }
      }
      const eligible = evaluations.filter((item) => (item.blocking_issues ?? []).length === 0)
        .sort(compareTuple).map((item) => item.candidate_id);
      if (!sameOrdered(stage1.stage1_ranking ?? [], eligible)) {
        errors.push("Stage 1: ranking must be recomputed from eligible score tuples and Candidate ID");
      }
      const finalists = eligible.slice(0, 10);
      if (!sameOrdered(stage1.preliminary_finalists ?? [], finalists)) {
        errors.push("Stage 1: preliminary_finalists must be the first ten Stage 1 ranked Candidates");
      }

      if (!sameSet(stage2.finalists ?? [], finalists)) errors.push("Stage 2: finalists must exactly match Stage 1 finalists");
      if (!sameSet(Object.keys(stage2.candidate_source_ids_by_id ?? {}), finalists)) {
        errors.push("Stage 2: source ID map must contain exactly the finalists");
      }
      for (const id of finalists) {
        if (!sameSet(stage2.candidate_source_ids_by_id?.[id] ?? [],
          audit?.candidate_source_ids_by_id?.[id] ?? [])) {
          errors.push(`Stage 2: source ID map mismatch for finalist ${id}`);
        }
      }

      const expectedPairs = [];
      for (let i = 0; i < finalists.length; i += 1) {
        for (let j = i + 1; j < finalists.length; j += 1) {
          expectedPairs.push([finalists[i], finalists[j]].sort());
        }
      }
      const seenPairs = new Set();
      const totals = new Map(finalists.map((id) => [id, { wins: 0, losses: 0, draws: 0 }]));
      for (const pair of stage2.comparisons ?? []) {
        const { candidate_a_id: a, candidate_b_id: b, outcome } = pair;
        if (!a || !b || a >= b || !finalists.includes(a) || !finalists.includes(b)) {
          errors.push("Stage 2: pair must contain two distinct finalists in canonical lexical order");
          continue;
        }
        const key = pairKey(a, b);
        if (seenPairs.has(key)) errors.push(`Stage 2: duplicate pair ${a} / ${b}`);
        seenPairs.add(key);
        if (outcome === "A_WINS") { totals.get(a).wins += 1; totals.get(b).losses += 1; }
        else if (outcome === "B_WINS") { totals.get(b).wins += 1; totals.get(a).losses += 1; }
        else if (outcome === "DRAW") { totals.get(a).draws += 1; totals.get(b).draws += 1; }
        else errors.push(`Stage 2: invalid outcome for pair ${a} / ${b}`);
        for (const evidence of pair.evidence ?? []) {
          if (evidence.kind === "OBSERVATION" && !observations.has(evidence.observation_id)) {
            errors.push("Stage 2: comparison references an unknown observation");
          } else if (evidence.kind === "SOURCE_IMAGE" &&
            ![...(stage2.candidate_source_ids_by_id?.[a] ?? []), ...(stage2.candidate_source_ids_by_id?.[b] ?? [])].includes(evidence.source_id)) {
            errors.push("Stage 2: comparison image evidence is outside the compared Candidates");
          }
        }
      }
      if (seenPairs.size !== expectedPairs.length ||
          expectedPairs.some(([a, b]) => !seenPairs.has(pairKey(a, b)))) {
        errors.push("Stage 2: every unordered finalist pair must be compared exactly once");
      }
      const standings = stage2.standings ?? [];
      if (!sameSet(standings.map((item) => item.candidate_id), finalists)) {
        errors.push("Stage 2: exactly one Copeland standing per finalist is required");
      }
      for (const standing of standings) {
        const total = totals.get(standing.candidate_id);
        if (!total || standing.wins !== total.wins || standing.losses !== total.losses ||
            standing.draws !== total.draws ||
            standing.copeland_score !== total.wins - total.losses) {
          errors.push(`Stage 2: Copeland standing mismatch for ${standing.candidate_id}`);
        }
      }
      const expectedRanking = [...finalists].sort((a, b) => {
        const scoreDiff = (totals.get(b).wins - totals.get(b).losses) -
          (totals.get(a).wins - totals.get(a).losses);
        return scoreDiff || compareTuple(evaluationById.get(a), evaluationById.get(b));
      });
      if (!sameOrdered(stage2.final_ranking ?? [], expectedRanking)) {
        errors.push("Stage 2: final ranking must be recomputed from Copeland and Stage 1 tie-breaks");
      }
      const expectedShortlist = [];
      for (const id of expectedRanking) {
        const ids = stage2.candidate_source_ids_by_id?.[id] ?? [];
        const compatible = expectedShortlist.every((selected) => {
          const other = stage2.candidate_source_ids_by_id?.[selected] ?? [];
          return ids.filter((sourceId) => other.includes(sourceId)).length <= 3;
        });
        if (compatible && expectedShortlist.length < 10) expectedShortlist.push(id);
      }
      if (!sameOrdered(stage2.shortlist ?? [], expectedShortlist)) {
        errors.push("Stage 2: shortlist must be the greedy overlap-constrained scan of final ranking");
      }
      if (!sameOrdered(audit?.shortlist_ids ?? [], expectedShortlist)) {
        errors.push("audit: shortlist_ids must exactly match Stage 2 shortlist");
      }
    }
  }

  for (const call of audit?.model_calls ?? []) {
    if (CORPUS_STAGES.has(call.stage) && call.candidate_id !== null) {
      errors.push(`model calls: corpus stage ${call.stage} must have candidate_id=null`);
    }
    if (CANDIDATE_STAGES.has(call.stage) &&
        (!(audit?.shortlist_ids ?? []).includes(call.candidate_id) || typeof call.candidate_id !== "string")) {
      errors.push(`model calls: candidate stage ${call.stage} must reference a Candidate in the pool`);
    }
  }
  for (const [id, cycles] of Object.entries(audit?.revision_cycles_by_candidate ?? {})) {
    if (!(audit?.shortlist_ids ?? []).includes(id) || !Number.isInteger(cycles) || cycles < 0 || cycles > 2) {
      errors.push(`audit: invalid revision cycle count for ${id}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function sameOrdered(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);
}
