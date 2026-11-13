import type { PortfolioOrchestratorInput, PortfolioOrchestratorDependencies } from "./orchestrator.ts";
import { generatePortfolioGallery, evaluateIndependentTest, type JsonSchema } from "./provider.ts";
import { validateGeminiGallery, validateIndependentTestResponseV132, validatePortfolioProcess, validatePortfolioSemantics, validateRunResult } from "./validation/index.ts";
import type { GeminiGallery, IndependentTestResponseV132, PortfolioCandidateResult, PortfolioRunResult, ProcessAudit, ValidationFinding } from "./validation/types.ts";
import type { LoadedPortfolioSnapshot } from "./snapshot.ts";
import type { IndependentTestValidationContextV132 } from "./validation/test-response-v132-validator.ts";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const gallerySchemaPath = fileURLToPath(new URL("./schemas/gemini-gallery.schema.json", import.meta.url));
const testSchemaPath = fileURLToPath(new URL("./schemas/independent-test-response-v1.3.2.schema.json", import.meta.url));
async function schema(path: string): Promise<JsonSchema> { return JSON.parse(await readFile(path, "utf8")) as JsonSchema; }
function findings(check: string, messages: string[]): ValidationFinding[] { return messages.map((message) => ({check_id:check,severity:"ERROR",message})); }
function sameIds(a: readonly string[], b: readonly string[]): boolean { return a.length===b.length && new Set(a).size===a.length && a.every((id)=>b.includes(id)); }

