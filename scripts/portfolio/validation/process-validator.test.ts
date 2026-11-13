import test from "node:test";
import assert from "node:assert/strict";
import { validatePortfolioProcess } from "./process-validator.ts";
const ids=Array.from({length:1000},(_,i)=>`source-${i}`);
function audit(overrides:Record<string,unknown>={}) { return {
  snapshotSourceIds:ids,processedSourceIds:[...ids],candidateIds:["candidate-1"],candidateSourceIdsById:{"candidate-1":ids.slice(0,6)},globalComparisonCompleted:true,revisionCyclesByCandidate:{"candidate-1":2},
  modelCalls:[
    {call_id:"discover-1",stage:"DISCOVER",candidate_id:null,model:"model-a",fallback_index:0,attempts:3,outcome:"FALLBACK"},
    {call_id:"discover-1",stage:"DISCOVER",candidate_id:null,model:"model-b",fallback_index:1,attempts:1,outcome:"SUCCESS"},
    {call_id:"compose-1",stage:"COMPOSE",candidate_id:"candidate-1",model:"model-a",fallback_index:0,attempts:1,outcome:"SUCCESS"}
  ],...overrides
} as any; }
test("accepts complete coverage and valid fallback chain",()=>assert.deepEqual(validatePortfolioProcess(audit()),{ok:true,errors:[]}));
test("rejects incomplete source coverage",()=>{const v=audit();v.processedSourceIds.pop();assert.equal(validatePortfolioProcess(v).ok,false);});
test("rejects more than ten global candidates",()=>assert.equal(validatePortfolioProcess(audit({candidateIds:Array.from({length:11},(_,i)=>`candidate-${i}`)})).ok,false));
test("rejects when global comparison has not completed",()=>assert.equal(validatePortfolioProcess(audit({globalComparisonCompleted:false})).ok,false));
test("rejects candidate composition with fewer than six sources",()=>assert.equal(validatePortfolioProcess(audit({candidateSourceIdsById:{"candidate-1":["source-1"]}})).ok,false));
test("rejects more than two artistic revisions",()=>assert.equal(validatePortfolioProcess(audit({revisionCyclesByCandidate:{"candidate-1":3}})).ok,false));
test("rejects broken fallback accounting",()=>{const v=audit();v.modelCalls[0].outcome="SUCCESS";assert.equal(validatePortfolioProcess(v).ok,false);});

test("rejects process audit source IDs that differ from the loaded snapshot",()=>assert.equal(validatePortfolioProcess(audit(),{actualSnapshotSourceIds:[...ids.slice(1),"outside"]}).ok,false));
test("rejects a selected candidate absent from the global shortlist",()=>assert.equal(validatePortfolioProcess(audit(),{selectedCandidateId:"candidate-unknown"}).ok,false));
test("rejects revision count that differs from the selected candidate audit",()=>assert.equal(validatePortfolioProcess(audit(),{selectedCandidateId:"candidate-1",reportedRevisionCycles:1}).ok,false));


function lifecycleCalls(stages: string[]) {
  return stages.map((stage, index) => ({
    call_id: `logical-${index}`, stage, candidate_id: "candidate-1",
    model: "model-a", fallback_index: 0, attempts: 1, outcome: "SUCCESS",
  }));
}
test("strict lifecycle accepts COMPOSE → TEST → REVISION → TEST", () => {
  const value = audit({ revisionCyclesByCandidate: { "candidate-1": 1 }, modelCalls: lifecycleCalls(["COMPOSE", "TEST", "REVISION", "TEST"]) });
  assert.deepEqual(validatePortfolioProcess(value, { requireCandidateLifecycle: true }), { ok: true, errors: [] });
});
test("strict lifecycle rejects TEST before COMPOSE", () => {
  const checked = validatePortfolioProcess(audit({ modelCalls: lifecycleCalls(["TEST", "COMPOSE"]) }), { requireCandidateLifecycle: true });
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((error) => error.startsWith("CANDIDATE_LIFECYCLE_MUST_START_WITH_COMPOSE")));
});
test("strict lifecycle rejects REVISION without a following TEST", () => {
  const value = audit({ revisionCyclesByCandidate: { "candidate-1": 1 }, modelCalls: lifecycleCalls(["COMPOSE", "TEST", "REVISION"]) });
  const checked = validatePortfolioProcess(value, { requireCandidateLifecycle: true });
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((error) => error.startsWith("CANDIDATE_LIFECYCLE_REVISION_MUST_BE_FOLLOWED_BY_TEST")));
});

