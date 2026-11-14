#!/usr/bin/env node
/**
 * Ajv 8.17.1 / Draft 2020-12 validation for Portfolio run-result contracts.
 * Runs beside the pinned Validation 0.2.1 dependencies; does not change runtime code.
 */
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = process.cwd();
const schemaDir = path.resolve(root, "../../scripts/portfolio/schemas");
const base = "https://pekhtography.local/schemas/";
const schemaNames = [
  "gemini-gallery.schema.json",
  "gemini-output.schema.json",
  "independent-test-response.schema.json",
  "independent-test-response-v1.3.2.schema.json",
  "portfolio-run-result.schema.json",
];

// Draft 2020-12 permits "properties" inside conditional applicators without
// restating "type": "object". Keep Ajv strict mode enabled, but disable only
// strictTypes so these valid schemas are checked by their normative semantics.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);

const schemas = new Map();
for (const name of schemaNames) {
  const fullPath = path.join(schemaDir, name);
  if (!fs.existsSync(fullPath)) throw new Error("Missing Portfolio schema: " + name);
  const schema = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  schema.$id ??= base + name;
  if (!ajv.validateSchema(schema)) {
    throw new Error(name + ": invalid Draft 2020-12 schema: " + ajv.errorsText(ajv.errors));
  }
  schemas.set(name, schema);
}
for (const schema of schemas.values()) ajv.addSchema(schema);
for (const [name, schema] of schemas) {
  ajv.compile(schema);
  process.stdout.write("AJV SCHEMA OK " + name + "\n");
}

const runSchema = schemas.get("portfolio-run-result.schema.json");
const validateRun = ajv.getSchema(runSchema.$id);
if (!validateRun) throw new Error("Could not resolve compiled Portfolio Run Result schema");

const snapshot = {
  schema_version: "1.0",
  repository_commit: "a".repeat(40),
  generated_at: "2026-11-12T10:00:00Z",
  sampled_count: 1000,
  content_sha256: "b".repeat(64),
};

function gallery() {
  const sourceIds = ["src-1", "src-2", "src-3", "src-4", "src-5", "src-6"];
  return {
    source_ids: sourceIds,
    title: "Six ways of seeing",
    statement: "The same light creates distinct realities.",
    facets: ["Light", "Perception"],
    roles: sourceIds.map((source_id) => ({
      source_id,
      role: "Counterpoint",
      operation: "Reframe",
      evidence: [{
        quote: "Light changes everything",
        interpretation: "A shift in perception",
      }],
      necessity: "Provides a distinct step in the sequence",
    })),
    composition_rationale: "A coherent progression from observation to transformation.",
    alternatives_considered: ["A purely chronological sequence"],
    doubts: [],
  };
}

function testResponse(candidateId, decision) {
  const approved = decision === "APPROVE";
  const scores = {
    semantic_coherence: approved ? 4 : 3,
    curatorial_originality: approved ? 4 : 3,
    narrative_integrity: approved ? 4 : 3,
    visual_composition: approved ? 4 : 3,
    evidence_integrity: approved ? 5 : 3,
  };
  if (approved) {
    return {
      candidate_id: candidateId,
      decision,
      scores,
      findings: [],
      blocking_issues: [],
    };
  }
  const issue = "The sequence lacks a coherent relation.";
  return {
    candidate_id: candidateId,
    decision,
    scores,
    findings: [{
      criterion: "semantic_coherence",
      issue,
      blocking: true,
      evidence: {
        kind: "SOURCE",
        source_id: "src-1",
        quote: "The source text does not support the proposed relation.",
      },
    }],
    blocking_issues: [issue],
  };
}

function baseResult(status, validationStatus = "PASS") {
  return {
    status,
    input_snapshot: structuredClone(snapshot),
    gemini_output: null,
    validation: {
      status: validationStatus,
      structural: validationStatus === "PASS" ? "PASS" : "FAIL",
      semantic: validationStatus === "PASS" ? "PASS" : "FAIL",
      process: validationStatus === "PASS" ? "PASS" : "FAIL",
      findings: [],
    },
    model_used: [],
  };
}

