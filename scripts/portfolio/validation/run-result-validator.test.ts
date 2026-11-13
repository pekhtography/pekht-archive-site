import test from "node:test";
import assert from "node:assert/strict";
import { validateRunResult } from "./run-result-validator.ts";
const snapshot={schema_version:"1.0",repository_commit:"a".repeat(40),generated_at:"2026-11-03T10:00:00Z",sampled_count:1000,content_sha256:"b".repeat(64)};
const gallery={source_ids:["a","b","c","d","e","f"],title:"Title",statement:"Statement",facets:["One","Two"],roles:["a","b","c","d","e","f"].map((source_id)=>({source_id,role:"Role",operation:"Operation",evidence:[{quote:"q",interpretation:"i"}],necessity:"Necessary"})),composition_rationale:"Rationale",alternatives_considered:[],doubts:[]};
const output=(galleryValue:unknown,decision:"APPROVE"|"REJECT")=>({gallery:galleryValue,test:{decision,findings:[],revision_cycles:0}});
const validation={status:"PASS",structural:"PASS",semantic:"PASS",process:"PASS",findings:[]};
const base={input_snapshot:snapshot,validation,model_used:[]};
test("accepts APPROVED with all validation levels passing",()=>assert.equal(validateRunResult({...base,status:"APPROVED",gemini_output:output(gallery,"APPROVE")}).ok,true));
test("accepts NO_GALLERY only after completed rejection",()=>assert.equal(validateRunResult({...base,status:"NO_GALLERY",gemini_output:output(null,"REJECT")}).ok,true));
test("rejects APPROVED when semantic validation failed",()=>assert.equal(validateRunResult({...base,validation:{...validation,semantic:"FAIL"},status:"APPROVED",gemini_output:output(gallery,"APPROVE")}).ok,false));
test("accepts INCOMPLETE with failed validation and preserved Gemini output",()=>assert.equal(validateRunResult({...base,validation:{...validation,status:"FAIL",process:"FAIL"},status:"INCOMPLETE",gemini_output:output(gallery,"APPROVE")}).ok,true));
test("rejects malformed snapshot metadata",()=>assert.equal(validateRunResult({...base,input_snapshot:{...snapshot,content_sha256:"bad"},status:"NO_GALLERY",gemini_output:output(null,"REJECT")}).ok,false));

test("accepts separately stored composition, independent TEST and candidate lifecycle result",()=>{
  const candidateId="cand_"+"c".repeat(64);
  const independentTest={candidate_id:candidateId,decision:"APPROVE",scores:{semantic_coherence:4,curatorial_originality:4,narrative_integrity:4,visual_composition:4,evidence_integrity:5},findings:[],blocking_issues:[]};
  const candidate={candidate_id:candidateId,status:"APPROVED",composition:gallery,independent_test:independentTest,revision_cycles:1,findings:[]};
  const result=validateRunResult({...base,status:"APPROVED",gemini_output:output(gallery,"APPROVE"),composition:gallery,independent_test:independentTest,candidate_results:[candidate]});
  assert.equal(result.ok,true);
});
test("rejects candidate revision count above the two-revision limit",()=>{
  const candidate={candidate_id:"candidate-x",status:"REVISION_EXHAUSTED",composition:gallery,independent_test:null,revision_cycles:3,findings:["exhausted"]};
  const result=validateRunResult({...base,status:"INCOMPLETE",gemini_output:output(gallery,"APPROVE"),validation:{...validation,status:"FAIL"},candidate_results:[candidate]});
  assert.equal(result.ok,false);
});

test("accepts standalone APPROVED with legacy output null",()=>{
  const candidateId="cand_"+"d".repeat(64);
  const independentTest={candidate_id:candidateId,decision:"APPROVE",scores:{semantic_coherence:4,curatorial_originality:4,narrative_integrity:4,visual_composition:4,evidence_integrity:5},findings:[],blocking_issues:[]};
  const candidate={candidate_id:candidateId,status:"APPROVED",composition:gallery,independent_test:independentTest,revision_cycles:1,findings:[]};
  assert.equal(validateRunResult({...base,status:"APPROVED",gemini_output:null,composition:gallery,independent_test:independentTest,candidate_results:[candidate]}).ok,true);
});
test("rejects standalone APPROVED when the TEST candidate_id does not match the approved candidate",()=>{
  const candidateId="cand_"+"d".repeat(64);
  const testForOtherCandidate={candidate_id:"cand_"+"e".repeat(64),decision:"APPROVE",scores:{semantic_coherence:4,curatorial_originality:4,narrative_integrity:4,visual_composition:4,evidence_integrity:5},findings:[],blocking_issues:[]};
  const candidate={candidate_id:candidateId,status:"APPROVED",composition:gallery,independent_test:{...testForOtherCandidate,candidate_id:candidateId},revision_cycles:0,findings:[]};
  assert.equal(validateRunResult({...base,status:"APPROVED",gemini_output:null,composition:gallery,independent_test:testForOtherCandidate,candidate_results:[candidate]}).ok,false);
});
test("rejects malformed nested independent TEST scores",()=>{
  const candidateId="cand_"+"f".repeat(64);
  const invalidTest={candidate_id:candidateId,decision:"APPROVE",scores:{semantic_coherence:2},findings:[],blocking_issues:[]};
  const candidate={candidate_id:candidateId,status:"APPROVED",composition:gallery,independent_test:invalidTest,revision_cycles:0,findings:[]};
  assert.equal(validateRunResult({...base,status:"APPROVED",gemini_output:null,composition:gallery,independent_test:invalidTest,candidate_results:[candidate]}).ok,false);
});
test("accepts standalone NO_GALLERY after all candidates exhaust independent TEST",()=>{
  const candidateId="cand_"+"1".repeat(64);
  const rejectedTest={candidate_id:candidateId,decision:"REJECT",scores:{semantic_coherence:3,curatorial_originality:3,narrative_integrity:3,visual_composition:3,evidence_integrity:3},findings:[{criterion:"semantic_coherence",issue:"No coherent relation",blocking:true,evidence:{kind:"SOURCE",source_id:"source-1",quote:"Exact quote"}}],blocking_issues:["No coherent relation"]};
  const candidate={candidate_id:candidateId,status:"REVISION_EXHAUSTED",composition:gallery,independent_test:rejectedTest,revision_cycles:2,findings:["No coherent relation"]};
  assert.equal(validateRunResult({...base,status:"NO_GALLERY",gemini_output:null,composition:null,independent_test:null,candidate_results:[candidate]}).ok,true);
});
