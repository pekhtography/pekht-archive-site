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
