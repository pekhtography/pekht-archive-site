import { isNonEmptyString, isRecord, result } from "./shared.ts";
import type { IndependentTestResponse, ValidationResult } from "./types.ts";

export function validateIndependentTestResponse(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["test_response: expected an object"] };
  const keys = ["candidate_id", "decision", "scores", "findings", "blocking_issues"];
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push("test_response." + key + ": unexpected property");
  for (const key of keys) if (!(key in value)) errors.push("test_response." + key + ": required");
  if (!isNonEmptyString(value.candidate_id) || !/^cand_[a-f0-9]{64}$/.test(value.candidate_id)) errors.push("test_response.candidate_id: expected canonical Candidate ID");
  if (value.decision !== "APPROVE" && value.decision !== "REJECT") errors.push("test_response.decision: expected APPROVE or REJECT");
  const scoreKeys = ["semantic_coherence", "curatorial_originality", "narrative_integrity", "visual_composition", "evidence_integrity"];
  if (!isRecord(value.scores)) errors.push("test_response.scores: expected an object");
  else {
    for (const key of Object.keys(value.scores)) if (!scoreKeys.includes(key)) errors.push("test_response.scores." + key + ": unexpected property");
    for (const key of scoreKeys) {
      const score = value.scores[key];
      if (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 5) errors.push("test_response.scores." + key + ": expected integer 1–5");
    }
    if (value.decision === "APPROVE") {
      for (const key of scoreKeys.slice(0, 4)) if (typeof value.scores[key] === "number" && value.scores[key] < 4) errors.push("test_response.scores." + key + ": APPROVE requires at least 4");
      if (value.scores.evidence_integrity !== 5) errors.push("test_response.scores.evidence_integrity: APPROVE requires exactly 5");
    }
  }
  if (!Array.isArray(value.findings) || !value.findings.every((item) => typeof item === "string")) errors.push("test_response.findings: expected an array of strings");
  if (!Array.isArray(value.blocking_issues) || !value.blocking_issues.every(isNonEmptyString)) errors.push("test_response.blocking_issues: expected an array of non-empty strings");
  else if (value.decision === "APPROVE" && value.blocking_issues.length !== 0) errors.push("test_response.blocking_issues: APPROVE requires no blocking issues");
  else if (value.decision === "REJECT" && value.blocking_issues.length === 0) errors.push("test_response.blocking_issues: REJECT requires at least one blocking issue");
  return result(errors);
}

export function isIndependentTestResponse(value: unknown): value is IndependentTestResponse { return validateIndependentTestResponse(value).ok; }