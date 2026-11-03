import { isNonEmptyString, result } from "./shared.ts";
import type { ModelCallRecord, ProcessAudit, ValidationResult } from "./types.ts";
function validateCallChains(calls: readonly ModelCallRecord[], errors: string[]) {
  const groups = new Map<string,ModelCallRecord[]>();
  for (const call of calls) {
    if (!isNonEmptyString(call.call_id)) { errors.push("MODEL_CALL_ID_MISSING"); continue; }
    const group = groups.get(call.call_id) ?? [];
    group.push(call); groups.set(call.call_id,group);
  }
  for (const [callId,chain] of groups) {
    const ordered = [...chain].sort((a,b) => a.fallback_index-b.fallback_index);
    const first = ordered[0]; const seen = new Set<number>();
    ordered.forEach((call,index) => {
      if (seen.has(call.fallback_index)) errors.push(`MODEL_FALLBACK_INDEX_DUPLICATE: call_id=${callId}`);
      seen.add(call.fallback_index);
      if (call.fallback_index !== index) errors.push(`MODEL_FALLBACK_INDEX_GAP: call_id=${callId}`);
      if (call.stage !== first.stage || call.candidate_id !== first.candidate_id) errors.push(`MODEL_CALL_CHAIN_MISMATCH: call_id=${callId}`);
      if (index < ordered.length-1 && call.outcome !== "FALLBACK") errors.push(`MODEL_FALLBACK_CHAIN_BROKEN: call_id=${callId}`);
    });
    const last = ordered.at(-1);
    if (last?.outcome === "FALLBACK") errors.push(`MODEL_FALLBACK_CHAIN_UNRESOLVED: call_id=${callId}`);
  }
}
export function validatePortfolioProcess(audit: ProcessAudit): ValidationResult {
  const errors: string[] = [];
  const snapshot = audit.snapshotSourceIds, processed = audit.processedSourceIds, candidates = audit.candidateIds;
  if (snapshot.length !== 1000) errors.push(`SNAPSHOT_COUNT_INVALID: expected 1000, received ${snapshot.length}`);
  if (new Set(snapshot).size !== snapshot.length) errors.push("SNAPSHOT_DUPLICATE_SOURCE_IDS");
  if (processed.length !== new Set(processed).size) errors.push("PROCESSED_DUPLICATE_SOURCE_IDS");
  if (processed.length !== snapshot.length || snapshot.some((id) => !processed.includes(id))) errors.push("PROCESS_COVERAGE_INCOMPLETE: all 1000 snapshot source_ids must be accounted for");
  if (processed.some((id) => !snapshot.includes(id))) errors.push("PROCESSED_SOURCE_OUTSIDE_SNAPSHOT");
  if (audit.globalComparisonCompleted !== true) errors.push("GLOBAL_COMPARISON_NOT_COMPLETED");
  if (candidates.length > 10) errors.push(`CANDIDATE_LIMIT_EXCEEDED: maximum 10, received ${candidates.length}`);
  if (new Set(candidates).size !== candidates.length) errors.push("CANDIDATE_IDS_DUPLICATED");
  if (candidates.some((id) => !isNonEmptyString(id))) errors.push("CANDIDATE_ID_INVALID");
  for (const candidateId of candidates) {
    const sourceIds = audit.candidateSourceIdsById?.[candidateId];
    if (!Array.isArray(sourceIds) || sourceIds.length !== 6 || new Set(sourceIds).size !== 6) errors.push(`CANDIDATE_SOURCE_SET_INVALID: candidate_id=${candidateId} must contain six unique source_ids`);
    else if (sourceIds.some((id) => !snapshot.includes(id))) errors.push(`CANDIDATE_SOURCE_OUTSIDE_SNAPSHOT: candidate_id=${candidateId}`);
  }
  for (const [candidateId,cycles] of Object.entries(audit.revisionCyclesByCandidate ?? {})) {
    if (!candidates.includes(candidateId)) errors.push(`REVISION_UNKNOWN_CANDIDATE: ${candidateId}`);
    if (!Number.isInteger(cycles) || cycles < 0 || cycles > 2) errors.push(`REVISION_LIMIT_INVALID: candidate_id=${candidateId}, cycles=${cycles}`);
  }
  for (const call of audit.modelCalls) {
    if (!isNonEmptyString(call.call_id) || !isNonEmptyString(call.model)) errors.push("MODEL_CALL_ID_OR_MODEL_INVALID");
    if (!Number.isInteger(call.attempts) || call.attempts < 1) errors.push(`MODEL_ATTEMPTS_INVALID: call_id=${call.call_id}`);
    if (!["SUCCESS","FALLBACK","FAILED"].includes(call.outcome)) errors.push(`MODEL_OUTCOME_INVALID: call_id=${call.call_id}`);
    if (!Number.isInteger(call.fallback_index) || call.fallback_index < 0) errors.push(`MODEL_FALLBACK_INDEX_INVALID: call_id=${call.call_id}`);
    if (call.stage === "DISCOVER" && call.candidate_id !== null) errors.push(`DISCOVER_CANDIDATE_ID_MUST_BE_NULL: call_id=${call.call_id}`);
    if (call.stage !== "DISCOVER" && (!call.candidate_id || !candidates.includes(call.candidate_id))) errors.push(`MODEL_CALL_UNKNOWN_CANDIDATE: call_id=${call.call_id}`);
  }
  validateCallChains(audit.modelCalls,errors);
  return result(errors);
}
