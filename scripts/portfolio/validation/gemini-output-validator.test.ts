import test from "node:test";
import assert from "node:assert/strict";
import { validateGeminiOutput } from "./gemini-output-validator.ts";
function validOutput() {
  const ids = ["a","b","c","d","e","f"];
  return { gallery: {
    source_ids: ids, title: "A title", statement: "A statement", facets: ["Light","Distance"],
    roles: ids.map((source_id) => ({ source_id, role: "Distinct function", operation: "Reframing", evidence: [{ quote: `Exact text ${source_id}`, interpretation: "Supports the operation" }], necessity: "Needed for composition" })),
    composition_rationale: "The six texts form a coherent statement.", alternatives_considered: [], doubts: []
  }, test: { decision: "APPROVE", findings: [], revision_cycles: 0 } };
}
test("accepts a complete six-source gallery", () => assert.deepEqual(validateGeminiOutput(validOutput()),{ok:true,errors:[]}));
test("accepts null gallery only with REJECT", () => {
  assert.equal(validateGeminiOutput({gallery:null,test:{decision:"REJECT",findings:[],revision_cycles:0}}).ok,true);
  assert.equal(validateGeminiOutput({gallery:null,test:{decision:"APPROVE",findings:[],revision_cycles:0}}).ok,false);
});
test("rejects wrong source count, duplicates and invalid facets", () => {
  const five:any=validOutput(); five.gallery.source_ids.pop(); assert.equal(validateGeminiOutput(five).ok,false);
  const dup:any=validOutput(); dup.gallery.source_ids[5]="a"; assert.equal(validateGeminiOutput(dup).ok,false);
  const facets:any=validOutput(); facets.gallery.facets=["one"]; assert.equal(validateGeminiOutput(facets).ok,false);
});
test("rejects extra root fields and final REVISION", () => {
  assert.equal(validateGeminiOutput({...validOutput(),model_used:[]}).ok,false);
  const rev:any=validOutput(); rev.test.decision="REVISION"; assert.equal(validateGeminiOutput(rev).ok,false);
});
test("leaves role/source correspondence to semantic validation", () => {
  const mismatch:any=validOutput(); mismatch.gallery.roles[0].source_id="other";
  assert.equal(validateGeminiOutput(mismatch).ok,true);
});
