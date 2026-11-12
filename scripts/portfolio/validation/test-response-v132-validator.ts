import { isNonEmptyString, isRecord, result, exactKeys } from "./shared.ts";
import type { IndependentTestResponseV132, TestEvidenceReferenceV132, ValidationResult } from "./types.ts";

export interface IndependentTestValidationContextV132 {
  /** Exactly six complete canonical Snapshot body values, keyed by source_id. */
  sourceTexts: Readonly<Record<string, string>>;
  /** The actual composition object against which COMPOSITION JSON Pointers are resolved. */
  composition: unknown;
}

function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) return undefined;
  const segments = pointer.slice(1).split("/").map((part) => {
    if (/~(?![01])/.test(part)) return null;
    return part.replace(/~1/g, "/").replace(/~0/g, "~");
  });
  if (segments.some((part) => part === null)) return undefined;
  let current: unknown = root;
  for (const segment of segments as string[]) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment)) return undefined;
      const index = Number(segment);
      if (index >= current.length) return undefined;
      current = current[index];
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function validateEvidence(
  value: unknown,
  context: IndependentTestValidationContextV132,
  path: string,
  errors: string[],
): value is TestEvidenceReferenceV132 {
  if (!isRecord(value)) {
    errors.push(path + ": expected an evidence object");
    return false;
  }
  if (value.kind === "SOURCE") {
    exactKeys(value, ["kind", "source_id", "quote"], path, errors);
    if (!isNonEmptyString(value.source_id)) errors.push(path + ".source_id: expected a non-empty source ID");
    else if (!Object.hasOwn(context.sourceTexts, value.source_id)) errors.push(path + ".source_id: source is outside the six supplied sources");
    if (!isNonEmptyString(value.quote)) errors.push(path + ".quote: expected a non-empty exact quote");
    else if (isNonEmptyString(value.source_id) && Object.hasOwn(context.sourceTexts, value.source_id)
      && !context.sourceTexts[value.source_id].includes(value.quote)) {
      errors.push(path + ".quote: exact quote not found in the corresponding Snapshot body");
    }
    return true;
  }
  if (value.kind === "COMPOSITION") {
    exactKeys(value, ["kind", "path", "quote"], path, errors);
    if (!isNonEmptyString(value.path) || !value.path.startsWith("/")) {
      errors.push(path + ".path: expected a non-root JSON Pointer");
    } else if (/~(?![01])/.test(value.path)) {
      errors.push(path + ".path: invalid JSON Pointer escape");
    }
    if (!isNonEmptyString(value.quote)) errors.push(path + ".quote: expected a non-empty exact quote");
    else if (isNonEmptyString(value.path)) {
      const target = resolveJsonPointer(context.composition, value.path);
      if (typeof target !== "string") errors.push(path + ".path: pointer must resolve to a string composition element");
      else if (!target.includes(value.quote)) errors.push(path + ".quote: exact quote not found at the referenced composition path");
    }
    return true;
  }
  errors.push(path + ".kind: expected SOURCE or COMPOSITION");
  return false;
}

export function validateIndependentTestResponseV132(
  value: unknown,
  context: IndependentTestValidationContextV132,
): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["test_response: expected an object"] };
  exactKeys(value, ["candidate_id", "decision", "scores", "findings", "blocking_issues"], "test_response", errors);

  if (!isNonEmptyString(value.candidate_id) || !/^cand_[a-f0-9]{64}$/.test(value.candidate_id)) {
    errors.push("test_response.candidate_id: expected canonical Candidate ID");
  }
  if (value.decision !== "APPROVE" && value.decision !== "REJECT") {
    errors.push("test_response.decision: expected APPROVE or REJECT");
  }

  const sourceIds = isRecord(context.sourceTexts) ? Object.keys(context.sourceTexts) : [];
  if (sourceIds.length !== 6 || new Set(sourceIds).size !== 6
    || sourceIds.some((id) => !isNonEmptyString(id) || !isNonEmptyString(context.sourceTexts[id]))) {
    errors.push("test_response.context.sourceTexts: expected exactly six distinct source IDs with complete non-empty body text");
  }
  if (!isRecord(context.composition)) errors.push("test_response.context.composition: expected a composition object");

  const scoreKeys = ["semantic_coherence", "curatorial_originality", "narrative_integrity", "visual_composition", "evidence_integrity"];
  if (!isRecord(value.scores)) errors.push("test_response.scores: expected an object");
  else {
    exactKeys(value.scores, scoreKeys, "test_response.scores", errors);
    for (const key of scoreKeys) {
      const score = value.scores[key];
      if (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 5) {
        errors.push("test_response.scores." + key + ": expected integer 1–5");
      }
    }
    if (value.decision === "APPROVE") {
      for (const key of scoreKeys.slice(0, 4)) {
        if (typeof value.scores[key] === "number" && value.scores[key] < 4) errors.push("test_response.scores." + key + ": APPROVE requires at least 4");
      }
      if (value.scores.evidence_integrity !== 5) errors.push("test_response.scores.evidence_integrity: APPROVE requires exactly 5");
    }
  }

  if (!Array.isArray(value.findings)) errors.push("test_response.findings: expected an array");
  else {
    value.findings.forEach((finding, index) => {
      const path = "test_response.findings[" + index + "]";
      if (!isRecord(finding)) {
        errors.push(path + ": expected an object");
        return;
      }
      exactKeys(finding, ["criterion", "issue", "blocking", "evidence"], path, errors);
      if (!["semantic_coherence", "curatorial_originality", "narrative_integrity", "visual_composition", "evidence_integrity"].includes(String(finding.criterion))) {
        errors.push(path + ".criterion: unknown criterion");
      }
      if (!isNonEmptyString(finding.issue)) errors.push(path + ".issue: expected a non-empty issue");
      if (typeof finding.blocking !== "boolean") errors.push(path + ".blocking: expected boolean");
      validateEvidence(finding.evidence, context, path + ".evidence", errors);
    });
  }

  if (!Array.isArray(value.blocking_issues) || !value.blocking_issues.every(isNonEmptyString)) {
    errors.push("test_response.blocking_issues: expected an array of non-empty strings");
  } else if (value.decision === "APPROVE" && value.blocking_issues.length !== 0) {
    errors.push("test_response.blocking_issues: APPROVE requires no blocking issues");
  } else if (value.decision === "REJECT" && value.blocking_issues.length === 0) {
    errors.push("test_response.blocking_issues: REJECT requires at least one blocking issue");
  }

  const blockingFindings = Array.isArray(value.findings)
    ? value.findings.filter((finding) => isRecord(finding) && finding.blocking === true)
    : [];
  if (value.decision === "APPROVE" && blockingFindings.length > 0) {
    errors.push("test_response.findings: APPROVE requires no blocking findings");
  }
  if (value.decision === "REJECT" && blockingFindings.length === 0) {
    errors.push("test_response.findings: REJECT requires at least one blocking finding");
  }
  return result(errors);
}

export function isIndependentTestResponseV132(
  value: unknown,
  context: IndependentTestValidationContextV132,
): value is IndependentTestResponseV132 {
  return validateIndependentTestResponseV132(value, context).ok;
}