export async function runStandalonePortfolioLifecycle(
 input: PortfolioOrchestratorInput, dependencies: PortfolioOrchestratorDependencies, loaded: LoadedPortfolioSnapshot,
): Promise<PortfolioRunResult> {
 const compose=dependencies.compose ?? generatePortfolioGallery;
 const evaluate=dependencies.evaluateTest ?? evaluateIndependentTest;
 const gallerySchema=dependencies.gallerySchema ?? await schema(gallerySchemaPath);
 const testSchema=dependencies.independentTestSchema ?? await schema(testSchemaPath);
 const baseCalls=[...(input.processAudit.modelCalls ?? [])];
 const candidateResults: PortfolioCandidateResult[]=[];
 const revisionMap: Record<string,number>={...input.processAudit.revisionCyclesByCandidate};
 const postMap=new Map(loaded.snapshot.posts.map((post)=>[post.source_id,post]));
 const selected=input.candidateId ? [input.candidateId] : [...input.processAudit.candidateIds];
 let finalComposition: GeminiGallery|null=null;
 let finalTest: IndependentTestResponseV132|null=null;
 let structuralErrors:string[]=[];
 let semanticErrors:string[]=[];
 let providerError:unknown=null;

 for (const candidateId of selected) {
  const ids=input.processAudit.candidateSourceIdsById[candidateId];
  if (!ids || ids.length!==6 || new Set(ids).size!==6 || ids.some((id)=>!postMap.has(id))) {
   candidateResults.push({candidate_id:candidateId,status:"INCOMPLETE",composition:null,independent_test:null,revision_cycles:0,findings:["Candidate must reference exactly six unique snapshot sources."]});
   semanticErrors.push("CANDIDATE_SOURCE_SET_INVALID: "+candidateId); providerError=new Error("Invalid candidate source set."); break;
  }
  if (!/^cand_[a-f0-9]{64}$/.test(candidateId)) {
   candidateResults.push({candidate_id:candidateId,status:"INCOMPLETE",composition:null,independent_test:null,revision_cycles:0,findings:["Candidate ID is not canonical for TEST v1.3.2."]});
   semanticErrors.push("CANDIDATE_ID_INVALID_FOR_INDEPENDENT_TEST: "+candidateId); providerError=new Error("Non-canonical candidate ID."); break;
  }
  const posts=ids.map((id)=>postMap.get(id)!);
  const promptPosts=posts.map((p)=>({source_id:p.source_id,title:"title" in p?p.title:"",body:p.body,hashtags:"hashtags" in p?p.hashtags:[]}));
  const sourceTexts=Object.fromEntries(posts.map((p)=>[p.source_id,p.body]));
  let composition:GeminiGallery|null=null;
  let independentTest:IndependentTestResponseV132|null=null;
  let candidateStatus:PortfolioCandidateResult["status"]="INCOMPLETE";
  let cycles=0;
  const candidateFindings:string[]=[];
  try {
   const composePrompt=[input.prompt,"COMPOSE: create a gallery for exactly this six-post candidate. Use full body text as meaning source; hashtags may carry meaning but are neither privileged nor sufficient alone.","CANDIDATE POSTS:",JSON.stringify(promptPosts)].join("\n");
   const first=await compose(composePrompt,gallerySchema,{...input.providerOptions,stage:"COMPOSE",candidateId});
   baseCalls.push(...first.model_used);
   let check=validateGeminiGallery(first.data);
   let semantic=validatePortfolioSemantics({gallery:first.data},loaded.snapshot,ids);
   if (!check.ok || !semantic.ok) {
    structuralErrors.push(...check.errors); semanticErrors.push(...semantic.errors); candidateFindings.push(...check.errors,...semantic.errors);
    candidateResults.push({candidate_id:candidateId,status:"INCOMPLETE",composition:null,independent_test:null,revision_cycles:0,findings:candidateFindings});
    providerError=new Error("COMPOSE failed structural or semantic validation."); break;
   }
   composition=first.data;
   while (true) {
    const context:IndependentTestValidationContextV132={sourceTexts,composition};
    const testPrompt=[input.prompt,"INDEPENDENT TEST: evaluate the composition against exact source texts and composition; return only TEST v1.3.2 JSON.","CANDIDATE POSTS:",JSON.stringify(promptPosts),"COMPOSITION:",JSON.stringify(composition)].join("\n");
    const tested=await evaluate(testPrompt,testSchema,{...input.providerOptions,candidateId,validationContext:context});
    baseCalls.push(...tested.model_used);
    check=validateIndependentTestResponseV132(tested.data,context);
    if (!check.ok || tested.data.candidate_id!==candidateId) {
     candidateFindings.push(...check.errors,"TEST candidate_id does not match requested candidate.");
     candidateStatus="INCOMPLETE"; providerError=new Error("Independent TEST validation failed."); break;
    }
    independentTest=tested.data;
    if (independentTest.decision==="APPROVE") { candidateStatus="APPROVED"; break; }
    candidateFindings.push(...independentTest.blocking_issues);
    if (cycles===2) { candidateStatus="REVISION_EXHAUSTED"; break; }
    cycles+=1;
    const revisionPrompt=[input.prompt,"REVISION: revise the prior composition in response to these independent TEST findings. Do not fabricate evidence.","CANDIDATE POSTS:",JSON.stringify(promptPosts),"PRIOR COMPOSITION:",JSON.stringify(composition),"TEST FINDINGS:",JSON.stringify(independentTest)].join("\n");
    const revised=await compose(revisionPrompt,gallerySchema,{...input.providerOptions,stage:"REVISION",candidateId});
    baseCalls.push(...revised.model_used);
    check=validateGeminiGallery(revised.data);
    semantic=validatePortfolioSemantics({gallery:revised.data},loaded.snapshot,ids);
    if (!check.ok || !semantic.ok) {
     structuralErrors.push(...check.errors); semanticErrors.push(...semantic.errors); candidateFindings.push(...check.errors,...semantic.errors);
     candidateStatus="INCOMPLETE"; providerError=new Error("REVISION failed structural or semantic validation."); break;
    }
    composition=revised.data;
   }
  } catch (error) {
   if (typeof error==="object" && error!==null && "model_used" in error && Array.isArray(error.model_used)) baseCalls.push(...error.model_used as never[]);
   candidateFindings.push(error instanceof Error?error.message:String(error)); providerError=error; candidateStatus="INCOMPLETE";
  }
  revisionMap[candidateId]=cycles;
  candidateResults.push({candidate_id:candidateId,status:candidateStatus,composition,independent_test:independentTest,revision_cycles:cycles,findings:candidateFindings});
  if (candidateStatus==="APPROVED") { finalComposition=composition; finalTest=independentTest; break; }
  if (candidateStatus==="INCOMPLETE") break;
 }
 const audit:ProcessAudit={...input.processAudit,revisionCyclesByCandidate:revisionMap,modelCalls:baseCalls};
 const process=validatePortfolioProcess(audit,{actualSnapshotSourceIds:loaded.snapshot.posts.map((p)=>p.source_id),selectedCandidateId:input.candidateId??null,requireCandidateLifecycle:true});
 const allFindings=[...findings("STRUCTURAL_VALIDATION",structuralErrors),...findings("SEMANTIC_VALIDATION",semanticErrors),...findings("PROCESS_VALIDATION",process.errors)];
 const pass=structuralErrors.length===0 && semanticErrors.length===0 && process.ok && !providerError && !candidateResults.some((c)=>c.status==="INCOMPLETE");
 const noCandidates=input.processAudit.candidateIds.length===0;
 const runStatus:PortfolioRunResult["status"]=pass?(finalComposition&&finalTest?"APPROVED":"NO_GALLERY"):"INCOMPLETE";
 const validation={status:pass?"PASS" as const:"FAIL" as const,structural:structuralErrors.length?"FAIL" as const:"PASS" as const,semantic:semanticErrors.length?"FAIL" as const:"PASS" as const,process:process.ok?"PASS" as const:"FAIL" as const,findings:allFindings};
 if (noCandidates && !process.ok) { /* retain the process failure; no synthetic Provider call is made */ }
 const result:PortfolioRunResult={status:runStatus,input_snapshot:loaded.input_snapshot,gemini_output:null,composition:finalComposition,independent_test:finalTest,candidate_results:candidateResults,validation,model_used:baseCalls};
 const checked=validateRunResult(result);
 if (!checked.ok) throw new Error("Invalid standalone Portfolio run result: "+checked.errors.join("; "));
 return result;
}
