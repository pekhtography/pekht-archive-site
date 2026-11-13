import { isNonEmptyString, result } from "./shared.ts";
import type { ModelCallRecord, PortfolioCandidateResult, ProcessAudit, ValidationResult } from "./types.ts";
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
export interface PortfolioProcessValidationContext {
  /** Source IDs read from the actual, verified input snapshot. */
  actualSnapshotSourceIds?: readonly string[];
  /** Candidate selected for this composition/test invocation. */
  selectedCandidateId?: string | null;
  /** Revision count reported by the independent Orchestrator lifecycle. */
  reportedRevisionCycles?: number;
  /** Require the standalone COMPOSE → TEST → (REVISION → TEST)* call sequence. */
  requireCandidateLifecycle?: boolean;
  /** Candidate results in actual Orchestrator processing order; used to audit global stop/continue semantics. */
  candidateResults?: readonly PortfolioCandidateResult[];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    new Set(left).size === new Set(right).size &&
    [...left].every((id) => right.includes(id));
}

export function validatePortfolioProcess(
  audit: ProcessAudit,
  context: PortfolioProcessValidationContext = {},
): ValidationResult {
  const errors: string[] = [];
  const snapshot = audit.snapshotSourceIds, processed = audit.processedSourceIds, candidates = audit.candidateIds;
  if (snapshot.length !== 1000) errors.push(`SNAPSHOT_COUNT_INVALID: expected 1000, received ${snapshot.length}`);
  if (new Set(snapshot).size !== snapshot.length) errors.push("SNAPSHOT_DUPLICATE_SOURCE_IDS");
  if (context.actualSnapshotSourceIds && !sameIds(snapshot, context.actualSnapshotSourceIds)) {
    errors.push("AUDIT_SNAPSHOT_MISMATCH: process audit source_ids do not match the loaded snapshot");
  }
  if (processed.length !== new Set(processed).size) errors.push("PROCESSED_DUPLICATE_SOURCE_IDS");
  if (processed.length !== snapshot.length || snapshot.some((id) => !processed.includes(id))) errors.push("PROCESS_COVERAGE_INCOMPLETE: all 1000 snapshot source_ids must be accounted for");
  if (processed.some((id) => !snapshot.includes(id))) errors.push("PROCESSED_SOURCE_OUTSIDE_SNAPSHOT");
  if (audit.globalComparisonCompleted !== true) errors.push("GLOBAL_COMPARISON_NOT_COMPLETED");
  if (candidates.length > 10) errors.push(`CANDIDATE_LIMIT_EXCEEDED: maximum 10, received ${candidates.length}`);
  if (new Set(candidates).size !== candidates.length) errors.push("CANDIDATE_IDS_DUPLICATED");
  if (candidates.some((id) => !isNonEmptyString(id))) errors.push("CANDIDATE_ID_INVALID");
  const selectedCandidateId = context.selectedCandidateId ?? null;
  if (selectedCandidateId !== null && !candidates.includes(selectedCandidateId)) {
    errors.push(`SELECTED_CANDIDATE_NOT_IN_GLOBAL_SHORTLIST: ${selectedCandidateId}`);
  }
  if (selectedCandidateId !== null && context.reportedRevisionCycles !== undefined) {
    const auditedCycles = audit.revisionCyclesByCandidate?.[selectedCandidateId];
    if (auditedCycles === undefined || auditedCycles !== context.reportedRevisionCycles) {
      errors.push(`REVISION_CYCLE_MISMATCH: candidate_id=${selectedCandidateId}, audit=${auditedCycles ?? "missing"}, gemini=${context.reportedRevisionCycles}`);
    }
  }
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
  if (context.requireCandidateLifecycle) {
    // Collapse fallback attempts into logical calls while preserving first-seen order.
    const logicalCalls: ModelCallRecord[] = [];
    const seenCallIds = new Set<string>();
    for (const call of audit.modelCalls) {
      if (seenCallIds.has(call.call_id)) continue;
      seenCallIds.add(call.call_id);
      logicalCalls.push(call);
    }
    for (const candidateId of candidates) {
      const calls = logicalCalls.filter((call) => call.candidate_id === candidateId);
      if (calls.length === 0) continue;
      const stages = calls.map((call) => call.stage);
      if (stages[0] !== "COMPOSE") {
        errors.push(`CANDIDATE_LIFECYCLE_MUST_START_WITH_COMPOSE: candidate_id=${candidateId}`);
        continue;
      }
      let index = 1;
      let revisions = 0;
      if (stages[index] !== "TEST") {
        errors.push(`CANDIDATE_LIFECYCLE_COMPOSE_MUST_BE_FOLLOWED_BY_TEST: candidate_id=${candidateId}`);
        continue;
      }
      index += 1;
      while (index < stages.length) {
        if (stages[index] !== "REVISION") {
          errors.push(`CANDIDATE_LIFECYCLE_EXPECTED_REVISION: candidate_id=${candidateId}, index=${index}`);
          break;
        }
        revisions += 1;
        if (revisions > 2) {
          errors.push(`CANDIDATE_LIFECYCLE_REVISION_LIMIT_EXCEEDED: candidate_id=${candidateId}`);
          break;
        }
        index += 1;
        if (stages[index] !== "TEST") {
          errors.push(`CANDIDATE_LIFECYCLE_REVISION_MUST_BE_FOLLOWED_BY_TEST: candidate_id=${candidateId}`);
          break;
        }
        index += 1;
      }
      const auditedCycles = audit.revisionCyclesByCandidate?.[candidateId];
      if (auditedCycles !== revisions) errors.push(`CANDIDATE_LIFECYCLE_REVISION_COUNT_MISMATCH: candidate_id=${candidateId}, calls=${revisions}, audit=${auditedCycles ?? "missing"}`);
    }
  }
  if (context.candidateResults) {
    const candidateResults = context.candidateResults;
    const expectedCandidates = context.selectedCandidateId !== null && context.selectedCandidateId !== undefined
      ? [context.selectedCandidateId]
      : [...candidates];
    const resultIds = candidateResults.map((candidate) => candidate.candidate_id);

    if (new Set(resultIds).size !== resultIds.length) errors.push("CANDIDATE_RESULT_IDS_DUPLICATED");
    if (resultIds.length > expectedCandidates.length) errors.push("CANDIDATE_RESULT_COUNT_EXCEEDS_SELECTED_CANDIDATES");
    resultIds.forEach((candidateId, index) => {
      if (expectedCandidates[index] !== candidateId) {
        errors.push(`CANDIDATE_RESULT_ORDER_MISMATCH: index=${index}, expected=${expectedCandidates[index] ?? "none"}, received=${candidateId}`);
      }
    });

    candidateResults.forEach((candidate, index) => {
      if ((candidate.status === "APPROVED" || candidate.status === "INCOMPLETE") && index !== candidateResults.length - 1) {
        errors.push(`CANDIDATE_PROCESSING_CONTINUED_AFTER_TERMINAL_STATUS: candidate_id=${candidate.candidate_id}, status=${candidate.status}`);
      }
      if (candidate.revision_cycles !== (audit.revisionCyclesByCandidate?.[candidate.candidate_id] ?? 0)) {
        errors.push(`CANDIDATE_RESULT_REVISION_COUNT_MISMATCH: candidate_id=${candidate.candidate_id}`);
      }
      if (candidate.status === "APPROVED" && candidate.independent_test?.decision !== "APPROVE") {
        errors.push(`CANDIDATE_APPROVED_WITHOUT_APPROVE_TEST: candidate_id=${candidate.candidate_id}`);
      }
      if ((candidate.status === "REJECTED" || candidate.status === "REVISION_EXHAUSTED") &&
          candidate.independent_test?.decision !== "REJECT") {
        errors.push(`CANDIDATE_REJECTED_WITHOUT_REJECT_TEST: candidate_id=${candidate.candidate_id}`);
      }
      if (candidate.status === "REVISION_EXHAUSTED" && candidate.revision_cycles !== 2) {
        errors.push(`CANDIDATE_REVISION_EXHAUSTED_WITHOUT_TWO_REVISIONS: candidate_id=${candidate.candidate_id}`);
      }
    });

    const logicalCalls: ModelCallRecord[] = [];
    const seenCallIds = new Set<string>();
    for (const call of audit.modelCalls) {
      if (seenCallIds.has(call.call_id)) continue;
      seenCallIds.add(call.call_id);
      logicalCalls.push(call);
    }
    const callsByCandidate = new Map<string, ModelCallRecord[]>();
    const callCandidateOrder: string[] = [];
    const closedCandidates = new Set<string>();
    let activeCandidate: string | null = null;
    for (const call of logicalCalls) {
      if (call.candidate_id === null) continue;
      const candidateId = call.candidate_id;
      const group = callsByCandidate.get(candidateId) ?? [];
      group.push(call);
      callsByCandidate.set(candidateId, group);
      if (!resultIds.includes(candidateId)) {
        errors.push(`MODEL_CALL_FOR_UNPROCESSED_CANDIDATE: candidate_id=${candidateId}`);
      }
      if (candidateId !== activeCandidate) {
        if (closedCandidates.has(candidateId)) {
          errors.push(`CANDIDATE_CALL_SEQUENCE_REVISITED: candidate_id=${candidateId}`);
        }
        if (activeCandidate !== null) closedCandidates.add(activeCandidate);
        activeCandidate = candidateId;
        callCandidateOrder.push(candidateId);
      }
    }

    const expectedCallOrder = resultIds.filter((candidateId) => callsByCandidate.has(candidateId));
    if (callCandidateOrder.length !== expectedCallOrder.length ||
        callCandidateOrder.some((candidateId, index) => candidateId !== expectedCallOrder[index])) {
      errors.push("CANDIDATE_MODEL_CALL_ORDER_MISMATCH");
    }

    for (const candidate of candidateResults) {
      const calls = callsByCandidate.get(candidate.candidate_id) ?? [];
      if (calls.length === 0 && candidate.status !== "INCOMPLETE") {
        errors.push(`CANDIDATE_RESULT_MISSING_MODEL_LIFECYCLE: candidate_id=${candidate.candidate_id}`);
        continue;
      }
      if (calls.length > 0) {
        const finalStage = calls[calls.length - 1].stage;
        if (candidate.status === "APPROVED" && finalStage !== "TEST") {
          errors.push(`APPROVED_CANDIDATE_DID_NOT_END_WITH_TEST: candidate_id=${candidate.candidate_id}`);
        }
        if ((candidate.status === "REJECTED" || candidate.status === "REVISION_EXHAUSTED") && finalStage !== "TEST") {
          errors.push(`REJECTED_CANDIDATE_DID_NOT_END_WITH_TEST: candidate_id=${candidate.candidate_id}`);
        }
      }
    }
  }
  return result(errors);
}
