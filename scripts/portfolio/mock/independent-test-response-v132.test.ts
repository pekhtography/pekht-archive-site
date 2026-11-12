import test from "node:test";
import assert from "node:assert/strict";
import { validateIndependentTestResponseV132 } from "../validation/test-response-v132-validator.ts";

const candidate_id = "cand_" + "a".repeat(64);
const sourceTexts = {
  "source-1": "The river carries yesterday beneath today's bridge.",
  "source-2": "A window holds the last blue minute of evening.",
  "source-3": "The station clock pauses while footsteps continue.",
  "source-4": "A shadow stretches beyond the hour marked on the wall.",
  "source-5": "The first light measures the room in silence.",
  "source-6": "At dawn, the street returns every borrowed color."
};
const composition = {
  title: "Borrowed Hours",
  statement: "Time moves through light, water, and the traces of human passage.",
  facets: ["Time", "Light"],
  roles: []
};
const context = { sourceTexts, composition };
const approve = {
  candidate_id,
  decision: "APPROVE",
  scores: { semantic_coherence: 5, curatorial_originality: 4, narrative_integrity: 4, visual_composition: 4, evidence_integrity: 5 },
  findings: [{
    criterion: "semantic_coherence",
    issue: "The selected texts sustain a coherent temporal motif.",
    blocking: false,
    evidence: { kind: "SOURCE", source_id: "source-1", quote: "The river carries yesterday" }
  }],
  blocking_issues: []
};
const reject = {
  candidate_id,
  decision: "REJECT",
  scores: { semantic_coherence: 3, curatorial_originality: 2, narrative_integrity: 3, visual_composition: 4, evidence_integrity: 2 },
  findings: [{
    criterion: "evidence_integrity",
    issue: "The proposed interpretation is not supported by the selected source.",
    blocking: true,
    evidence: { kind: "SOURCE", source_id: "source-1", quote: "The river carries yesterday" }
  }],
  blocking_issues: ["The proposed interpretation is not supported."]
};

test("APPROVE accepts exact SOURCE evidence and six-source context", () => {
  assert.deepEqual(validateIndependentTestResponseV132(approve, context), { ok: true, errors: [] });
});
test("APPROVE accepts exact COMPOSITION evidence using a JSON Pointer", () => {
  const value = { ...approve, findings: [{
    criterion: "narrative_integrity", issue: "Statement is directly inspectable.", blocking: false,
    evidence: { kind: "COMPOSITION", path: "/statement", quote: "Time moves through light" }
  }] };
  assert.equal(validateIndependentTestResponseV132(value, context).ok, true);
});
test("REJECT accepts evidence score below five when a blocking finding exists", () => {
  assert.equal(validateIndependentTestResponseV132(reject, context).ok, true);
});
test("SOURCE quote must exactly occur in the declared source body", () => {
  const value = structuredClone(approve);
  value.findings[0].evidence.quote = "The river carries tomorrow";
  assert.equal(validateIndependentTestResponseV132(value, context).ok, false);
});
test("SOURCE evidence cannot reference a source outside the six supplied sources", () => {
  const value = structuredClone(approve);
  value.findings[0].evidence.source_id = "outside-source";
  assert.equal(validateIndependentTestResponseV132(value, context).ok, false);
});
test("COMPOSITION pointer must resolve to an existing string and exact quote", () => {
  const value = { ...approve, findings: [{
    criterion: "visual_composition", issue: "Missing target.", blocking: false,
    evidence: { kind: "COMPOSITION", path: "/missing", quote: "not here" }
  }] };
  assert.equal(validateIndependentTestResponseV132(value, context).ok, false);
});
test("COMPOSITION quote must occur at the pointed-to element", () => {
  const value = { ...approve, findings: [{
    criterion: "visual_composition", issue: "Incorrect quote.", blocking: false,
    evidence: { kind: "COMPOSITION", path: "/title", quote: "Other title" }
  }] };
  assert.equal(validateIndependentTestResponseV132(value, context).ok, false);
});
test("COMPOSITION JSON Pointer supports escaped slash and tilde", () => {
  const escapedContext = { sourceTexts, composition: { "a/b": { "~key": "Exact nested passage." } } };
  const value = { ...approve, findings: [{
    criterion: "visual_composition", issue: "Nested evidence.", blocking: false,
    evidence: { kind: "COMPOSITION", path: "/a~1b/~0key", quote: "Exact nested passage" }
  }] };
  assert.equal(validateIndependentTestResponseV132(value, escapedContext).ok, true);
});
test("APPROVE rejects blocking findings", () => {
  const value = { ...approve, findings: [{ ...approve.findings[0], blocking: true }] };
  assert.equal(validateIndependentTestResponseV132(value, context).ok, false);
});
test("REJECT requires at least one blocking finding", () => {
  const value = { ...reject, findings: [{ ...reject.findings[0], blocking: false }] };
  assert.equal(validateIndependentTestResponseV132(value, context).ok, false);
});
test("APPROVE still requires evidence integrity five", () => {
  const value = { ...approve, scores: { ...approve.scores, evidence_integrity: 4 } };
  assert.equal(validateIndependentTestResponseV132(value, context).ok, false);
});
test("Validation context must contain exactly six complete source texts", () => {
  const incomplete = { sourceTexts: { "source-1": sourceTexts["source-1"] }, composition };
  assert.equal(validateIndependentTestResponseV132(approve, incomplete).ok, false);
});
test("Unknown response and finding properties are rejected", () => {
  const value = { ...approve, extra: true, findings: [{ ...approve.findings[0], extra: true }] };
  assert.equal(validateIndependentTestResponseV132(value, context).ok, false);
});
test("Malformed JSON Pointer escape is rejected", () => {
  const value = { ...approve, findings: [{
    criterion: "visual_composition", issue: "Bad pointer.", blocking: false,
    evidence: { kind: "COMPOSITION", path: "/bad~2escape", quote: "x" }
  }] };
  assert.equal(validateIndependentTestResponseV132(value, context).ok, false);
});