function candidateCall(candidateId: string, stage: string, index: number) {
  return {
    call_id: `global-${candidateId}-${index}`,
    stage,
    candidate_id: candidateId,
    model: "model-a",
    fallback_index: 0,
    attempts: 1,
    outcome: "SUCCESS",
  };
}
function candidateResult(candidate_id: string, status: "APPROVED" | "REJECTED" | "REVISION_EXHAUSTED" | "INCOMPLETE", revision_cycles: number, decision: "APPROVE" | "REJECT" | null) {
  return {
    candidate_id,
    status,
    revision_cycles,
    composition: status === "INCOMPLETE" ? null : {} as any,
    independent_test: decision ? { candidate_id, decision } as any : null,
    findings: [],
  } as any;
}

test("global lifecycle accepts REVISION_EXHAUSTED followed by the next approved candidate", () => {
  const first = "candidate-1";
  const second = "candidate-2";
  const calls = [
    candidateCall(first, "COMPOSE", 0), candidateCall(first, "TEST", 1),
    candidateCall(first, "REVISION", 2), candidateCall(first, "TEST", 3),
    candidateCall(first, "REVISION", 4), candidateCall(first, "TEST", 5),
    candidateCall(second, "COMPOSE", 0), candidateCall(second, "TEST", 1),
  ];
  const value = audit({
    candidateIds: [first, second],
    candidateSourceIdsById: { [first]: ids.slice(0, 6), [second]: ids.slice(6, 12) },
    revisionCyclesByCandidate: { [first]: 2, [second]: 0 },
    modelCalls: calls,
  });
  const candidateResults = [
    candidateResult(first, "REVISION_EXHAUSTED", 2, "REJECT"),
    candidateResult(second, "APPROVED", 0, "APPROVE"),
  ];
  assert.deepEqual(validatePortfolioProcess(value, { requireCandidateLifecycle: true, candidateResults }), { ok: true, errors: [] });
});

test("global lifecycle rejects processing another candidate after APPROVED", () => {
  const first = "candidate-1";
  const second = "candidate-2";
  const calls = [
    candidateCall(first, "COMPOSE", 0), candidateCall(first, "TEST", 1),
    candidateCall(second, "COMPOSE", 0), candidateCall(second, "TEST", 1),
  ];
  const value = audit({
    candidateIds: [first, second],
    candidateSourceIdsById: { [first]: ids.slice(0, 6), [second]: ids.slice(6, 12) },
    revisionCyclesByCandidate: { [first]: 0, [second]: 0 },
    modelCalls: calls,
  });
  const candidateResults = [
    candidateResult(first, "APPROVED", 0, "APPROVE"),
    candidateResult(second, "APPROVED", 0, "APPROVE"),
  ];
  const checked = validatePortfolioProcess(value, { requireCandidateLifecycle: true, candidateResults });
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((error) => error.startsWith("CANDIDATE_PROCESSING_CONTINUED_AFTER_TERMINAL_STATUS")));
});

test("global lifecycle rejects candidate calls that revisit an earlier candidate", () => {
  const first = "candidate-1";
  const second = "candidate-2";
  const calls = [
    candidateCall(first, "COMPOSE", 0), candidateCall(first, "TEST", 1),
    candidateCall(second, "COMPOSE", 0), candidateCall(second, "TEST", 1),
    candidateCall(first, "REVISION", 2), candidateCall(first, "TEST", 3),
  ];
  const value = audit({
    candidateIds: [first, second],
    candidateSourceIdsById: { [first]: ids.slice(0, 6), [second]: ids.slice(6, 12) },
    revisionCyclesByCandidate: { [first]: 1, [second]: 0 },
    modelCalls: calls,
  });
  const candidateResults = [
    candidateResult(first, "REJECTED", 1, "REJECT"),
    candidateResult(second, "APPROVED", 0, "APPROVE"),
  ];
  const checked = validatePortfolioProcess(value, { requireCandidateLifecycle: true, candidateResults });
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.includes("CANDIDATE_CALL_SEQUENCE_REVISITED: candidate_id=candidate-1"));
});

test("global lifecycle rejects results that skip or reorder the global shortlist", () => {
  const first = "candidate-1";
  const second = "candidate-2";
  const value = audit({
    candidateIds: [first, second],
    candidateSourceIdsById: { [first]: ids.slice(0, 6), [second]: ids.slice(6, 12) },
    revisionCyclesByCandidate: { [second]: 0 },
    modelCalls: [candidateCall(second, "COMPOSE", 0), candidateCall(second, "TEST", 1)],
  });
  const checked = validatePortfolioProcess(value, {
    requireCandidateLifecycle: true,
    candidateResults: [candidateResult(second, "APPROVED", 0, "APPROVE")],
  });
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((error) => error.startsWith("CANDIDATE_RESULT_ORDER_MISMATCH")));
});
