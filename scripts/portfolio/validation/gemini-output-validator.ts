import { exactKeys, isNonEmptyString, isRecord, result } from "./shared.ts";
import type { GeminiOutput, ValidationResult } from "./types.ts";
export function validateGeminiOutput(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["output: expected an object"] };
  exactKeys(value, ["gallery", "test"], "output", errors);
  const test = value.test;
  if (!isRecord(test)) errors.push("test: expected an object");
  else {
    exactKeys(test, ["decision", "findings", "revision_cycles"], "test", errors);
    if (test.decision !== "APPROVE" && test.decision !== "REJECT") errors.push("test.decision: expected APPROVE or REJECT");
    if (!Array.isArray(test.findings) || !test.findings.every((v) => typeof v === "string")) errors.push("test.findings: expected an array of strings");
    if (!Number.isInteger(test.revision_cycles) || (test.revision_cycles as number) < 0 || (test.revision_cycles as number) > 2) errors.push("test.revision_cycles: expected an integer from 0 to 2");
  }
  if (value.gallery === null) {
    if (isRecord(test) && test.decision !== "REJECT") errors.push("gallery: null requires test.decision REJECT");
    return result(errors);
  }
  const gallery = value.gallery;
  if (!isRecord(gallery)) { errors.push("gallery: expected an object or null"); return result(errors); }
  if (isRecord(test) && test.decision !== "APPROVE") errors.push("gallery: non-null gallery requires test.decision APPROVE");
  exactKeys(gallery, ["source_ids","title","statement","facets","roles","composition_rationale","alternatives_considered","doubts"], "gallery", errors);
  if (!Array.isArray(gallery.source_ids) || gallery.source_ids.length !== 6 || !gallery.source_ids.every(isNonEmptyString)) errors.push("gallery.source_ids: expected exactly six non-empty strings");
  else if (new Set(gallery.source_ids).size !== 6) errors.push("gallery.source_ids: duplicate identifiers");
  for (const field of ["title","statement","composition_rationale"] as const) if (!isNonEmptyString(gallery[field])) errors.push(`gallery.${field}: expected a non-empty string`);
  if (!Array.isArray(gallery.facets) || gallery.facets.length < 2 || gallery.facets.length > 5 || !gallery.facets.every(isNonEmptyString)) errors.push("gallery.facets: expected 2–5 non-empty strings");
  else if (new Set(gallery.facets).size !== gallery.facets.length) errors.push("gallery.facets: duplicate facets");
  for (const field of ["alternatives_considered","doubts"] as const) if (!Array.isArray(gallery[field]) || !gallery[field].every((v) => typeof v === "string")) errors.push(`gallery.${field}: expected an array of strings`);
  if (!Array.isArray(gallery.roles) || gallery.roles.length !== 6) errors.push("gallery.roles: expected exactly six roles");
  else {
    const roleIds: string[] = [];
    gallery.roles.forEach((role,index) => {
      const path = `gallery.roles[${index}]`;
      if (!isRecord(role)) { errors.push(`${path}: expected an object`); return; }
      exactKeys(role, ["source_id","role","operation","evidence","necessity"], path, errors);
      if (!isNonEmptyString(role.source_id)) errors.push(`${path}.source_id: expected a non-empty string`);
      else roleIds.push(role.source_id);
      for (const field of ["role","operation","necessity"] as const) if (!isNonEmptyString(role[field])) errors.push(`${path}.${field}: expected a non-empty string`);
      if (!Array.isArray(role.evidence) || role.evidence.length < 1) errors.push(`${path}.evidence: expected at least one item`);
      else role.evidence.forEach((evidence,evidenceIndex) => {
        const p = `${path}.evidence[${evidenceIndex}]`;
        if (!isRecord(evidence)) { errors.push(`${p}: expected an object`); return; }
        exactKeys(evidence, ["quote","interpretation"], p, errors);
        if (!isNonEmptyString(evidence.quote)) errors.push(`${p}.quote: expected a non-empty string`);
        if (!isNonEmptyString(evidence.interpretation)) errors.push(`${p}.interpretation: expected a non-empty string`);
      });
    });
    if (new Set(roleIds).size !== roleIds.length) errors.push("gallery.roles: duplicate source_id values");
  }
  return result(errors);
}
export function isGeminiOutput(value: unknown): value is GeminiOutput { return validateGeminiOutput(value).ok; }

/** Validate a standalone gallery response using the canonical gallery rules. */
export function validateGeminiGallery(value: unknown): ValidationResult {
  return validateGeminiOutput({ gallery: value, test: { decision: "APPROVE", findings: [], revision_cycles: 0 } });
}
