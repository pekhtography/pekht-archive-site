import { exactKeys, isNonEmptyString, isRecord, isStatus, result } from "./shared.ts";
import { validateGeminiOutput } from "./gemini-output-validator.ts";
import type { ValidationResult } from "./types.ts";
const stages = new Set(["DISCOVER","COMPOSE","TEST","REVISION"]);
const outcomes = new Set(["SUCCESS","FALLBACK","FAILED"]);
export function validateRunResult(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["run_result: expected an object"] };
  const allowedKeys = ["status","input_snapshot","gemini_output","validation","model_used","composition","independent_test","candidate_results"];
  exactKeys(value, allowedKeys.filter((key) => key in value), "run_result", errors);
  if (!["APPROVED","NO_GALLERY","INCOMPLETE"].includes(String(value.status))) errors.push("status: invalid run status");
  const snapshot = value.input_snapshot;
  if (!isRecord(snapshot)) errors.push("input_snapshot: expected an object");
  else {
    exactKeys(snapshot, ["schema_version","repository_commit","generated_at","sampled_count","content_sha256"], "input_snapshot", errors);
    if (!isNonEmptyString(snapshot.schema_version)) errors.push("input_snapshot.schema_version: required");
    if (typeof snapshot.repository_commit !== "string" || !/^[0-9a-fA-F]{40}$/.test(snapshot.repository_commit)) errors.push("input_snapshot.repository_commit: expected 40-character commit SHA");
    if (typeof snapshot.generated_at !== "string" || !Number.isFinite(Date.parse(snapshot.generated_at)) || !/^\d{4}-\d{2}-\d{2}T/.test(snapshot.generated_at)) errors.push("input_snapshot.generated_at: expected ISO date-time");
    if (snapshot.sampled_count !== 1000) errors.push("input_snapshot.sampled_count: expected 1000");
    if (typeof snapshot.content_sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(snapshot.content_sha256)) errors.push("input_snapshot.content_sha256: expected 64-character SHA-256");
  }
  const output = value.gemini_output;
  if (output !== null) {
    const checked = validateGeminiOutput(output);
    if (!checked.ok) errors.push(...checked.errors.map((e) => `gemini_output: ${e}`));
  }
  if ("composition" in value && value.composition !== null) {
    const checked = validateGeminiOutput({ gallery: value.composition, test: { decision: "APPROVE", findings: [], revision_cycles: 0 } });
    if (!checked.ok) errors.push(...checked.errors.map((e) => `composition: ${e}`));
  }
  if ("independent_test" in value && value.independent_test !== null) {
    const test = value.independent_test;
    if (!isRecord(test)) errors.push("independent_test: expected an object or null");
    else {
      exactKeys(test, ["candidate_id","decision","scores","findings","blocking_issues"], "independent_test", errors);
      if (!isNonEmptyString(test.candidate_id) || !/^cand_[a-f0-9]{64}$/.test(test.candidate_id)) errors.push("independent_test.candidate_id: expected canonical Candidate ID");
      if (test.decision !== "APPROVE" && test.decision !== "REJECT") errors.push("independent_test.decision: invalid decision");
      if (!isRecord(test.scores) || !Array.isArray(test.findings) || !Array.isArray(test.blocking_issues)) errors.push("independent_test: malformed structured TEST payload");
    }
  }
  if ("candidate_results" in value) {
    if (!Array.isArray(value.candidate_results)) errors.push("candidate_results: expected an array");
    else value.candidate_results.forEach((candidate, index) => {
      const path = `candidate_results[${index}]`;
      if (!isRecord(candidate)) { errors.push(`${path}: expected an object`); return; }
      exactKeys(candidate, ["candidate_id","status","composition","independent_test","revision_cycles","findings"], path, errors);
      if (!isNonEmptyString(candidate.candidate_id)) errors.push(`${path}.candidate_id: required`);
      if (!["APPROVED","REJECTED","REVISION_EXHAUSTED","INCOMPLETE"].includes(String(candidate.status))) errors.push(`${path}.status: invalid candidate status`);
      if (candidate.composition !== null) {
        const checked = validateGeminiOutput({ gallery: candidate.composition, test: { decision: "APPROVE", findings: [], revision_cycles: 0 } });
        if (!checked.ok) errors.push(...checked.errors.map((e) => `${path}.composition: ${e}`));
      }
      if (candidate.independent_test !== null && !isRecord(candidate.independent_test)) errors.push(`${path}.independent_test: expected an object or null`);
      if (!Number.isInteger(candidate.revision_cycles) || (candidate.revision_cycles as number) < 0 || (candidate.revision_cycles as number) > 2) errors.push(`${path}.revision_cycles: expected integer 0–2`);
      if (!Array.isArray(candidate.findings) || !candidate.findings.every(isNonEmptyString)) errors.push(`${path}.findings: expected an array of non-empty strings`);
    });
  }
  const validation = value.validation;
  if (!isRecord(validation)) errors.push("validation: expected an object");
  else {
    exactKeys(validation, ["status","structural","semantic","process","findings"], "validation", errors);
    for (const key of ["status","structural","semantic","process"] as const) if (!isStatus(validation[key])) errors.push(`validation.${key}: invalid status`);
    if (!Array.isArray(validation.findings)) errors.push("validation.findings: expected an array");
    else validation.findings.forEach((finding,index) => {
      const path = `validation.findings[${index}]`;
      if (!isRecord(finding)) { errors.push(`${path}: expected an object`); return; }
      const expected = "source_id" in finding ? ["check_id","severity","message","source_id"] : ["check_id","severity","message"];
      exactKeys(finding, expected, path, errors);
      if (!isNonEmptyString(finding.check_id) || !isNonEmptyString(finding.message)) errors.push(`${path}: check_id and message are required`);
      if (!["ERROR","WARNING","INFO"].includes(String(finding.severity))) errors.push(`${path}.severity: invalid severity`);
      if ("source_id" in finding && !isNonEmptyString(finding.source_id)) errors.push(`${path}.source_id: expected a non-empty string`);
    });
  }
  if (!Array.isArray(value.model_used)) errors.push("model_used: expected an array");
  else value.model_used.forEach((call,index) => {
    const path = `model_used[${index}]`;
    if (!isRecord(call)) { errors.push(`${path}: expected an object`); return; }
    exactKeys(call, ["call_id","stage","candidate_id","model","fallback_index","attempts","outcome"], path, errors);
    if (!isNonEmptyString(call.call_id)) errors.push(`${path}.call_id: required`);
    if (!stages.has(String(call.stage))) errors.push(`${path}.stage: invalid stage`);
    if (call.candidate_id !== null && !isNonEmptyString(call.candidate_id)) errors.push(`${path}.candidate_id: expected a string or null`);
    if (!isNonEmptyString(call.model)) errors.push(`${path}.model: required`);
    if (!Number.isInteger(call.fallback_index) || (call.fallback_index as number) < 0) errors.push(`${path}.fallback_index: expected non-negative integer`);
    if (!Number.isInteger(call.attempts) || (call.attempts as number) < 1) errors.push(`${path}.attempts: expected positive integer`);
    if (!outcomes.has(String(call.outcome))) errors.push(`${path}.outcome: invalid outcome`);
  });
  if (isRecord(validation)) {
    if (value.status === "APPROVED") {
      const legacy = isRecord(output) && isRecord(output.gallery) && isRecord(output.test) && output.test.decision === "APPROVE";
      const standalone = Array.isArray(value.candidate_results) && isRecord(value.composition) && isRecord(value.independent_test)
        && value.independent_test.decision === "APPROVE"
        && value.candidate_results.some((candidate) => isRecord(candidate) && candidate.status === "APPROVED");
      if (!legacy && !standalone) errors.push("status APPROVED requires an approved composition and independent TEST");
      if (validation.status !== "PASS" || validation.structural !== "PASS" || validation.semantic !== "PASS" || validation.process !== "PASS") errors.push("status APPROVED requires all validation levels PASS");
    }
    if (value.status === "NO_GALLERY") {
      const legacy = isRecord(output) && output.gallery === null && isRecord(output.test) && output.test.decision === "REJECT";
      const standalone = Array.isArray(value.candidate_results) && value.composition === null && value.independent_test === null\n        && value.candidate_results.every((candidate) => isRecord(candidate) && (candidate.status === "REJECTED" || candidate.status === "REVISION_EXHAUSTED"));
      if (!legacy && !standalone) errors.push("status NO_GALLERY requires no approved composition and no candidate TEST");
      if (validation.status !== "PASS" || validation.structural !== "PASS" || validation.semantic !== "PASS" || validation.process !== "PASS") errors.push("status NO_GALLERY requires all validation levels PASS");
    }
    if (value.status === "INCOMPLETE" && validation.status !== "FAIL" && validation.status !== "NOT_RUN") errors.push("status INCOMPLETE requires validation status FAIL or NOT_RUN");
  }
  return result(errors);
}