function approved() {
  const candidateId = "cand_" + "a".repeat(64);
  const composition = gallery();
  const independentTest = testResponse(candidateId, "APPROVE");
  const candidate = {
    candidate_id: candidateId,
    status: "APPROVED",
    composition,
    independent_test: independentTest,
    revision_cycles: 1,
    findings: [],
  };
  return {
    ...baseResult("APPROVED"),
    composition,
    independent_test: independentTest,
    candidate_results: [candidate],
  };
}

function noGallery() {
  const candidateId = "cand_" + "b".repeat(64);
  const candidate = {
    candidate_id: candidateId,
    status: "REVISION_EXHAUSTED",
    composition: gallery(),
    independent_test: testResponse(candidateId, "REJECT"),
    revision_cycles: 2,
    findings: ["The sequence lacks a coherent relation."],
  };
  return {
    ...baseResult("NO_GALLERY"),
    composition: null,
    independent_test: null,
    candidate_results: [candidate],
  };
}

function incomplete() {
  const candidateId = "cand_" + "c".repeat(64);
  const candidate = {
    candidate_id: candidateId,
    status: "INCOMPLETE",
    composition: null,
    independent_test: null,
    revision_cycles: 0,
    findings: ["Provider fallback exhausted"],
  };
  return {
    ...baseResult("INCOMPLETE", "FAIL"),
    composition: null,
    independent_test: null,
    candidate_results: [candidate],
  };
}

function rejectedCandidate() {
  const candidateId = "cand_" + "d".repeat(64);
  return {
    candidate_id: candidateId,
    status: "REJECTED",
    composition: null,
    independent_test: testResponse(candidateId, "REJECT"),
    revision_cycles: 0,
    findings: ["Rejected after independent TEST"],
  };
}

function check(label, instance, expectedValid) {
  const valid = Boolean(validateRun(instance));
  if (valid !== expectedValid) {
    process.stderr.write("FAIL " + label + ": expected valid=" + expectedValid + ", got valid=" + valid + "\n");
    for (const error of (validateRun.errors ?? []).slice(0, 8)) {
      process.stderr.write("  - " + error.instancePath + ": " + error.message + "\n");
    }
    return false;
  }
  process.stdout.write("PASS " + label + "\n");
  return true;
}

const checks = [];
checks.push(check("standalone APPROVED", approved(), true));
checks.push(check("standalone NO_GALLERY after REVISION_EXHAUSTED", noGallery(), true));
checks.push(check("standalone INCOMPLETE", incomplete(), true));

const mixedNoGallery = noGallery();
mixedNoGallery.candidate_results.push(rejectedCandidate());
checks.push(check("NO_GALLERY with exhausted and rejected candidates", mixedNoGallery, true));

let invalid = approved();
invalid.validation.semantic = "FAIL";
checks.push(check("reject APPROVED with failed semantic validation", invalid, false));

invalid = approved();
invalid.candidate_results[0].revision_cycles = 3;
checks.push(check("reject revision count above two", invalid, false));

invalid = approved();
invalid.independent_test.scores.semantic_coherence = 3;
invalid.candidate_results[0].independent_test.scores.semantic_coherence = 3;
checks.push(check("reject APPROVE below score threshold", invalid, false));

invalid = approved();
invalid.composition.source_ids.pop();
invalid.candidate_results[0].composition.source_ids.pop();
checks.push(check("reject composition with fewer than six source IDs", invalid, false));

invalid = noGallery();
invalid.candidate_results[0].revision_cycles = 1;
checks.push(check("reject REVISION_EXHAUSTED before two revisions", invalid, false));

invalid = noGallery();
invalid.candidate_results[0].independent_test.blocking_issues = [];
checks.push(check("reject REJECT without blocking issue", invalid, false));

if (checks.some((passed) => !passed)) process.exit(1);
process.stdout.write(
  "AJV DRAFT 2020-12 PASS (" + schemaNames.length + " Portfolio schemas, " +
  checks.length + " run-result checks); ajv 8.17.1, ajv-formats 3.0.1.\n"
);
